# Matrix TV

An IPTV player for **Fire TV Stick, Android TV, Android phones, iPhone/iPad** and desktop (Windows, macOS, Linux). Bring your own provider: Orbit plays the channels, films and series from your own Xtream Codes login, M3U playlist or MAC portal. It comes with no content of its own.

Version 2 is a rebuild. It has a remote-first interface built around a Home screen of big tiles (Live TV, TV Guide, Movies, Series), a native ExoPlayer engine on Android and Fire TV, and full player controls.

---

## What it does

**Live TV**
- Categories on the left with the channels as big logo tiles. Pick a tile and the mini screen plays it, with the category's channels listed beside it so you can switch while it plays; what's on now sits beside the mini screen and the schedule underneath. Left/Right switch category, Back returns to the tiles.
- Full screen with OK. Up/Down change channel, Left opens the channel list over the picture, and number keys jump to a channel. Yellow goes back to the last channel.
- Catch-up for Xtream servers and M3U `catchup` attributes. Hold OK on a channel and choose **Catch up**, or pick a past programme in the TV guide.

**TV guide**
- A grid that scrolls at the speed of the remote, 7 days back and 7 days ahead.
- Guides load automatically from Xtream, from MAC portals, and from an M3U's `x-tvg-url`. You can add extra XMLTV links.
- Channels are matched to the guide automatically. Ambiguous names are left unmatched rather than guessed, and you can choose a guide channel yourself (hold OK on a channel → **Choose guide channel**).

**Movies and series**
- A poster wall with categories, sorting (Yellow) and resume points.
- Film and series pages with plots, seasons and episodes. With a TMDB key you also get backdrops and cast.
- The next episode plays automatically.

**Player**
- Play/pause, a seek bar, skip back/forward (Left/Right, step adjustable), and Rewind/Fast-forward (30 s).
- Picture: Fit, Fill, Stretch, 16:9, 4:3, and zoom.
- Audio track choice, playback speed and stream info.
- **Subtitles:** tracks in the stream, OpenSubtitles search, or a file.
  - OpenSubtitles results are matched to the exact video file first (by its hash), so they line up.
  - Timing can be shifted in 0.1 s steps, and frame-rate drift (23.976 ↔ 25 fps) can be corrected. Size and background are adjustable.
- On Android and Fire TV, video plays through **ExoPlayer** with hardware decoding: MPEG-TS, HLS, HEVC, interlaced broadcasts, AC3/E-AC3 audio. If a live channel fails, Orbit tries the other stream format (TS ↔ HLS) by itself.

**Everywhere**
- Search across channels, films and series.
- Favourites, Continue watching and Recently watched.
- Playlists are cached, so the app opens instantly and refreshes in the background.

### Remote control

| Key | Browsing | Player |
|---|---|---|
| OK | Open / play | Show controls |
| Hold OK, Menu, Info | Options for the item (favourite, catch-up, guide match) | Options (live: channel list) |
| Back | Up one level → Home → leave (asks first) | Hide controls → close player |
| Left | Move | Channel list (live) / skip back (films) |
| Up / Down | Move | Change channel (live) |
| Left / Right (Live TV channel list) | Previous / next category | |
| Rewind / Fast-forward | Page up / down | ±30 s (films) / change channel (live) |
| Channel + / − | Page up / down | Change channel / next or previous episode |
| Number keys | Jump to a channel number | Jump to a channel number |
| Yellow | Change sort order | Last channel |
| Blue / Zoom | | Next picture mode |

On desktop: arrows and Enter, Escape for Back, Space for play/pause, right-click for options, F11 for full screen.

### Not in version 2 yet

The rebuild concentrates on doing the core well. These features from version 1 haven't been rebuilt yet:
- Plex, Jellyfin and Emby
- Multiview and the sports page
- Recording, downloads and the Orbit Server integration (the `server/` folder is unchanged but the app doesn't connect to it yet)
- Profiles and parental PINs
- Trakt and SIMKL
- Gemini live captions and Chromecast
- Guide reminders

---

## Get the app onto your devices

No coding tools are needed on your computer. GitHub builds the app for you.

### Android phone and Fire TV Stick

1. Open the **Actions** tab on GitHub. **Build Android & Fire TV app** runs on every push to `main` (about 6–8 minutes).
2. When it finishes, **OrbitTV.apk** appears under **Releases**.
3. **Phone:** open the Releases page on the phone, tap **OrbitTV.apk**, allow installs from your browser, then tap **Install**.
4. **Fire TV:**
   1. Install **Downloader** (by AFTVnews) from the Amazon Appstore.
   2. Go to **Settings → My Fire TV → Developer options → Install unknown apps** and turn on Downloader. If Developer options is missing, go to **Settings → My Fire TV → About** and click your device name 7 times.
   3. In Downloader, enter (with your GitHub username): `https://github.com/YOUR-NAME/orbit-tv/releases/download/latest/OrbitTV.apk`

New builds install over the old one and keep your data. Fire TV needs Fire OS 7 or newer (Fire TV Stick 3rd gen and later).

### iPhone / iPad

- **Free Apple ID:** in **Actions**, run **Build iOS app (unsigned)**, then install **OrbitTV-unsigned.ipa** from Releases with Sideloadly or AltStore. It needs re-signing every 7 days; AltStore can do this automatically.
- **Mac with Xcode:** run `npm install && npm run ios`, pick your iPhone, then press ▶.

### Desktop

Install Node.js 20+, then run `npm install` and `npm start`. To make an installer, run `npm run dist:win`, `dist:mac` or `dist:linux`.

---

## For developers

```bash
npm install
npm run dev          # the app in a browser at http://localhost:5173 (playlists need CORS there)
npm start            # desktop app (Electron)
npm run check        # typecheck, lint, tests, build
npm run android      # build, sync and open in Android Studio
npm run ios          # build, sync and open in Xcode (Mac)
```

```
src/
  core/        platform detection, HTTP, storage, formatting, name cleaning
  sources/     Xtream, M3U, MAC portal, XMLTV guide, catch-up, and the library state (signals)
  services/    subtitles, OpenSubtitles, TMDB
  player/      engines (ExoPlayer bridge, hls.js/mpegts.js), controller, full-screen UI and menus
  nav/         remote keys → actions, spatial focus, layers, screen history
  ui/          shared components: virtual list/grid, cards, sheets, dialogs, icons
  screens/     Home, Live TV, TV guide, Movies/Series, details, Search, Favourites, Settings
  styles/      theme and player styles
tests/         Vitest tests for parsers, subtitles, OpenSubtitles hash, navigation and keys
android/app/src/main/java/tv/orbit/player/
  OrbitPlayerPlugin.java   ExoPlayer behind the WebView, remote key forwarding
  MainActivity.java        hands remote keys to the plugin
desktop/       Electron main process and preload
server/        Orbit Server (Docker), unchanged from version 1
```

How the pieces fit:
- **Remote keys** become actions (`up`, `ok`, `hold-ok`, `back`, `chup`, …) in `nav/keys.ts`. An action is offered to the focused element first, as a bubbling `orbit-action` event. Whatever nothing handles falls through to spatial navigation, a click, or Back.
- **Android video:** ExoPlayer draws on a `SurfaceView` behind a transparent WebView. The web layer tells it where the picture goes (full screen or the Live TV preview box) and draws the controls and subtitles on top.
- **Subtitles** are drawn by Orbit itself for every engine, which is what makes delay and frame-rate correction possible.

The Android signing key in `android/app/orbit-sideload.jks` is shared publicly. It only exists so sideloaded updates can install over each other. Make your own before publishing anywhere, and set it with `ORBIT_KEYSTORE`, `ORBIT_KEYSTORE_PASSWORD`, `ORBIT_KEY_ALIAS` and `ORBIT_KEY_PASSWORD`.

Use Orbit only with streams you have the right to watch.
