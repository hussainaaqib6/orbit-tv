# Matrix TV — feature tracker

Tracks the product specification ("Matrix 8K Player – Advanced Feature Implementation and
Development Specification"). Updated with every batch of work.

**Statuses:** Not Started · In Development · Partially Implemented · Implemented · Tested · Production Ready · Blocked

- **Implemented** = the code works and has automated tests where it can be tested off-device.
- **Tested** = also checked in the Android emulator device test (1.5 GB, provider-sized playlist).
- Nothing below is marked **Production Ready**: none of it has been tested on a physical Fire TV Stick yet.
- **Needs backend** = cannot work without a server or account system that doesn't exist yet (see "What's needed from you").

Platforms: **FTV** Fire TV / Android TV (the priority), **And** Android phone/tablet, **iOS**, **Desk** Windows/macOS/Linux (Electron).

## Architecture today (audit, Nov 2026)

| Area | Current implementation |
|---|---|
| App | Vite + TypeScript + Preact UI in a Capacitor 8 WebView (Android/iOS) and Electron (desktop). One codebase. |
| Player | Android: native Media3/ExoPlayer on a surface under the transparent WebView (`OrbitPlayerPlugin.java`). Elsewhere: hls.js + mpegts.js. |
| Playlists | Xtream Codes, M3U/M3U Plus (link or file), MAC/Stalker portal. Downloaded natively on Android, parsed in the WebView, cached in IndexedDB. |
| TV guide | Android: XMLTV streamed natively into SQLite (`GuideStore.java`); the UI queries only channels on screen. Elsewhere: parsed in memory. |
| Navigation | Remote-first spatial focus with layers (`src/nav`). Virtualised lists and grids. |
| Tests | Vitest unit tests (`tests/`), Android emulator device test with a 15k-channel / 300 MB-guide mock provider (`.github/scripts`). |

**Main technical debt:** the catalogue (channels, films, series) is still held fully in WebView memory and cached as one IndexedDB blob — fine at 90k items in the emulator, but the next step for "hundreds of thousands" is moving it into the native database like the guide (Phase 1 item 46). Settings and favourites are per-device (no account sync).

## Phase 1 – Core architecture and Fire TV

| # | Feature | Status | Platforms | Notes |
|---|---|---|---|---|
| 40 | Playlist compatibility (Xtream, M3U, M3U Plus, XMLTV, Stalker, multiple playlists) | Tested | All | Add/edit/disable/delete/refresh exist. Not yet: rename separately, reorder, per-device/profile assignment, priorities. |
| 45 | High-performance EPG (streaming parse, SQLite, atomic swap, window, dedupe) | Tested | FTV | 319 MB guide → 871k programmes in ~2 min on the emulator, WebView memory flat. Not yet: incremental/conditional (ETag) refresh, parallel sources. |
| 46 | High-performance playlist processing | Partially Implemented | All | Native download with progress; stable keys keep favourites. Not yet: native database, incremental diffs. |
| 47 | M3U compatibility (group-title, tvg-*, catch-up attributes) | Implemented | All | Encoding detection and editor-export quirks not yet audited. |
| 49 | Playback architecture (ExoPlayer, web engines, manual engine choice) | Implemented | FTV, Desk | libVLC not added (licence/size review needed). DASH via ExoPlayer not wired. |
| 50 | Automatic stream recovery | Implemented | FTV, Desk | **This batch.** Stall/freeze watchdog with 6/10/20/30 s delay; reconnect ×2 → other format → other versions. One stream at a time. Black-picture-with-audio detection not yet. |
| 51 | Stream format detection and switching | Implemented | FTV, Desk | **This batch.** Format shown in the player and stream info; toast when switched. |
| 53 | Timestamp/discontinuity recovery | Partially Implemented | FTV | ExoPlayer TS flags + behind-live-window recovery. AFR not implemented. |
| 55 | Player controls | Partially Implemented | All | Play/pause/seek/skip/speed/aspect/zoom/audio/subtitles/info/channels/last channel. Not yet: audio delay, record, timeshift. |
| 59 | MAC/Stalker portals | Partially Implemented | All | Login, channels, guide, VOD. Not audited against many portals. |
| 66 | Performance and stability | In Development | FTV | Startup screen, native guide, virtual lists. Benchmarks on real Fire Stick still needed. |

## Phase 2 – Premium TV experience

| # | Feature | Status | Platforms | Notes |
|---|---|---|---|---|
| 2 | Mini player (preview, follow highlight with debounce, mute, on/off) | Implemented | FTV, Desk | **This batch.** Settings → Appearance. "Edit TV Channels" entry point not yet (no channel editor exists). TV Guide preview not yet. |
| 8 | Searchable settings | Implemented | All | **This batch.** Keyword + synonym search, jumps to and highlights the setting. Voice works through the TV keyboard's mic. |
| 11 | Estimated finish time | Implemented | All | **This batch.** Follows pause, skips and speed. |
| 20 | Last Channel | Implemented | All | **This batch.** Remote Last/Yellow from any screen, side-menu shortcut, player option, swaps between the two most recent. |
| 21 | Remote button customisation | Not Started | | |
| 22 | Advanced side menu | Partially Implemented | All | Labels on focus exist. Not yet: reorder/hide items, auto-open. |
| 23 | Universal search | Partially Implemented | All | Channels/films/series. Not yet: actors, programmes, teams, rows view. |
| 24 | Enhanced TV Guide navigation | Partially Implemented | All | Grid, day jump with Rewind/FF, focus on return. Guide data now 4 days ahead. Not yet: date markers, jump to date, recording indicators. |
| 25 | Channel numbering (playlist / favourites first) | Implemented | All | **This batch.** Custom per-channel numbers not yet. |
| 26 | Visual improvements, reduced-motion mode | Partially Implemented | All | |
| 37 | Favourites as red hearts | Implemented | All | **This batch.** Hidden-category marker waits for hidden categories (41/42). |
| 41 | Per-category sorting | Not Started | | |
| 42 | Country/language/quality filters | Not Started | | |
| 56 | Linked channel versions | Partially Implemented | FTV, Desk | **This batch:** automatic suggestions (up to 32) used for failover and offered in player options. Manual linking/preferred source not yet. |
| 57 | Subtitles (OpenSubtitles, offset, size, background) | Implemented | All | Language list as per spec not yet confirmed. |
| 62 | Timeshift and catch-up | Partially Implemented | All | Provider catch-up (Xtream/M3U templates). Local timeshift not started. |

## Phase 3 – Sports Centre

| # | Feature | Status | Platforms | Notes |
|---|---|---|---|---|
| 3 | Match cards: Classic / Big (team colours) | Implemented | All | **This batch.** Settings → Sports. Live scores refresh every 60 s in place. |
| 12/13 | Sports and competitions | Partially Implemented | All | ESPN public feed: 19 football competitions, UFC, F1, NFL, NBA, NHL, MLB, NCAA football, Six Nations, ATP/WTA, PGA. Not in that feed: cricket (IPL/PSL/ICC), darts, snooker, winter sports, HSBC Sevens → **needs a licensed sports data provider**. Tables, line-ups, stats not yet. |
| 14 | Sports Home rows | Not Started | | |
| 15 | Sports playlist management | Not Started | | |
| 16 | My Channels Only | Implemented | All | **This batch.** Per-device (no sync yet). |
| 17 | Sports stream failover | Partially Implemented | FTV, Desk | Generic failover (item 50) covers matches opened anywhere when the channel has versions; failover between *different* channels showing the same match not yet. |
| 18 | Intelligent sports channel matching | Partially Implemented | All | Team aliases, competition keywords; **this batch** excludes +1, radio, highlights, replays. EPG-title matching and confidence scores not yet. |
| 19 | Xtream connection usage | Implemented | All | **This batch.** Shown in playlist settings, sports streams, alternative versions and stream info. "Unknown" when the provider doesn't say. |
| 64 | Multiview | Not Started | | Needs per-device decoder limits; Fire TV Stick can usually decode only 1–2 HD streams. |

## Phase 4 – Accounts and sync (needs backend)

| # | Feature | Status | Notes |
|---|---|---|---|
| 4 | Custom themes, sharing codes, links, QR | Not Started | Local themes and code import/export can be done without a server; links/sync need one. |
| 5 | Device templates | Blocked | Needs accounts. |
| 10 | Cross-profile sharing | Blocked | Needs accounts/profiles. |
| 43 | New-device playlist selection | Blocked | Needs accounts. |
| 63 | Account and cross-device sync | Blocked | Needs a backend service. |
| 65 | Parental controls (PIN, restrictions) | Not Started | Can be done per device first. |

## Phase 5 – Recording (needs storage/server)

| # | Feature | Status | Notes |
|---|---|---|---|
| 6 | Remote recording management | Blocked | Needs accounts + a recording device/server. |
| 7 | Ad-break detection | Blocked | Needs recordings first. |
| 60 | Recording engine | Not Started | Android background recording to local storage is possible; Fire TV storage is small. |
| 61 | Docker recording server | Not Started | |

## Phase 6 – Phones, tablets, other platforms

| # | Feature | Status | Notes |
|---|---|---|---|
| 27 | System media integration (MediaSession, Now Playing) | Not Started | |
| 28 | Gesture mini player | Not Started | |
| 29 | Tablet TV layout | Partially Implemented | Same TV layout scales; no swipe-up rows. |
| 30 | Wi-Fi-only storage features | Not Started | Depends on downloads/recording. |
| 31 | Mobile TV guide | Partially Implemented | |
| 32 | Accessibility / text scaling | Partially Implemented | Labels on most controls; not audited at large font sizes. |
| — | Apple TV | Not Started | Needs a separate tvOS app (WebView isn't available on tvOS). |

## Movies and series

| # | Feature | Status | Notes |
|---|---|---|---|
| 9 | Enhanced EPG metadata (icons, episode numbers, categories) | Not Started | Next: store `<icon>`, `<sub-title>`, `<episode-num>`, `<category>` in GuideStore. |
| 33 | Grid and list views | Not Started | |
| 34 | Custom Home rows | Partially Implemented | Continue watching, new films/series rows exist; not configurable. |
| 35 | Plex / Jellyfin / Emby | Not Started | Jellyfin/Emby need only the user's server; Plex needs a Plex account sign-in. |
| 36 | External ratings (IMDb, RT…) | Blocked | TMDB works with a key; IMDb/RT/Metacritic need licensed data (e.g. OMDb key, MDBList). |
| 38 | New-episode notifications | Not Started | |
| 39 | Rate This | Not Started | |
| 48 | Logo packs | Not Started | |

## Security and privacy (68)

| Item | Status | Notes |
|---|---|---|
| Credentials stored on device only | Implemented | Capacitor Preferences; not yet encrypted (Android Keystore needed). |
| No secrets in builds | Implemented | API keys come from user settings or CI secrets. |
| Phone pairing | Implemented | Random token, LAN only, stops when the screen closes. |
| Encrypted storage, account security | Not Started | |

## What's needed from you

- **Name:** the spec says "Matrix 8K Player"; the app is currently "Matrix TV". Say which to use.
- **Accounts and sync** (items 4, 5, 6, 10, 43, 63): a hosted backend. Options: Supabase or Firebase (cheapest to start), or a small server we write. Needs your decision and an account.
- **Sports data beyond ESPN's public feed** (cricket, darts, snooker, winter sports, tables, line-ups): a licensed provider such as API-Football, Sportradar or SportMonks (paid, API key).
- **Ratings** (36): an OMDb or MDBList API key for IMDb/RT/Metacritic.
- **Apple TV / iOS App Store, signed Android builds:** Apple developer account; a release signing key for Android.
- **Physical testing:** a real Fire TV Stick run of each batch (the emulator can't show real-world decoding and Wi-Fi behaviour).

## Batch log

| Batch | PR | Contents |
|---|---|---|
| Crash fix + start-up + Live Sports + branding | #7 | Native guide database, start-up boxes, Live Sports tab, Matrix TV logo |
| Phase 2a | #8 | Stream recovery + failover, channel versions, Last Channel, finish time, mini-player options, favourites numbering, connection counts, hearts, settings search, Big match cards, My Channels Only, more competitions, sports match exclusions |
