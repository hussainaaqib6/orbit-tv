# GalaxyXC reference and feature comparison

GalaxyXC (`apkukrebrands.xciptv.galaxy`) is a rebranded build of **XCIPTV** by NathNetwork. It is the
design reference for Matrix 8K Player. This file records what the APK contains and how each part maps
to Matrix 8K Player.

**How it was analysed.** The manifest, all 341 layouts, the selector drawables and the 971 strings were
decoded from the APK with androguard (resource IDs resolved to names), and the artwork was viewed.
The APK was not run: there is no Android device or emulator in the build environment. The supplied
`GalaxyXC_extracted_code.zip` holds the same unpacked APK files, not source code.

**What is reused.** Nothing from the APK goes into Matrix 8K Player: no code, images, fonts,
endpoints, keys or certificates. The layouts were read for screen structure, proportions and
navigation only. Every screen is drawn with Matrix 8K Player's own code, icons (Lucide, ISC licence)
and colours.

The APK also bundles AdMob ads, Firebase analytics and in-app messaging, an OpenVPN client, an
install-referrer service and `REQUEST_INSTALL_PACKAGES`. None of these come across. Matrix 8K Player
has no ads, analytics or trackers.

## Screens (from the decoded layouts)

| Screen (XCIPTV activity / layout) | Structure in GalaxyXC | Matrix 8K Player |
|---|---|---|
| Splash (`SplashActivity`, `activity_splash`) | Centred 150dp logo, spinner under it. 80dp footer with a 5dp accent line on top. | Start-up screen: logo, then the "Update Media Contents" table. |
| Login (`LoginActivity`, `activity_login`) | Centred 350dp column: 80dp logo, "XTREAM CODES COMPATIBLE API", white fields with icons (server, username, password with show/hide), full-width **Sign In**. Gear bottom-right picks the panel type. | Same column. Chips pick Xtream / M3U / file / MAC portal. Optional phone pairing by QR. |
| Account management (`UsersHistoryActivity`, `activity_usermanager`) | 50dp header "Account Management" with **+M3U**, **+EZServer**, **+Xtream Codes**. List of saved accounts (name, URL). | Settings → **Account**: saved playlists with add, edit, turn off/on, remove and refresh. More than one can be on at once. |
| Update contents (`XCUpdateContents`, `activity_update_contents`) | "Update Media Contents" with LIVE TV / VOD / SERIES / GUIDE columns, each Waiting / Updating / Completed, a "Now updating…" line and PLEASE WAIT. | Same, with sizes and counts per column. |
| Home (`CategoriesActivity`, `activity_categories`) | Full-screen vignette background. Top: 60dp logo centred, time and date left, small icon buttons right (search, reminders, records, VPN, notifications, update). Centre: 200dp square tiles **LIVE TV, TV GUIDE, VOD, SERIES**. 80dp footer with a 5dp accent line: **ACCOUNT, MULTI, CATCH UP** left and **FAVORITES, RADIO, SETTINGS** right. Expiry text bottom-centre. Focused tile grows (same image in every state, scaled in code). | Same arrangement. Top right: Search, Reload. Footer left: Account, Catch Up, Sports. Footer right: Favourites, Last channel, Settings. |
| Live TV categories (`ChannelListActivity`, `activity_channel_list`) | 80dp header bar: logo centre, time and date left, category name with "Categories" caption, sort new/old, sort A–Z and search right. 275dp category list left. Grid of channel cards (125dp logo on dark card, name bar under it, favourite star) right. | Same. |
| Live TV playing (`PlayStreamEPGActivity`, `activity_play_stream_epg`) | Picture top-left. 250dp info box top-right: LIVE TV tag, channel, programme, time. Programme list below. 250dp channel list on the left with "◀ category ▶" header. Bottom bar when full screen: programme name and description, then rewind, play, forward, cast, zoom, subtitles, video quality, audio, record and back. | Mini screen top, details beside it, schedule below, channel list left with ◀ ▶ category header. Full-screen player has its own control bar (play, skip, picture, subtitles, audio, speed, info). |
| TV guide (`EPGActivityXMLTV`, `activity_epg_xmltvn`) | "GUIDE \| date" title. Info strip with logo, title, time and description. Category buttons with previous/next. Channel column and a horizontally scrolling programme grid. | Guide grid with the details strip on top and preview top right, day jumps, catch-up. |
| VOD / Series grid (`ChannelListActivity` + `activity_vod_item`) | Categories left, poster cards with the name on a dark bar along the bottom and a favourite star. | Same. |
| Movie info (`MovieInfoActivity`, `activity_movie_info`) | Poster left. Name, rating, release date, genre, cast, plot and director right. Full-width **Trailer** and **Play** buttons along the bottom. | Same layout (Trailer when TMDB has one). |
| Series (`SeriesActivity`, `activity_series`) | Backdrop. 120×180 cover with details, a row of season buttons, episode list. | Same. |
| Settings (`SettingsMenuActivity`, `activity_settings_menu`) | 50dp bar "S E T T I N G S", grid of cards with a 100dp icon and a label. | Same grid. Each card opens its section. |
| Search (`SearchActivity`) | Search box with results by type. | Search across channels, films, series, programmes and sports. |
| Catch-up (`CatchupActivity`) | Channels with archive, then days and programmes. | Catch-up from the guide and from a channel's options. |
| Multi-screen (`MultiScreenActivityEXO`) | Two- and four-way layouts. | Not built yet. |
| Radio (`RadioPlayerActivity`) | Radio channel list. | Not separate: radio streams show in Live TV categories. |
| Records (`RecordsActivity`) | Recording list. | Not built yet. |
| Program reminders (`ProgramRemindersActivity`) | Reminder list. | Not built yet. |
| VPN (`OpenVPNActivity`) | OpenVPN client with country list. | Not included (see limitations). |
| Speed test (`SpeedTestActivity`) | Download speed test. | Not built yet. |
| Backup (`BackupActivity`) | Cloud backup with password. | Not built yet. |
| Device status, log view, service status, language picker | Diagnostic and information screens. | Stream information in the player. App language is English only. |

## Feature checklist

Status: **Done** = built and checked off-device. **Partial** = some of it. **Not yet** = not built.
Nothing is marked as tested on a physical Fire TV Stick in this file. See `docs/TRACKER.md` for device testing.

| Feature | GalaxyXC | Matrix 8K Player |
|---|---|---|
| Xtream Codes login | Yes | Done |
| M3U / M3U Plus link | Yes | Done |
| Local M3U file | Yes | Done (desktop, iOS) |
| MAC portal (Stalker) | No (EZServer instead) | Done |
| Multiple saved accounts | Yes | Done (several can be on together) |
| Switch active account | Yes | Partial (turn playlists on/off) |
| Expiry shown | Yes | Done (Home footer, Account) |
| Update media contents screen | Yes | Done |
| Automatic refresh | Yes | Done (interval in Account) |
| Live TV categories and channel grid | Yes | Done |
| Live TV list + preview + EPG | Yes | Done |
| Channel numbers, favourites, recent, last channel | Yes | Done |
| Hide categories, parental lock | Yes | Done |
| TV guide grid | Yes | Done |
| EPG time shift | Yes | Done (guide time correction) |
| Catch-up | Yes | Done (Xtream and M3U catch-up attributes) |
| VOD and series with info pages | Yes | Done |
| Continue watching, resume, next episode | Yes | Done |
| Search | Yes | Done |
| Two player engines | Yes (Player One / Two) | Done (ExoPlayer and web engine, manual choice) |
| Stream type (TS / HLS) | Yes | Done, with automatic fallback |
| Video size (aspect) | Yes | Done |
| Subtitles and audio tracks | Yes | Done, plus OpenSubtitles |
| Parental control | Yes | Done |
| Remote buttons | Partial | Done |
| Multi-screen | Yes | Not yet |
| Recording | Yes | Not yet |
| Program reminders | Yes | Not yet |
| Radio section | Yes | Partial (in Live TV) |
| Speed test | Yes | Not yet |
| Backup and restore | Yes (cloud) | Not yet |
| VPN | Yes (OpenVPN) | Not included |
| Language picker | Yes | Not yet |
| Ads and analytics | Yes | Not included, by design |

## Known limitations

- The APK was studied from its decoded files, not run, so animations and timings are approximate.
- VPN is left out: an OpenVPN client is GPL-licensed native code. It needs its own licensing decision
  and a VPN service to connect to.
- The Android package name is still `tv.orbit.player`. Changing it makes Android treat the app as a new
  one: it installs beside the old one and starts with no playlists. That needs your go-ahead.
