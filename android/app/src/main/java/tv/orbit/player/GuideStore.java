package tv.orbit.player;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import android.util.JsonWriter;
import android.util.Xml;

import org.json.JSONArray;
import org.xmlpull.v1.XmlPullParser;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * The TV guide on Android.
 *
 * XMLTV guides from IPTV providers are often 100–500 MB. Reading one inside the WebView needs several
 * times that in memory, which is more than a Fire TV Stick has: the WebView is killed and the app
 * closes. Here the guide is read as a stream (a few hundred KB of memory whatever its size), only the
 * playlist's channels are kept, and the programmes go into a small SQLite database. The web layer
 * then asks for the programmes of the channels it is showing.
 */
final class GuideStore {

    interface Progress { void update(long bytes, long total, int programmes, int file, int files); }
    interface Opener { Opened open(String url) throws Exception; }
    static final class Opened {
        final InputStream in; final long length;
        Opened(InputStream in, long length) { this.in = in; this.length = length; }
    }

    private static SQLiteDatabase db;
    private static final Object LOCK = new Object();

    // v2 adds programme artwork, episode, category and rating columns.
    private static File dbFile(Context c) { return new File(c.getFilesDir(), "guide2.db"); }
    static File indexFile(Context c) { return new File(c.getFilesDir(), "guide2-index.json"); }

    private static SQLiteDatabase open(Context c) {
        synchronized (LOCK) {
            if (db == null && dbFile(c).exists()) {
                try { db = SQLiteDatabase.openDatabase(dbFile(c).getPath(), null, SQLiteDatabase.OPEN_READONLY); } catch (Exception ignored) {}
            }
            return db;
        }
    }

    /** Same as matchKey() in src/core/names.ts. */
    private static final Pattern PREFIX = Pattern.compile("^\\s*[a-z]{2,4}\\s*[:|]\\s*");
    private static final Pattern BRACKETS = Pattern.compile("\\[[^\\]]*\\]|\\([^)]*\\)");
    private static final Pattern QUALITY = Pattern.compile("\\b(hd|fhd|uhd|4k|sd|hevc|h\\.?265|raw|50fps|60fps|backup)\\b");
    private static final Pattern OTHER = Pattern.compile("[^a-z0-9+]");
    static String matchKey(String s) {
        if (s == null) return "";
        String k = s.toLowerCase(Locale.ROOT);
        k = PREFIX.matcher(k).replaceFirst("");
        k = BRACKETS.matcher(k).replaceAll("");
        k = QUALITY.matcher(k).replaceAll("");
        return OTHER.matcher(k).replaceAll("");
    }

    private static final Pattern DATE = Pattern.compile("^(\\d{4})(\\d\\d)(\\d\\d)(\\d\\d)(\\d\\d)(\\d\\d)?\\s*([+-]\\d{4})?");
    static long xmltvDate(String s) {
        if (s == null) return Long.MIN_VALUE;
        Matcher m = DATE.matcher(s.trim());
        if (!m.find()) return Long.MIN_VALUE;
        java.util.Calendar cal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"));
        cal.clear();
        cal.set(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)) - 1, Integer.parseInt(m.group(3)),
                Integer.parseInt(m.group(4)), Integer.parseInt(m.group(5)), m.group(6) == null ? 0 : Integer.parseInt(m.group(6)));
        long t = cal.getTimeInMillis();
        String z = m.group(7);
        if (z != null) {
            int sign = z.charAt(0) == '-' ? -1 : 1;
            t -= sign * (Integer.parseInt(z.substring(1, 3)) * 60L + Integer.parseInt(z.substring(3))) * 60000L;
        }
        return t;
    }

    /** Counts the bytes read, for the progress bar. */
    private static final class Counting extends FilterInputStream {
        long count;
        Counting(InputStream in) { super(in); }
        @Override public int read() throws IOException { int b = super.read(); if (b >= 0) count++; return b; }
        @Override public int read(byte[] b, int off, int len) throws IOException { int n = super.read(b, off, len); if (n > 0) count += n; return n; }
    }

    static final class Result { int programmes; int channels; List<String> errors = new ArrayList<>(); }

    /**
     * Reads every guide in `urls` into a new database, then swaps it in. Programmes outside
     * [from, to] and channels the playlist does not have are skipped.
     */
    static Result build(Context ctx, List<String> urls, Set<String> wantedIds, Set<String> wantedNames,
                        long offsetMs, long from, long to, int maxDesc, Opener opener, Progress progress) throws Exception {
        File tmp = new File(ctx.getFilesDir(), "guide-new.db");
        //noinspection ResultOfMethodCallIgnored
        tmp.delete();
        SQLiteDatabase out = SQLiteDatabase.openOrCreateDatabase(tmp, null);
        Result res = new Result();
        // id -> first display name, for every guide channel (lets the viewer match a channel by hand).
        LinkedHashMap<String, String> displayNames = new LinkedHashMap<>();
        HashMap<String, String> ids = new HashMap<>();          // lower-case id -> id
        HashMap<String, String> names = new HashMap<>();        // wanted match key -> id ("" = two channels share it)
        HashMap<String, Integer> counts = new HashMap<>();      // id -> programmes kept
        Set<String> keep = new HashSet<>();
        try {
            // PRAGMAs that answer with a row must go through rawQuery; execSQL refuses them.
            try (Cursor c = out.rawQuery("PRAGMA journal_mode=OFF", null)) { c.moveToFirst(); } catch (Exception ignored) {}
            try (Cursor c = out.rawQuery("PRAGMA synchronous=OFF", null)) { c.moveToFirst(); } catch (Exception ignored) {}
            out.execSQL("CREATE TABLE p (ch TEXT NOT NULL, s INTEGER NOT NULL, e INTEGER NOT NULL, t TEXT, d TEXT, st TEXT, ep TEXT, cat TEXT, img TEXT, rt TEXT)");
            out.beginTransaction();
            SQLiteStatement ins = out.compileStatement("INSERT INTO p (ch, s, e, t, d, st, ep, cat, img, rt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            for (int f = 0; f < urls.size(); f++) {
                String url = urls.get(f);
                Counting counting = null;
                long total = 0;
                try {
                    Opened o = opener.open(url);
                    total = o.length;
                    counting = new Counting(o.in);
                    BufferedInputStream buf = new BufferedInputStream(counting, 1 << 16);
                    buf.mark(4);
                    int b0 = buf.read(), b1 = buf.read();
                    buf.reset();
                    InputStream in = (b0 == 0x1f && b1 == 0x8b) ? new BufferedInputStream(new GZIPInputStream(buf, 1 << 16), 1 << 16) : buf;

                    XmlPullParser x = Xml.newPullParser();
                    try { x.setFeature("http://xmlpull.org/v1/doc/features.html#relaxed", true); } catch (Exception ignored) {}
                    x.setInput(in, null);
                    String channel = null;
                    List<String> chNames = new ArrayList<>();
                    long lastTick = 0;
                    int ev;
                    while ((ev = x.next()) != XmlPullParser.END_DOCUMENT) {
                        if (ev == XmlPullParser.START_TAG) {
                            String tag = x.getName();
                            if ("programme".equals(tag)) {
                                String ch = x.getAttributeValue(null, "channel");
                                long s = xmltvDate(x.getAttributeValue(null, "start"));
                                long e = xmltvDate(x.getAttributeValue(null, "stop"));
                                boolean wanted = ch != null && s != Long.MIN_VALUE && e != Long.MIN_VALUE
                                        && (keep.contains(ch) || wantedIds.contains(ch.toLowerCase(Locale.ROOT)));
                                if (wanted) { s += offsetMs; e += offsetMs; }
                                if (!wanted || e <= from || s >= to || e <= s) { skip(x); continue; }
                                String title = null, desc = null, sub = null, ep = null, cat = null, img = null, rating = null;
                                int depth = x.getDepth();
                                while ((ev = x.next()) != XmlPullParser.END_DOCUMENT && !(ev == XmlPullParser.END_TAG && x.getDepth() == depth)) {
                                    if (ev != XmlPullParser.START_TAG) continue;
                                    String t = x.getName();
                                    if ("title".equals(t) && title == null) title = text(x);
                                    else if ("desc".equals(t) && desc == null) desc = text(x);
                                    else if ("sub-title".equals(t) && sub == null) sub = text(x);
                                    else if ("category".equals(t) && cat == null) cat = text(x);
                                    else if ("episode-num".equals(t)) {
                                        String sys = x.getAttributeValue(null, "system");
                                        String v = text(x);
                                        String label = "xmltv_ns".equals(sys) ? episodeLabel(v) : v;
                                        if (label != null && !label.isEmpty() && (ep == null || "xmltv_ns".equals(sys))) ep = label;
                                    } else if ("icon".equals(t) && img == null) { img = x.getAttributeValue(null, "src"); skip(x); }
                                    else if ("rating".equals(t) && rating == null) {
                                        int rd = x.getDepth(), rev;
                                        while ((rev = x.next()) != XmlPullParser.END_DOCUMENT && !(rev == XmlPullParser.END_TAG && x.getDepth() == rd)) {
                                            if (rev == XmlPullParser.START_TAG && "value".equals(x.getName())) rating = text(x);
                                        }
                                    }
                                    else skip(x);
                                }
                                if (desc != null && desc.length() > maxDesc) desc = desc.substring(0, maxDesc - 1).trim() + "…";
                                ins.bindString(1, ch);
                                ins.bindLong(2, s);
                                ins.bindLong(3, e);
                                ins.bindString(4, title == null || title.isEmpty() ? "Untitled" : title);
                                ins.bindString(5, desc == null ? "" : desc);
                                ins.bindString(6, sub == null ? "" : sub);
                                ins.bindString(7, ep == null ? "" : ep);
                                ins.bindString(8, cat == null ? "" : cat);
                                ins.bindString(9, img == null ? "" : img);
                                ins.bindString(10, rating == null ? "" : rating);
                                ins.executeInsert();
                                ins.clearBindings();
                                Integer n = counts.get(ch);
                                counts.put(ch, n == null ? 1 : n + 1);
                                ids.put(ch.toLowerCase(Locale.ROOT), ch);
                                res.programmes++;
                            } else if ("channel".equals(tag)) {
                                channel = x.getAttributeValue(null, "id");
                                chNames.clear();
                            } else if ("display-name".equals(tag) && channel != null) {
                                String n = text(x);
                                if (!n.isEmpty()) chNames.add(n);
                            }
                        } else if (ev == XmlPullParser.END_TAG && "channel".equals(x.getName()) && channel != null) {
                            String id = channel;
                            ids.put(id.toLowerCase(Locale.ROOT), id);
                            if (!displayNames.containsKey(id)) displayNames.put(id, chNames.isEmpty() ? id : chNames.get(0));
                            if (wantedIds.contains(id.toLowerCase(Locale.ROOT))) keep.add(id);
                            for (String n : chNames) {
                                String k = matchKey(n);
                                if (k.isEmpty() || !wantedNames.contains(k)) continue;
                                keep.add(id);
                                String prev = names.get(k);
                                names.put(k, prev == null || prev.equals(id) ? id : "");
                            }
                            channel = null;
                        }
                        long now = System.currentTimeMillis();
                        if (now - lastTick > 300) {
                            lastTick = now;
                            progress.update(counting.count, total, res.programmes, f, urls.size());
                        }
                    }
                } catch (Exception e) {
                    // Keep whatever was read before the guide broke off.
                    res.errors.add(e.getClass().getSimpleName() + ": " + e.getMessage());
                } finally {
                    if (counting != null) { try { counting.close(); } catch (Exception ignored) {} }
                    progress.update(counting == null ? 0 : counting.count, total, res.programmes, f, urls.size());
                }
            }
            out.setTransactionSuccessful();
            out.endTransaction();
            out.execSQL("CREATE INDEX px ON p (ch, s)");
        } catch (Exception e) {
            try { if (out.inTransaction()) out.endTransaction(); } catch (Exception ignored) {}
            out.close();
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            throw e;
        }
        out.close();
        res.channels = counts.size();

        // Index for the web layer: which guide ids exist, which have programmes, and name matches.
        File idxTmp = new File(ctx.getFilesDir(), "guide-index.tmp");
        try (JsonWriter w = new JsonWriter(new OutputStreamWriter(new FileOutputStream(idxTmp), StandardCharsets.UTF_8))) {
            w.beginObject();
            w.name("at").value(System.currentTimeMillis());
            w.name("ids").beginArray();
            for (Map.Entry<String, String> en : ids.entrySet()) w.beginArray().value(en.getKey()).value(en.getValue()).endArray();
            w.endArray();
            w.name("names").beginArray();
            for (Map.Entry<String, String> en : names.entrySet()) {
                w.beginArray().value(en.getKey());
                if (en.getValue().isEmpty()) w.nullValue(); else w.value(en.getValue());
                w.endArray();
            }
            w.endArray();
            w.name("displayNames").beginArray();
            for (Map.Entry<String, String> en : displayNames.entrySet()) w.beginArray().value(en.getKey()).value(en.getValue()).endArray();
            w.endArray();
            w.name("has").beginArray();
            for (String id : counts.keySet()) w.value(id);
            w.endArray();
            w.endObject();
        }
        synchronized (LOCK) {
            if (db != null) { db.close(); db = null; }
            File target = dbFile(ctx);
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            if (!tmp.renameTo(target)) throw new IOException("Could not save the guide");
            File idx = indexFile(ctx);
            //noinspection ResultOfMethodCallIgnored
            idx.delete();
            if (!idxTmp.renameTo(idx)) throw new IOException("Could not save the guide index");
        }
        return res;
    }

    /** xmltv_ns "1.4.0/1" (zero-based season.episode.part) -> "S2 E5". */
    static String episodeLabel(String v) {
        if (v == null) return null;
        String[] parts = v.trim().split("\\.", -1);
        StringBuilder sb = new StringBuilder();
        try {
            if (parts.length > 0 && !parts[0].trim().isEmpty()) sb.append("S").append(Integer.parseInt(parts[0].split("/")[0].trim()) + 1);
            if (parts.length > 1 && !parts[1].trim().isEmpty()) { if (sb.length() > 0) sb.append(' '); sb.append("E").append(Integer.parseInt(parts[1].split("/")[0].trim()) + 1); }
        } catch (NumberFormatException e) { return null; }
        return sb.toString();
    }

    private static String text(XmlPullParser x) throws Exception {
        StringBuilder sb = new StringBuilder();
        int depth = x.getDepth(), ev;
        while ((ev = x.next()) != XmlPullParser.END_DOCUMENT && !(ev == XmlPullParser.END_TAG && x.getDepth() == depth)) {
            if (ev == XmlPullParser.TEXT) sb.append(x.getText());
        }
        return sb.toString().trim();
    }

    private static void skip(XmlPullParser x) throws Exception {
        int depth = x.getDepth(), ev;
        while ((ev = x.next()) != XmlPullParser.END_DOCUMENT && !(ev == XmlPullParser.END_TAG && x.getDepth() == depth)) { /* skip */ }
    }

    /** Programmes for these guide ids between `from` and `to`: { id: [[start, stop, title, desc], …] }. */
    static String query(Context ctx, List<String> chs, long from, long to) {
        SQLiteDatabase d = open(ctx);
        StringBuilder out = new StringBuilder("{");
        if (d == null || chs.isEmpty()) return out.append('}').toString();
        boolean firstCh = true;
        synchronized (LOCK) {
            for (int i = 0; i < chs.size(); i += 100) {
                List<String> part = chs.subList(i, Math.min(chs.size(), i + 100));
                StringBuilder q = new StringBuilder("SELECT ch, s, e, t, d, st, ep, cat, img, rt FROM p WHERE e > ? AND s < ? AND ch IN (");
                String[] args = new String[part.size() + 2];
                args[0] = Long.toString(from);
                args[1] = Long.toString(to);
                for (int j = 0; j < part.size(); j++) { q.append(j == 0 ? "?" : ",?"); args[j + 2] = part.get(j); }
                q.append(") ORDER BY ch, s");
                String cur = null;
                long lastStart = Long.MIN_VALUE;
                try (Cursor c = d.rawQuery(q.toString(), args)) {
                    while (c.moveToNext()) {
                        String ch = c.getString(0);
                        long s = c.getLong(1);
                        if (!ch.equals(cur)) {
                            if (cur != null) out.append("]");
                            if (!firstCh) out.append(',');
                            firstCh = false;
                            out.append(JSONObjectQuote(ch)).append(":[");
                            cur = ch;
                            lastStart = Long.MIN_VALUE;
                        } else if (s == lastStart) {
                            continue; // the same programme from two guides
                        } else {
                            out.append(',');
                        }
                        lastStart = s;
                        JSONArray row = new JSONArray();
                        row.put(s).put(c.getLong(2)).put(c.getString(3)).put(c.getString(4)).put(c.getString(5)).put(c.getString(6)).put(c.getString(7)).put(c.getString(8)).put(c.getString(9));
                        out.append(row.toString());
                    }
                }
                if (cur != null) out.append("]");
            }
        }
        return out.append('}').toString();
    }

    /** Programmes whose title or episode title contains `q`, from `from` on, soonest first. */
    static String search(Context ctx, String q, long from, int limit) {
        SQLiteDatabase d = open(ctx);
        JSONArray out = new JSONArray();
        if (d == null || q == null || q.trim().length() < 2) return out.toString();
        String like = "%" + q.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
        synchronized (LOCK) {
            try (Cursor c = d.rawQuery("SELECT ch, s, e, t, d, st, ep, cat, img, rt FROM p WHERE e > ? AND (t LIKE ? ESCAPE '\\' OR st LIKE ? ESCAPE '\\') ORDER BY s LIMIT ?",
                    new String[]{Long.toString(from), like, like, Integer.toString(limit)})) {
                while (c.moveToNext()) {
                    JSONArray row = new JSONArray();
                    row.put(c.getString(0)).put(c.getLong(1)).put(c.getLong(2)).put(c.getString(3)).put(c.getString(4))
                       .put(c.getString(5)).put(c.getString(6)).put(c.getString(7)).put(c.getString(8)).put(c.getString(9));
                    out.put(row);
                }
            }
        }
        return out.toString();
    }

    private static String JSONObjectQuote(String s) { return org.json.JSONObject.quote(s); }

    static boolean exists(Context ctx) { return dbFile(ctx).exists() && indexFile(ctx).exists(); }
}
