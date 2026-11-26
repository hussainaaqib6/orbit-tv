package tv.orbit.player;

import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.util.Log;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.common.text.CueGroup;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.ui.CaptionStyleCompat;
import androidx.media3.ui.SubtitleView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Collections;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.GZIPInputStream;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Orbit's video engine on Android, Android TV and Fire TV.
 *
 * ExoPlayer draws onto a SurfaceView placed behind the WebView; the WebView is made transparent so
 * the web UI (controls, menus, subtitles) sits on top of the picture. The surface can fill the screen
 * or sit in a rectangle (the Live TV preview box).
 *
 * The plugin also forwards remote keys the WebView never receives (Back, Menu, media, channel and
 * colour keys) to the web layer as "key" events.
 */
@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "OrbitPlayer")
public class OrbitPlayerPlugin extends Plugin {

    static OrbitPlayerPlugin instance;

    private final Handler main = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private FrameLayout container;
    private FrameLayout frame;
    private SurfaceView surface;
    /** Subtitles that come with the stream, drawn natively over the picture (handles image subtitles too). */
    private SubtitleView subtitles;
    /**
     * A black cover over the picture until the new video's first frame is drawn. Without it, the last
     * frame of whatever played before stays on the surface while the next video loads.
     */
    private View shutter;
    private float subtitleScale = 1f;
    private boolean subtitleBackground = true;
    private boolean subtitleRaised = false;

    private String url;
    private Map<String, String> headers = new HashMap<>();
    private boolean live;
    private boolean forceHls;
    private boolean triedOtherContainer;
    private int reconnects;
    private int[] rect; // x, y, w, h in WebView pixels; null = full screen
    private String aspect = "fit";
    private float zoom = 1f;
    private int videoW, videoH;
    private float pixelRatio = 1f;
    private Tracks lastTracks = Tracks.EMPTY;

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (player == null) return;
            JSObject t = new JSObject();
            long dur = player.getDuration();
            t.put("position", Math.max(0, player.getCurrentPosition()) / 1000.0);
            t.put("duration", dur == C.TIME_UNSET ? 0 : dur / 1000.0);
            t.put("buffered", player.getBufferedPosition() / 1000.0);
            t.put("live", player.isCurrentMediaItemLive());
            t.put("seekable", player.isCurrentMediaItemSeekable() && dur != C.TIME_UNSET && dur > 0);
            notifyListeners("time", t);
            // Full screen needs a smooth seek bar; the preview box only needs the odd update.
            main.postDelayed(this, rect == null ? 250 : 1000);
        }
    };

    @Override
    public void load() {
        instance = this;
        getActivity().runOnUiThread(() -> {
            WebView wv = getBridge().getWebView();
            wv.setBackgroundColor(Color.TRANSPARENT);
            View parent = (View) wv.getParent();
            if (parent != null) parent.setBackgroundColor(Color.TRANSPARENT);

            ViewGroup content = getActivity().findViewById(android.R.id.content);
            container = new FrameLayout(getContext());
            container.setBackgroundColor(Color.BLACK);
            container.setVisibility(View.GONE);
            content.addView(container, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

            frame = new FrameLayout(getContext());
            frame.setClipChildren(true);
            container.addView(frame, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

            surface = new SurfaceView(getContext());
            frame.addView(surface, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER));

            shutter = new View(getContext());
            shutter.setBackgroundColor(Color.BLACK);
            container.addView(shutter, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

            subtitles = new SubtitleView(getContext());
            container.addView(subtitles, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            styleSubtitles();
            container.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> { if (r - l != or - ol || b - t != ob - ot) layoutVideo(); });

            // Phone back gestures arrive here rather than as key events.
            getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    if (hasListeners("key")) {
                        sendKey("BACK", "down", 0);
                        sendKey("BACK", "up", 0);
                    } else {
                        getActivity().finish();
                    }
                }
            });
        });
    }

    /* ------------------------------ remote keys ------------------------------ */

    /** Key codes the web layer handles itself but the WebView would swallow or never receive. */
    static boolean isForwarded(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_MENU:
            case KeyEvent.KEYCODE_INFO:
            case KeyEvent.KEYCODE_GUIDE:
            case KeyEvent.KEYCODE_SETTINGS:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_STOP:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            case KeyEvent.KEYCODE_MEDIA_REWIND:
            case KeyEvent.KEYCODE_MEDIA_NEXT:
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
            case KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD:
            case KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD:
            case KeyEvent.KEYCODE_MEDIA_STEP_FORWARD:
            case KeyEvent.KEYCODE_MEDIA_STEP_BACKWARD:
            case KeyEvent.KEYCODE_MEDIA_AUDIO_TRACK:
            case KeyEvent.KEYCODE_CHANNEL_UP:
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
            case KeyEvent.KEYCODE_PAGE_UP:
            case KeyEvent.KEYCODE_PAGE_DOWN:
            case KeyEvent.KEYCODE_PROG_RED:
            case KeyEvent.KEYCODE_PROG_GREEN:
            case KeyEvent.KEYCODE_PROG_YELLOW:
            case KeyEvent.KEYCODE_PROG_BLUE:
            case KeyEvent.KEYCODE_CAPTIONS:
            case KeyEvent.KEYCODE_TV_ZOOM_MODE:
            case KeyEvent.KEYCODE_BOOKMARK:
            case KeyEvent.KEYCODE_SEARCH:
                return true;
            default:
                return false;
        }
    }

    /** Called by MainActivity. Returns true if the key was handed to the web layer. */
    boolean onKey(KeyEvent e) {
        if (!isForwarded(e.getKeyCode()) || !hasListeners("key")) return false;
        String name = KeyEvent.keyCodeToString(e.getKeyCode()).replace("KEYCODE_", "");
        if (e.getAction() == KeyEvent.ACTION_DOWN) sendKey(name, "down", e.getRepeatCount());
        else if (e.getAction() == KeyEvent.ACTION_UP) sendKey(name, "up", 0);
        return true;
    }

    private void sendKey(String key, String action, int repeat) {
        JSObject o = new JSObject();
        o.put("key", key);
        o.put("action", action);
        o.put("repeat", repeat);
        notifyListeners("key", o);
    }

    /* ------------------------------ downloads ------------------------------ */

    private final ExecutorService downloads = Executors.newFixedThreadPool(2);

    /**
     * Downloads a URL into the app's cache and returns the file path. Big playlists (Xtream film and
     * series lists can be tens of megabytes) are read by the WebView straight from that file, instead of
     * being parsed natively and copied across the bridge, which can stall a Fire TV Stick for minutes.
     */
    @PluginMethod
    public void download(PluginCall call) {
        String u = call.getString("url");
        String name = call.getString("name", "download");
        JSObject hs = call.getObject("headers", new JSObject());
        int timeout = call.getInt("timeoutMs", 60000);
        if (u == null) { call.reject("No address"); return; }
        downloads.execute(() -> {
            HttpURLConnection c = null;
            try {
                URL target = new URL(u);
                int redirects = 0;
                while (true) {
                    c = (HttpURLConnection) target.openConnection();
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(timeout);
                    c.setInstanceFollowRedirects(false);
                    c.setRequestProperty("User-Agent", "VLC/3.0.21 LibVLC/3.0.21");
                    c.setRequestProperty("Accept-Encoding", "gzip");
                    Iterator<String> keys = hs.keys();
                    while (keys.hasNext()) { String k = keys.next(); c.setRequestProperty(k, hs.getString(k)); }
                    int code = c.getResponseCode();
                    // Follow redirects, including http <-> https, which HttpURLConnection will not do itself.
                    if (code >= 300 && code < 400 && c.getHeaderField("Location") != null && redirects++ < 5) {
                        target = new URL(target, c.getHeaderField("Location"));
                        c.disconnect();
                        continue;
                    }
                    break;
                }
                int status = c.getResponseCode();
                File out = new File(getContext().getCacheDir(), "orbit-" + name.replaceAll("[^A-Za-z0-9_-]", "_"));
                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                if (in != null && "gzip".equalsIgnoreCase(c.getContentEncoding())) in = new GZIPInputStream(in);
                long size = 0;
                try (OutputStream os = new FileOutputStream(out)) {
                    if (in != null) {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) { os.write(buf, 0, n); size += n; }
                        in.close();
                    }
                }
                JSObject r = new JSObject();
                r.put("status", status);
                r.put("path", out.getAbsolutePath());
                r.put("size", size);
                r.put("contentType", c.getContentType());
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getClass().getSimpleName() + ": " + e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    /* ------------------------------ phone pairing ------------------------------ */
    // While the "add a playlist" screen is open, the TV serves one small page on the home network.
    // The QR code points a phone at it; the viewer types their provider details on the phone, and they
    // arrive here as a "pairing" event. The address contains a random token, the server answers nothing
    // else, it only accepts a few small requests, and it stops as soon as the screen closes.

    private ServerSocket pairServer;
    private String pairToken;
    private String pairPage = "";

    @PluginMethod
    public void startPairing(PluginCall call) {
        String page = call.getString("page", "");
        stopPairingServer();
        try {
            String ip = lanAddress();
            if (ip == null) { call.reject("This device is not connected to a network."); return; }
            byte[] rnd = new byte[9];
            new SecureRandom().nextBytes(rnd);
            StringBuilder tok = new StringBuilder();
            for (byte b : rnd) tok.append(String.format(Locale.ROOT, "%02x", b));
            pairToken = tok.toString();
            pairPage = page;
            ServerSocket server = new ServerSocket(0, 8);
            pairServer = server;
            Thread t = new Thread(() -> serve(server), "orbit-pairing");
            t.setDaemon(true);
            t.start();
            JSObject r = new JSObject();
            r.put("url", "http://" + ip + ":" + server.getLocalPort() + "/" + pairToken);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not start: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopPairing(PluginCall call) {
        stopPairingServer();
        call.resolve();
    }

    private void stopPairingServer() {
        if (pairServer != null) { try { pairServer.close(); } catch (Exception ignored) {} }
        pairServer = null;
        pairToken = null;
    }

    private static String lanAddress() throws Exception {
        String fallback = null;
        for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!nif.isUp() || nif.isLoopback()) continue;
            for (InetAddress a : Collections.list(nif.getInetAddresses())) {
                if (!(a instanceof Inet4Address) || a.isLoopbackAddress()) continue;
                if (a.isSiteLocalAddress()) return a.getHostAddress();
                if (fallback == null) fallback = a.getHostAddress();
            }
        }
        return fallback;
    }

    private void serve(ServerSocket server) {
        int handled = 0;
        while (!server.isClosed() && handled++ < 500) {
            try (Socket sock = server.accept()) {
                sock.setSoTimeout(8000);
                BufferedReader in = new BufferedReader(new InputStreamReader(sock.getInputStream(), StandardCharsets.UTF_8));
                String line = in.readLine();
                if (line == null) continue;
                String[] req = line.split(" ");
                int length = 0;
                for (String h; (h = in.readLine()) != null && !h.isEmpty(); ) {
                    if (h.toLowerCase(Locale.ROOT).startsWith("content-length:")) length = Integer.parseInt(h.substring(15).trim());
                }
                String path = req.length > 1 ? req[1].split("\\?")[0] : "";
                String token = pairToken;
                boolean ok = token != null && path.equals("/" + token);
                OutputStream out = sock.getOutputStream();
                if (!ok) { respond(out, 404, "text/plain", "Not found"); continue; }
                if ("POST".equals(req[0]) && length > 0 && length < 16384) {
                    char[] body = new char[length];
                    int read = 0;
                    while (read < length) { int n = in.read(body, read, length - read); if (n < 0) break; read += n; }
                    JSObject fields = new JSObject();
                    for (String pair : new String(body, 0, read).split("&")) {
                        int eq = pair.indexOf('=');
                        if (eq <= 0) continue;
                        String k = URLDecoder.decode(pair.substring(0, eq), "UTF-8");
                        String v = URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
                        if (k.length() <= 20 && v.length() <= 4000) fields.put(k, v);
                    }
                    notifyListeners("pairing", fields);
                    respond(out, 200, "text/html; charset=utf-8", pairPage.replace("<!--STATE-->", "sent"));
                } else {
                    respond(out, 200, "text/html; charset=utf-8", pairPage.replace("<!--STATE-->", "form"));
                }
            } catch (Exception ignored) {
                // A dropped or slow connection: wait for the next one.
            }
        }
    }

    private static void respond(OutputStream out, int code, String type, String body) throws Exception {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + code + (code == 200 ? " OK" : " Not Found") + "\r\nContent-Type: " + type
                + "\r\nContent-Length: " + b.length + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(b);
        out.flush();
    }

    @PluginMethod
    public void exitApp(PluginCall call) {
        call.resolve();
        main.post(() -> getActivity().finish());
    }

    /* ------------------------------ playback ------------------------------ */

    private ExoPlayer ensurePlayer() {
        if (player != null) return player;
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(getContext())
                .setEnableDecoderFallback(true)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_OFF);
        DefaultLoadControl load = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(15000, 50000, 1500, 3000)
                .build();
        player = new ExoPlayer.Builder(getContext(), renderers).setLoadControl(load).build();
        player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
        player.setVideoSurfaceView(surface);
        // Embedded subtitles are off until the viewer picks a track.
        player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                .setPreferredAudioLanguage(Locale.getDefault().getLanguage())
                .build());
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) reconnects = 0;
                emitState();
            }

            @Override
            public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                emitState();
            }

            @Override
            public void onRenderedFirstFrame() {
                if (shutter != null) shutter.setVisibility(View.GONE);
            }

            @Override
            public void onVideoSizeChanged(@NonNull VideoSize size) {
                videoW = size.width;
                videoH = size.height;
                pixelRatio = size.pixelWidthHeightRatio > 0 ? size.pixelWidthHeightRatio : 1f;
                layoutVideo();
                JSObject o = new JSObject();
                o.put("width", size.width);
                o.put("height", size.height);
                notifyListeners("videoSize", o);
            }

            @Override
            public void onTracksChanged(@NonNull Tracks tracks) {
                lastTracks = tracks;
                emitTracks();
            }

            @Override
            public void onCues(@NonNull CueGroup cueGroup) {
                if (subtitles != null) subtitles.setCues(cueGroup.cues);
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException e) {
                handleError(e);
            }
        });
        return player;
    }

    @PluginMethod
    public void load(PluginCall call) {
        String u = call.getString("url");
        if (u == null || u.isEmpty()) { call.reject("No stream address"); return; }
        boolean isLive = Boolean.TRUE.equals(call.getBoolean("live", false));
        double start = call.getDouble("startPosition", 0.0);
        Map<String, String> h = new HashMap<>();
        JSObject hs = call.getObject("headers", new JSObject());
        Iterator<String> keys = hs.keys();
        while (keys.hasNext()) { String k = keys.next(); h.put(k, hs.getString(k)); }
        JSObject r = call.getObject("rect", null);
        main.post(() -> {
            url = u;
            headers = h;
            live = isLive;
            forceHls = isHlsUrl(u);
            triedOtherContainer = false;
            reconnects = 0;
            rect = rectFrom(r);
            shutter.setVisibility(View.VISIBLE);
            container.setVisibility(View.VISIBLE);
            layoutVideo();
            prepare(start);
            call.resolve();
        });
    }

    private static boolean isHlsUrl(String u) {
        String path = Uri.parse(u).getPath();
        return (path != null && path.toLowerCase(Locale.ROOT).endsWith(".m3u8")) || u.toLowerCase(Locale.ROOT).contains("m3u8");
    }

    private void prepare(double startSec) {
        ExoPlayer p = ensurePlayer();
        String ua = headers.containsKey("User-Agent") ? headers.get("User-Agent") : "VLC/3.0.21 LibVLC/3.0.21";
        Map<String, String> extra = new HashMap<>(headers);
        extra.remove("User-Agent");
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent(ua)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(30000)
                .setDefaultRequestProperties(extra);
        // IPTV MPEG-TS often starts mid-GOP or has no IDR flags; these flags make it start reliably.
        int tsFlags = DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES | DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS;
        MediaItem item = new MediaItem.Builder().setUri(url).setLiveConfiguration(new MediaItem.LiveConfiguration.Builder().setTargetOffsetMs(live ? 8000 : C.TIME_UNSET).build()).build();
        MediaSource source;
        if (forceHls) {
            source = new HlsMediaSource.Factory(http)
                    .setExtractorFactory(new DefaultHlsExtractorFactory(tsFlags, true))
                    .setAllowChunklessPreparation(true)
                    .createMediaSource(item);
        } else {
            DefaultExtractorsFactory ex = new DefaultExtractorsFactory()
                    .setTsExtractorFlags(tsFlags)
                    .setConstantBitrateSeekingEnabled(true);
            source = new ProgressiveMediaSource.Factory(http, ex).createMediaSource(item);
        }
        p.setMediaSource(source, startSec > 0 ? (long) (startSec * 1000) : C.TIME_UNSET);
        p.setPlaybackParameters(PlaybackParameters.DEFAULT);
        p.prepare();
        p.setPlayWhenReady(true);
        main.removeCallbacks(ticker);
        main.post(ticker);
    }

    private void handleError(PlaybackException e) {
        int code = e.errorCode;
        // Live HLS fell behind its window: jump back to the live edge.
        if (code == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW && player != null) {
            player.seekToDefaultPosition();
            player.prepare();
            return;
        }
        // An address without an extension may be HLS (or not): try the other container once.
        if (!triedOtherContainer && (code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED
                || code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED
                || code == PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED)) {
            triedOtherContainer = true;
            forceHls = !forceHls;
            prepare(0);
            return;
        }
        Integer http = null;
        Throwable cause = e.getCause();
        if (cause instanceof HttpDataSource.InvalidResponseCodeException) {
            http = ((HttpDataSource.InvalidResponseCodeException) cause).responseCode;
        }
        // Providers drop live connections now and then: reconnect a few times before giving up.
        boolean network = code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
                || code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT
                || code == PlaybackException.ERROR_CODE_IO_UNSPECIFIED
                || (http != null && http >= 500);
        if (live && network && reconnects < 3) {
            reconnects++;
            main.postDelayed(() -> { if (player != null && url != null) prepare(0); }, 1500L * reconnects);
            return;
        }
        String msg;
        if (http != null) {
            msg = http == 401 || http == 403 ? "The provider refused this stream (" + http + "). Your account may be in use on another device or expired."
                    : http == 404 ? "This channel or video is not available from the provider (404)."
                    : "The server returned an error (" + http + ").";
        } else if (code >= 4000 && code < 5000) {
            msg = "This device cannot decode this stream.";
        } else if (code >= 3000 && code < 4000) {
            msg = "The stream format is not supported.";
        } else if (code >= 2000 && code < 3000) {
            msg = "Could not connect to the stream.";
        } else {
            msg = "The stream could not be played.";
        }
        JSObject o = new JSObject();
        o.put("message", msg);
        o.put("code", e.getErrorCodeName());
        if (http != null) o.put("http", http);
        notifyListeners("error", o);
    }

    private void emitState() {
        if (player == null) return;
        String s;
        switch (player.getPlaybackState()) {
            case Player.STATE_BUFFERING: s = "buffering"; break;
            case Player.STATE_READY: s = "ready"; break;
            case Player.STATE_ENDED: s = "ended"; break;
            default: s = "idle";
        }
        JSObject o = new JSObject();
        o.put("state", s);
        o.put("playing", player.getPlayWhenReady());
        notifyListeners("state", o);
    }

    private void emitTracks() {
        JSArray arr = new JSArray();
        List<Tracks.Group> groups = lastTracks.getGroups();
        int audioN = 0, textN = 0;
        for (int g = 0; g < groups.size(); g++) {
            Tracks.Group group = groups.get(g);
            int type = group.getType();
            if (type != C.TRACK_TYPE_AUDIO && type != C.TRACK_TYPE_TEXT) continue;
            for (int t = 0; t < group.length; t++) {
                if (!group.isTrackSupported(t)) continue;
                Format f = group.getTrackFormat(t);
                boolean audio = type == C.TRACK_TYPE_AUDIO;
                String lang = f.language == null || "und".equals(f.language) ? "" : f.language;
                String label = f.label != null ? f.label
                        : !lang.isEmpty() ? new Locale(lang).getDisplayLanguage()
                        : (audio ? "Audio " + (++audioN) : "Subtitles " + (++textN));
                if (audio && f.channelCount > 0) label += f.channelCount >= 6 ? " · 5.1" : f.channelCount == 2 ? " · Stereo" : "";
                JSObject o = new JSObject();
                o.put("id", g + ":" + t);
                o.put("type", audio ? "audio" : "text");
                o.put("label", label);
                o.put("language", lang);
                o.put("selected", group.isTrackSelected(t));
                if (f.codecs != null) o.put("codec", f.codecs);
                arr.put(o);
            }
        }
        JSObject out = new JSObject();
        out.put("tracks", arr);
        notifyListeners("tracks", out);
    }

    @PluginMethod
    public void selectTrack(PluginCall call) {
        String type = call.getString("type", "audio");
        String id = call.getString("id");
        main.post(() -> {
            if (player == null) { call.resolve(); return; }
            int trackType = "text".equals(type) ? C.TRACK_TYPE_TEXT : C.TRACK_TYPE_AUDIO;
            TrackSelectionParameters.Builder b = player.getTrackSelectionParameters().buildUpon();
            if (id == null) {
                b.setTrackTypeDisabled(trackType, true).clearOverridesOfType(trackType);
            } else {
                String[] parts = id.split(":");
                int g = Integer.parseInt(parts[0]), t = Integer.parseInt(parts[1]);
                List<Tracks.Group> groups = lastTracks.getGroups();
                if (g < groups.size()) {
                    b.setTrackTypeDisabled(trackType, false)
                            .setOverrideForType(new TrackSelectionOverride(groups.get(g).getMediaTrackGroup(), t));
                }
            }
            player.setTrackSelectionParameters(b.build());
            call.resolve();
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        main.post(() -> {
            if (player != null) {
                if (player.getPlaybackState() == Player.STATE_ENDED) player.seekTo(0);
                if (player.getPlaybackState() == Player.STATE_IDLE && url != null) prepare(0);
                player.setPlayWhenReady(true);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        main.post(() -> { if (player != null) player.setPlayWhenReady(false); call.resolve(); });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            main.removeCallbacks(ticker);
            if (player != null) { player.stop(); player.clearMediaItems(); }
            if (subtitles != null) subtitles.setCues(java.util.Collections.emptyList());
            url = null;
            videoW = videoH = 0;
            if (shutter != null) shutter.setVisibility(View.VISIBLE);
            if (container != null) container.setVisibility(View.GONE);
            call.resolve();
        });
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        double pos = call.getDouble("position", 0.0);
        main.post(() -> { if (player != null) player.seekTo((long) (pos * 1000)); call.resolve(); });
    }

    @PluginMethod
    public void setSpeed(PluginCall call) {
        float s = call.getFloat("speed", 1f);
        main.post(() -> { if (player != null) player.setPlaybackParameters(new PlaybackParameters(s)); call.resolve(); });
    }

    @PluginMethod
    public void setMuted(PluginCall call) {
        boolean m = Boolean.TRUE.equals(call.getBoolean("muted", false));
        main.post(() -> { if (player != null) player.setVolume(m ? 0f : 1f); call.resolve(); });
    }

    @PluginMethod
    public void setRect(PluginCall call) {
        JSObject r = call.getObject("rect", null);
        main.post(() -> { rect = rectFrom(r); layoutVideo(); call.resolve(); });
    }

    @PluginMethod
    public void setAspect(PluginCall call) {
        String mode = call.getString("mode", "fit");
        float z = call.getFloat("zoom", 1f);
        main.post(() -> { aspect = mode; zoom = z; layoutVideo(); call.resolve(); });
    }

    @PluginMethod
    public void setSubtitleStyle(PluginCall call) {
        float scale = call.getFloat("scale", 1f);
        boolean bg = Boolean.TRUE.equals(call.getBoolean("background", true));
        boolean raised = Boolean.TRUE.equals(call.getBoolean("raised", false));
        main.post(() -> { subtitleScale = scale; subtitleBackground = bg; subtitleRaised = raised; styleSubtitles(); call.resolve(); });
    }

    private void styleSubtitles() {
        if (subtitles == null) return;
        subtitles.setApplyEmbeddedStyles(true);
        subtitles.setApplyEmbeddedFontSizes(false);
        subtitles.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * 1.15f * subtitleScale);
        subtitles.setStyle(new CaptionStyleCompat(Color.WHITE, subtitleBackground ? 0xB3000000 : Color.TRANSPARENT, Color.TRANSPARENT,
                subtitleBackground ? CaptionStyleCompat.EDGE_TYPE_NONE : CaptionStyleCompat.EDGE_TYPE_OUTLINE, Color.BLACK, null));
        // Move up while the player controls are showing, so they don't cover the words.
        subtitles.setBottomPaddingFraction(subtitleRaised ? 0.3f : SubtitleView.DEFAULT_BOTTOM_PADDING_FRACTION);
    }

    /* ------------------------------ layout ------------------------------ */

    private static int[] rectFrom(JSObject r) {
        if (r == null || !r.has("width")) return null;
        return new int[] { r.optInt("x"), r.optInt("y"), r.optInt("width"), r.optInt("height") };
    }

    /** Places the frame (full screen or the preview rect) and sizes the surface for the aspect mode. */
    private void layoutVideo() {
        if (container == null || frame == null) return;
        int cw = container.getWidth(), ch = container.getHeight();
        if (cw == 0 || ch == 0) { container.post(this::layoutVideo); return; }

        // The rect is relative to the WebView, which may not start at the top of the window.
        int[] wvLoc = new int[2], cLoc = new int[2];
        getBridge().getWebView().getLocationInWindow(wvLoc);
        container.getLocationInWindow(cLoc);
        int fx = 0, fy = 0, fw = cw, fh = ch;
        if (rect != null) {
            fx = rect[0] + wvLoc[0] - cLoc[0];
            fy = rect[1] + wvLoc[1] - cLoc[1];
            fw = Math.max(1, rect[2]);
            fh = Math.max(1, rect[3]);
        }
        FrameLayout.LayoutParams flp = new FrameLayout.LayoutParams(fw, fh);
        flp.leftMargin = fx;
        flp.topMargin = fy;
        flp.gravity = Gravity.TOP | Gravity.START;
        frame.setLayoutParams(flp);
        FrameLayout.LayoutParams shp = new FrameLayout.LayoutParams(fw, fh);
        shp.leftMargin = fx;
        shp.topMargin = fy;
        shp.gravity = Gravity.TOP | Gravity.START;
        shutter.setLayoutParams(shp);
        Log.d("OrbitPlayer", "layout rect=" + (rect == null ? "full" : rect[0] + "," + rect[1] + " " + rect[2] + "x" + rect[3])
                + " frame=" + fx + "," + fy + " " + fw + "x" + fh + " container=" + cw + "x" + ch + " webview@" + wvLoc[0] + "," + wvLoc[1]);
        // Subtitles cover the same area as the picture, and are hidden in the small preview box.
        FrameLayout.LayoutParams slp = new FrameLayout.LayoutParams(fw, fh);
        slp.leftMargin = fx;
        slp.topMargin = fy;
        slp.gravity = Gravity.TOP | Gravity.START;
        subtitles.setLayoutParams(slp);
        subtitles.setVisibility(rect != null ? View.GONE : View.VISIBLE);

        // In the preview box the picture always fits; zoom and crop only apply full screen.
        String mode = rect != null ? "fit" : aspect;
        float z = rect != null ? 1f : zoom;
        float videoAspect = videoW > 0 && videoH > 0 ? videoW * pixelRatio / videoH : 16f / 9f;
        float boxAspect = (float) fw / fh;
        int sw, sh;
        switch (mode) {
            case "stretch":
                sw = fw; sh = fh; break;
            case "16:9":
            case "4:3": {
                float a = "16:9".equals(mode) ? 16f / 9f : 4f / 3f;
                if (boxAspect > a) { sh = fh; sw = Math.round(fh * a); } else { sw = fw; sh = Math.round(fw / a); }
                break;
            }
            case "fill":
                if (boxAspect > videoAspect) { sw = fw; sh = Math.round(fw / videoAspect); } else { sh = fh; sw = Math.round(fh * videoAspect); }
                break;
            default: // fit
                if (boxAspect > videoAspect) { sh = fh; sw = Math.round(fh * videoAspect); } else { sw = fw; sh = Math.round(fw / videoAspect); }
        }
        sw = Math.round(sw * z);
        sh = Math.round(sh * z);
        surface.setLayoutParams(new FrameLayout.LayoutParams(sw, sh, Gravity.CENTER));
    }

    /* ------------------------------ lifecycle ------------------------------ */

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (player != null) player.setPlayWhenReady(false);
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        main.removeCallbacks(ticker);
        downloads.shutdownNow();
        stopPairingServer();
        if (player != null) { player.release(); player = null; }
        if (instance == this) instance = null;
    }
}
