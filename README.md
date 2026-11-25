# Orbit TV

An IPTV player for **Android phones, Fire TV Stick, iPhone/iPad** and desktop (Windows, macOS, Linux). Bring your own provider: Orbit plays the channels, films and series from your own sources. It comes with no content of its own.

The `server/` folder contains **Orbit Server**, an optional Docker companion. It records programmes for every device and keeps your devices in sync.

---

## Get the app onto your devices

No coding tools are needed on your computer. GitHub builds the app for you for free.

### 1. Put the project on GitHub (once)

1. Create a free account at github.com and click **New repository**.
   - Name it `orbit-tv`.
   - Choose **Public** if you want to install on a Fire Stick by typing a link.
2. On the new repo page, click **uploading an existing file**.
3. Drag in everything inside this folder, then click **Commit changes**.
   - The browser upload can skip the `.github` folder because its name starts with a dot. If the **Actions** tab shows no workflows after uploading, create the two files in the browser: **Add file → Create new file**, name it `.github/workflows/android.yml`, and paste in that file's contents. Do the same for `ios.yml`.
4. Open the **Actions** tab. "Build Android & Fire TV app" runs by itself (about 6–8 minutes).
5. When it finishes, **OrbitTV.apk** appears under **Releases**.

### 2. Android phone

1. Open the repo's **Releases** page on the phone.
2. Tap **OrbitTV.apk**.
3. Allow installs from your browser, then tap **Install**.

### 3. Fire TV Stick

1. Install **Downloader** (by AFTVnews) from the Amazon Appstore.
2. Go to **Settings → My Fire TV → Developer options → Install unknown apps** and turn on **Downloader**.
   - If *Developer options* is missing, go to **Settings → My Fire TV → About** and click your device name 7 times.
3. In Downloader, enter (with your GitHub username): `https://github.com/YOUR-NAME/orbit-tv/releases/download/latest/OrbitTV.apk`
4. Choose **Install**.

New builds install over the old one and keep your data.

### 4. iPhone / iPad

Apple only allows apps from outside the App Store in one of these ways:

- **Free Apple ID:**
  1. In **Actions**, run **Build iOS app (unsigned)**.
  2. Install **OrbitTV-unsigned.ipa** from Releases with Sideloadly (sideloadly.io) or AltStore (altstore.io).
  - The app needs re-signing every 7 days. AltStore can do this automatically.
- **Mac with Xcode:** run `npm install && npm run ios`, pick your iPhone, then press ▶.
- **Apple Developer Program (£79 / $99 a year):** install through TestFlight, or publish to the App Store.

### 5. Desktop

1. Install Node.js 18+.
2. Run `npm install`, then `npm start`.
3. To make an installer, run `npm run dist:win`, `dist:mac` or `dist:linux`.

---

## Features

### Sources
- Xtream Codes logins, M3U links and files, and **MAC portals** (Stalker/Ministra).
- **Plex** (sign in with a code at plex.tv/link), **Jellyfin** and **Emby**.
- You can use several sources at once.
- Playlists refresh automatically every 6, 12 or 24 hours.

### Watching
- **Live TV:** groups, filter and preview, with channel up/down in full screen.
- **Catch-up:** watch past programmes, or **Start over** on what's on now. Works with Xtream servers that support catch-up and with M3U `catchup` attributes.
- **Movies and series:** posters, search, sorting and resume, and the next episode starts automatically.
- **Multiview:** 2 or 4 channels at once.
- **Sports:** live and upcoming games found in your own channels' guide, with live scores. Orbit never adds a channel you don't have.
- **Favourites**, **Continue watching** and **Search**.

### Guide
- **7 days back and 7 days ahead**, with a day picker.
- Guides load automatically from Xtream, from MAC portals, from an M3U's `x-tvg-url`, or from extra XMLTV links.
- **Time correction** from −3 to +3 hours.
- Channels are matched to the guide automatically. Ambiguous names are left unmatched rather than guessed, and you can **match a channel yourself**; your choice is kept.
- **Reminders** use phone notifications even when the app is closed.

### Profiles and parental controls
- **Profiles:** each has its own favourites, history, resume points and reminders. A profile can have its own PIN.
- **Kids profiles** only see children's categories. These are picked automatically, or you can choose them yourself.
- **Parental PIN:** adult categories are locked automatically, and you can lock any other category. Locked categories stay hidden until the PIN is entered.

### Recording and offline
- **Record** from the guide or with **Record now**:
  - On desktop, recordings are saved on the computer.
  - On every device, they can be made by Orbit Server.
- **Download** films and episodes to watch offline (desktop, Android, iPhone).
- The **Library** lists recordings and downloads.

### Integrations (each needs your own free key)
- **TMDB:** artwork, backdrops, plots, cast and trailers.
- **Trakt:** scrobbling.
- **SIMKL:** watched history.
- **OpenSubtitles:** search subtitles from the player's CC button. You can also load your own .srt/.vtt file.
- **Google Gemini live captions:** subtitles for any channel as it plays, optionally translated.
- **Chromecast:**
  - On phones and Fire TV, use the Cast icon in the system player.
  - On desktop, use the Cast button in the player.

### Sync between devices
- With Orbit Server, playlists, profiles, favourites, resume points, reminders and settings stay the same on every device.

---

## Orbit Server (recording + sync)

The server runs on an always-on machine at home, such as a NAS, Raspberry Pi or spare PC.

```bash
cd server
# edit docker-compose.yml: set ORBIT_TOKEN to a long random secret
docker compose up -d --build
```

Then, in the app, go to **Settings → Orbit Server**:

1. Enter `http://<server-ip>:8090` and the token.
2. Turn on **Sync between devices** on each device.

Full details are in `server/README.md`.

---

## Things to know

**Playback**
- **Fire TV Stick:** uses the system player (ExoPlayer) by default for smooth playback and AC3 audio.
  - Switch players in **Settings → This device**.
  - The built-in player keeps channel zapping, subtitles and live captions.
- **iPhone:** can't play raw `.ts` streams. Orbit asks Xtream-style servers for the `.m3u8` version automatically.

**MAC portals**
- Series on MAC portals are not loaded; live TV and films are.
- Portal links expire quickly, so record from a portal close to the programme's start time.

**Recording and downloads**
- Desktop recordings happen while the app is open. For recordings that run while devices are off, use Orbit Server.
- Recordings saved on the computer are `.ts` files and only partly seekable. Server recordings are converted to MP4.
- Downloads on phones need a direct file (MP4/MKV). Films that only stream in pieces (HLS) can be downloaded with the desktop app.

**Gemini live captions**
- They need the built-in player and arrive a few seconds behind the speech.
- They don't work with Apple's native player on iPhone.

**Chromecast**
- The TV fetches the stream directly from your provider, so recordings stored on your computer can't be cast.

**Security**
- Logins are stored only on your devices and on your own Orbit Server.
- Keep the server on your home network or behind a VPN.

Use Orbit only with streams you have the right to watch.

---

## For developers

```bash
npm install          # also copies hls.js / mpegts.js into src/vendor
npm start            # desktop app (Electron)
npm run android      # open in Android Studio
npm run ios          # open in Xcode (Mac)
npm run apk          # release APK locally (needs the Android SDK)
```

```
src/                 the app itself (HTML/CSS/JS), shared by every platform
desktop/             desktop-only: recorder/downloader, Chromecast, preload bridge
main.js              desktop window (Electron)
android/  ios/       native projects (Capacitor)
server/              Orbit Server (Node + ffmpeg, Docker)
.github/workflows/   cloud builds for Android/Fire TV and iOS
```

The Android signing key in `android/app/orbit-sideload.jks` only lets sideloaded updates install over each other. Make your own before publishing to any store. The build reads `ORBIT_KEYSTORE`, `ORBIT_KEYSTORE_PASSWORD`, `ORBIT_KEY_ALIAS` and `ORBIT_KEY_PASSWORD`.
