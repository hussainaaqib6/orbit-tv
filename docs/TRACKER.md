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
| 2 | Mini player (preview, follow highlight with debounce, mute, on/off) | Implemented | FTV, Desk | Settings → Appearance. **2b:** TV Guide preview box (top right), follows the highlight if set. "Edit TV Channels" entry point not yet (no channel editor exists). |
| 8 | Searchable settings | Implemented | All | **This batch.** Keyword + synonym search, jumps to and highlights the setting. Voice works through the TV keyboard's mic. |
| 11 | Estimated finish time | Implemented | All | **This batch.** Follows pause, skips and speed. |
| 20 | Last Channel | Implemented | All | **This batch.** Remote Last/Yellow from any screen, side-menu shortcut, player option, swaps between the two most recent. |
| 21 | Remote button customisation | Implemented | All | **2b.** Colour, Guide, Search, Bookmark and (outside the player) Play/Pause/FF/RW buttons → 14 jobs; works in the player too; shared-job warning; restore defaults. Long-press mapping not yet. |
| 22 | Advanced side menu | Implemented | All | **Replaced (Nov 2026):** the side menu is gone; Home is a hub of four big tiles plus a shortcut row, Back always returns Home, Settings is an icon grid, and start-up shows an "Update Media Contents" table. Flat blue is the new default theme (old red kept as "Matrix red"). |
| 23 | Universal search | Implemented | All | **2c:** channels, films, series, TV programmes (native guide search), teams/matches; "Search in" tabs; results as rows. Actors/directors need metadata the playlists don't carry (TMDB per item). |
| 24 | Enhanced TV Guide navigation | Implemented | All | **2b:** day markers at midnight, Go to day, Now, focus returns to the playing channel and its programme. Recording indicators wait for recording. |
| 25 | Channel numbering (playlist / favourites first) | Implemented | All | **This batch.** Custom per-channel numbers not yet. |
| 26 | Visual improvements, reduced-motion mode | Partially Implemented | All | |
| 37 | Favourites as red hearts | Implemented | All | **2b:** favourites from hidden categories stay, with a crossed-out eye and a Show this category action. Sync waits for accounts. |
| 41 | Per-category sorting | Implemented | All | **2b.** Films/series: Recently added, Playlist order, A–Z, Z–A, Rating, Release year, Recently watched, Playlist then A–Z; for all or this category only. Channels: Playlist order, A–Z, Z–A, Recently watched, per category. Most watched / custom order not yet. |
| 42 | Country/language/quality filters | Not Started | | |
| 56 | Linked channel versions | Partially Implemented | FTV, Desk | **This batch:** automatic suggestions (up to 32) used for failover and offered in player options. Manual linking/preferred source not yet. |
| 57 | Subtitles (OpenSubtitles, offset, size, background) | Implemented | All | Language list as per spec not yet confirmed. |
| 62 | Timeshift and catch-up | Partially Implemented | All | Provider catch-up (Xtream/M3U templates). Local timeshift not started. |

## Phase 3 – Sports Centre

| # | Feature | Status | Platforms | Notes |
|---|---|---|---|---|
| 3 | Match cards: Classic / Big (team colours) | Implemented | All | **This batch.** Settings → Sports. Live scores refresh every 60 s in place. |
| 12/13 | Sports and competitions | Partially Implemented | All | ESPN public feed: 19 football competitions, UFC, F1, NFL, NBA, NHL, MLB, NCAA football, Six Nations, ATP/WTA, PGA. Not in that feed: cricket (IPL/PSL/ICC), darts, snooker, winter sports, HSBC Sevens → **needs a licensed sports data provider**. Tables, line-ups, stats not yet. |
| 14 | Sports Home rows | Implemented | All | **2c.** Any competition as a Home row: live, upcoming (3 days), today's results, stream counts; OK plays the first stream. Adding a row follows/notifies nothing. |
| 15 | Sports playlist management | Not Started | | |
| 16 | My Channels Only | Implemented | All | **This batch.** Per-device (no sync yet). |
| 17 | Sports stream failover | Partially Implemented | FTV, Desk | **2c:** a match opened from Sports or a Home sports row fails over to the match's other streams (after the channel's own versions). From Live TV: channel versions only. |
| 18 | Intelligent sports channel matching | Partially Implemented | All | Team aliases, competition keywords; **this batch** excludes +1, radio, highlights, replays. EPG-title matching and confidence scores not yet. |
| 19 | Xtream connection usage | Implemented | All | **This batch.** Shown in playlist settings, sports streams, alternative versions and stream info. "Unknown" when the provider doesn't say. |
| 64 | Multiview | Not Started | | Needs per-device decoder limits; Fire TV Stick can usually decode only 1–2 HD streams. |

## Phase 4 – Accounts and sync (needs backend)

| # | Feature | Status | Notes |
|---|---|---|---|
| 4 | Custom themes, sharing codes, links, QR | Partially Implemented | **2b:** 7 presets, own colours/background/text size/menu style, preview, save/rename/duplicate/delete, share as a code + QR, import (appearance-only, validated), restore Matrix. Links and sync need a backend. |
| 5 | Device templates | Blocked | Needs accounts. |
| 10 | Cross-profile sharing | Blocked | Needs accounts/profiles. |
| 43 | New-device playlist selection | Blocked | Needs accounts. |
| 63 | Account and cross-device sync | Blocked | Needs a backend service. |
| 65 | Parental controls (PIN, restrictions) | Implemented | **2b.** Per device: 4-digit PIN (stored hashed), hide or PIN-lock any category, adult categories locked, Settings lock, Lock now. Locked content is removed from every route (lists, search, guide, sports, favourites, numbers). Profiles/age ratings wait for accounts. |

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
| 9 | Enhanced EPG metadata | Implemented | **2b.** Artwork, episode (S/E), episode title, category and age rating stored natively and shown in Live TV, the guide and the player. Cast/release date not yet. |
| 33 | Grid and list views | Implemented | **2b.** Posters, Detailed list (poster, year, rating, category, plot for series), Compact list; per kind. Landscape cards not yet. |
| 34 | Custom Home rows | Implemented | **2c.** 11 rows (Continue watching, New episodes, Favourites, Recently added, Unwatched films/series, Watched (off by default)…) plus sports rows; reorder, show/hide. Trending/Popular need a data source (TMDB). |
| 35 | Plex / Jellyfin / Emby | Not Started | Jellyfin/Emby need only the user's server; Plex needs a Plex account sign-in. |
| 36 | External ratings (IMDb, RT…) | Blocked | TMDB works with a key; IMDb/RT/Metacritic need licensed data (e.g. OMDb key, MDBList). |
| 38 | New-episode notifications | Implemented | **2c.** Favourite Xtream series checked after each start; a "New episode" badge and Home row stay until that episode is watched to the end. Sync waits for accounts. |
| 39 | Rate This | Implemented | **2c.** Button in the player's controls in the last 20%; 1–5 stars, change, remove, turn off. Never pauses playback. |
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
| Phase 2b | #9 | Guide details and navigation, guide preview, hidden categories, parental controls, sorting, list views, remote buttons, side menu, themes |
| Phase 2c | #10 | Search programmes and teams, customisable Home rows with sports rows, new-episode badges, Rate This, match-stream failover |
| Device feedback 3 | #11 | Fire TV preview box via TextureView, black/frozen picture detection by frame count, speed fixes for 300k-item playlists, readable category names, divider rows, live subtitles (DVB/CEA-608/708), split saved playlist |
