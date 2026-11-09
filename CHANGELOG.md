# StarkTV changelog

Fire TV builds are numbered `version.build` (e.g. 2.9.14 = version 2.9, GitHub build 14).
The PC app (Windows) shares the same interface code; PC-only changes are marked **PC**.

## 4.21 — Fire Stick updates itself
- The Fire Stick now installs new versions on its own. When StarkTV finds a new build it downloads it quietly in
  the background and goes straight to Android's "Update?" screen – no more "Update available" box to notice, no
  "Update now" to press. Handy for your dad's stick: when there's an update, all he does is press Update once.
- It waits until you're not watching, so an update never interrupts live TV – it slots in when you're on the menu.
- New switch in Settings → "Install updates automatically" (on by default). Turn it off and you get the old
  "Update available" box back instead.
- Phones and Windows are unchanged – they still open the download in the browser (phones can't self-install
  without the Play Protect warning you didn't want).

## 4.20 — Fire Stick: episodes after picking a season
- Fixed: on a series page, choosing **Season 2** (or any season) on the Fire Stick lost the highlight – the
  season buttons are redrawn, the highlighted one vanished, and the next ▼ jumped to the menu behind the page
  (Series → Favourites). The highlight now stays on the season you picked, and ▼ goes straight into its episodes.
- Safety net: whenever a pop-up (series page, dialog, menu) is open and the highlight gets lost, it now comes back
  inside the pop-up, never to the menu behind it.

## 4.19 — No more "harmful app" warning on phones
- 4.17's automatic updater added the "install apps" permission, which makes Google Play Protect on phones warn
  "harmful app" (Fire TV has no Play Protect). There are now two builds of the same app:
  - **StarkTV.apk – Fire Stick**: unchanged, installs its own updates (same link as always).
  - **StarkTV-Phone.apk – phones**: no install permission, so no warning. Its updater still tells you about new
    versions; Update now downloads it in your browser, then tap the download to install.
- Phones already on 4.17/4.18 install the phone build over the top as normal (it's the same app).

## 4.18 — Subtitles off, and series pages fixed
- **Subtitles are off unless you pick them.** Some films and series switched them on by themselves. Settings →
  Subtitles: "Off unless I pick them" (default) or "Show when the programme has them".
  - Phone: tap the picture → **CC** (top right) → Off or a subtitle language; also lets you pick the sound track
    (e.g. English / Audio description) when there's more than one.
  - Fire Stick films/series: the player's own controls (OK while watching) now have a **CC** button.
  - PC (VLC): subtitles switched off automatically unless you choose "Show".
- **Series / film pages on the phone**: the episode list was a small box inside the page, awkward to scroll, with
  the menu bar underneath it. The page now covers the whole screen and scrolls as one, so all episodes are easy
  to swipe through.
- **Fire Stick**: while Films or Series loads, pressing ▼ no longer slides down the menu to Favourites – it waits
  on the page and the first poster gets the highlight once it's ready.

## 4.17 — Automatic updates
- **StarkTV now updates itself.** Shortly after starting (and twice a day) it checks GitHub for a newer build. If
  there is one, a box shows the new version and what's new: **Update now** or **Later** (asks again the next day).
  - Fire Stick and phone: Update now downloads and installs it in about a minute; Android asks you to confirm
    "Install". The very first time, it takes you to the "Allow from this source" switch for StarkTV – turn it on,
    press Back, and the update carries on. No more Downloader.
  - Windows: Update now downloads the new zip in your browser – unzip it over your StarkTV folder.
- **Settings → Check for updates** to check straight away.
- The box never appears over full-screen TV – it waits until you come out.

## 4.16 — Windows: the built-in player gets the live buffer too
- 4.15 only gave the live delay to channels playing in VLC – but most channels on the PC play in the **built-in
  player** (the "~2 s" setting), which deliberately stayed about 2 seconds behind live. Now live channels in the
  built-in player also go through StarkTV's own 10-minute buffer: it keeps downloading across drop-outs and plays at
  97 % until it's the Live delay behind (15 s by default, Settings → Live delay), then normal speed – no more chasing
  back to 2 seconds.
- The old "Buffering ~2 s" setting is renamed **Channel start-up** – it only decides how quickly a channel starts.

## 4.15 — Windows: the live buffer, like the Fire Stick
- **The PC now builds the live delay too.** StarkTV reads the live channel from the provider itself and keeps the
  last 10 minutes on disk; VLC plays from that copy and runs at 97 % until it's the chosen number of seconds behind
  live (Settings → Live delay, now shown on the PC too – 15 s by default). If the provider drops out, StarkTV
  reconnects in the background and VLC keeps playing from what's already been downloaded.
- The VLC bar shows it: "Playing in VLC · 9 s behind live (building to 15 s)".
- Films and series aren't affected (they don't need it).

## 4.14 — Windows version built by GitHub too
- Every build now also makes the **Windows version**: StarkTV-Windows.zip on the release page, alongside the
  Fire Stick / phone app. Download, unzip anywhere, run the StarkTV exe – no installer. Same features as the other
  versions (search, films/series, new-season alerts, connection light…), playing through VLC as before (it offers to
  install VLC if the PC doesn't have it). Saved playlists carry over from the old PC version.

## 4.13 — True full screen on the phone
- Full-screen video on the phone now hides Android's status bar and the Back / Home / Recents buttons, and uses the
  whole screen including the camera-notch area. Swipe in from the edge if you need them for a moment – they tuck
  away again by themselves. They come back as normal when you leave full screen.

## 4.12 — Phone: proper touch controls, and it turns with the phone
- **Tap the picture (full screen)** for proper controls, live TV and films alike: the channel/film name at the top
  (with its quality, e.g. Full HD), big **⟲10 · play/pause · 10⟳** buttons in the middle, and a **seek bar** along the
  bottom – drag it to anywhere in a film (shows time gone / time left), or anywhere in the live rewind buffer with a
  **LIVE** button to jump back to live. Mini player and close (✕) top right; brightness left, volume right.
- Films on the phone now use these controls too (before, they used the player's own small controls).
- **Auto-rotate on the phone**: the TV guide, Films, Series etc. now turn with the phone (portrait or landscape –
  respects your rotation lock). Search still goes upright for the full keyboard; full-screen video goes sideways.

## 4.11 — Brightness and volume sliders (phone)
- Watching full screen on the phone, **tap the picture**: brightness slider on the left, volume on the right (with
  the info banner and controls). Drag them up/down.
- Or, like Smarters, just **slide a finger up/down the left side** of the picture for brightness, **the right side**
  for volume – no need to tap first. Swiping up/down in the middle still changes channel.
- Brightness only affects StarkTV (goes back to normal when you leave the app); volume is the phone's media volume.

## 4.10 — Compact TV guide on phones
- Phone only (Fire Stick unchanged): a smaller, tighter TV guide – shorter rows, smaller text and logos, no channel
  numbers, slimmer time bar and no "Click a programme…" hint line, so you see more channels at once.
- The channel-name column is much wider (e.g. "SKY SPORTS MAIN EVENT FHD" fits on one line), helped by slightly
  narrower menu and category columns. You can still drag the edge of the channel column to change it; the phone
  remembers its own width separately from the Fire Stick and PC.

## 4.9 — Frozen picture fixed automatically
- **Picture frozen but sound still going**: StarkTV now watches for it. If no new picture frame has appeared for
  3 seconds while playing, it restarts the picture at the same moment (clears the video decoder) – usually back
  within a second, without losing your place or buffer. If a channel keeps doing it (3 times in 90 seconds), it
  reconnects the channel.
- The Playback log now also records the picture format (e.g. h264 1920x1080 50fps 6500kbps), the video decoder in
  use, and bursts of dropped frames ("the Stick is struggling with this channel") – which tells us whether freezes
  come from the stream or from the Stick not keeping up with a heavy (e.g. 4K / HEVC) channel.
- **Info banner (OK) shows the exact channel** you're on, with its quality – e.g. "UK: Sky Sports F1 FHD [Full HD]" –
  so you can tell the Full HD, HD and SD versions apart (and see when it has switched to a lower one). Channels with
  no guide data say "No programme info" instead of repeating the name.

## 4.8 — The live delay actually builds up
- Fixed: the live delay stayed at about 1 second instead of creeping up to the 15 seconds set in Settings (or 45 on
  slow internet), so there was no safety buffer for drop-outs. The player's own "slow down a touch" logic wasn't
  kicking in on the app's recorded stream. StarkTV now does it itself: it plays at 97 % (sound pitch unchanged)
  until the picture is the chosen amount behind live, then carries on at normal speed. That adds about 2 seconds
  of buffer per minute – 15 seconds after roughly 8 minutes on a channel. Watch it climb in the clock overlay.
- If a drop-out leaves it further behind than the setting, it stays there (more buffer, never a jump).
- "As close to live as possible" (Live delay: Off) still nudges up to 103 % to stay near live.

## 4.7 — Clock overlay
- **Clock overlay on live TV – Fire TV only** (Settings → Clock overlay, off by default, per device; not on phones): a small see-through strip
  top left – "20:50:23 real time · 20:50:07 on screen · 15 s behind live". Real time is the Stick's own clock (set
  from the internet); "on screen" is the moment of the stream you're seeing. If the on-screen time ever goes
  backwards, that's a replay – and the replay guard and Playback log will show why.
- Shows on the small picture and full screen; hidden for films.

## 4.6 — Live TV can't go backwards by itself
- **Replay guard**: every second the player checks which moment of the programme is on screen. If that ever goes
  backwards by more than 3 seconds without you rewinding, it jumps straight forward to where you were.
- **Stream clock jumps handled**: if the provider re-sends a bit you already have in the middle of a stream (not just
  after a reconnect), it's now spotted and skipped. A genuine clock reset (channel restart, switch to another feed)
  starts a clean new section instead of confusing the player. Before, a backwards clock jump could also stop the
  recording from being cut into pieces, causing a long stall.
- **Playback log** (Settings → Playback log, Fire TV and phone): the last few minutes of what the player did –
  channel starts, reconnects, skipped repeats, jumps, rewinds, errors – newest first. If anything odd happens,
  open it straight after and take a photo; it shows exactly what went on.

## 4.5 — Resume really resumes
- Fixed: choosing "Resume from 45:37" showed the right time but the film started from the beginning on the Fire
  Stick / phone. The jump to 45:37 was sent before the film had actually been opened (the app waits a moment for
  the provider to free up the connection first), so it was lost. The resume point now goes to the player before
  it opens the film, so it starts straight there – and a few seconds later the app double-checks and jumps there
  if it somehow started at the beginning. Episodes too; PC (VLC) gets the same double-check.

## 4.4 — Live TV no longer jumps back
- Fixed: live TV sometimes jumped backwards and replayed a bit you'd already watched. Two causes:
  - when the stream had a damaged moment, the player recovered by going back to "the live delay point" – but while the
    15-second (or 45-second) delay is still building up, that point is *behind* where you were. It now carries on
    from where you are, just past the damaged bit.
  - after a dropout, providers often re-send the last few seconds when the app reconnects; those repeated seconds
    were added to the recording. They're now recognised by their timestamps and skipped.
- Rewinding past the oldest part of the 30-minute buffer still goes to the start of what's kept, as before.

## 4.3 — Films remember where you stopped (Fire TV and phone)
- Fixed: on the Fire Stick and phone the film position was hardly ever saved – the app was reading a position that
  only updated when the picture started or paused, so Resume often wasn't offered. The player now reports its
  position every 2 seconds while a film or episode plays.
- The spot is saved every 5 seconds, the moment you press Back to stop, and when you leave the app (Home, phone
  call, picture in picture closed), so you come back to within a few seconds of where you were.
- Picking the film again (Films page, Continue watching, Search) offers "▶ Resume from 45:37" or "Start again";
  series pick up at the episode and spot you stopped at.
- Fixed (later build): picking a film from **Recently watched** or **Favourites** started it from the beginning.
  Films and series there now open the details box with "▶ Resume from 45:37" (highlighted, so OK resumes) or
  "Start again", the same as the Films page and Search.

## 4.2 — Picture in picture (Android phones / tablets)
- **Press Home while something's playing** and it carries on in a small floating window over your other apps.
  Drag it anywhere, pinch to resize, tap it for play/pause or to go back to full StarkTV.
- **Mini player button** on the picture in the TV guide, and in the controls when watching full screen.
- Play/pause button in the small window. Closing the small window stops the stream (so it doesn't hold one of your
  provider connections in the background).
- Works on Android 8 or newer, if the phone allows picture in picture for StarkTV (Settings → Apps → StarkTV →
  Picture-in-picture). Fire TV doesn't support picture in picture, so nothing changes there.

## 4.1 — New seasons of shows you watch
- **New season / new episodes alerts** (remembered per device, so your phone and your dad's Fire Stick each follow
  what's watched on them). When you watch an episode, StarkTV notes how far the show has got. Once a day it quietly
  checks those shows with your provider (one at a time, so it's light on slow internet):
  - a **new season** → alert, even if you hadn't finished the last one;
  - **new episodes** → alert once you've caught up to the latest episode.
- Where it shows: a short pop-up ("NEW FOR YOU · The Bear · Season 3 is out" – Take a look / Later, never over
  full-screen TV), a number on the **Series** menu, a **New for you** row at the top of Series with red "New season 3"
  / "2 new episodes" labels, the top banner featuring it, and the show's page opening on the new season (marked NEW).
- Watching the new season clears it. Shows you watched before this update are picked up automatically – the first
  check just notes where they are, so alerts start from the next new season/episode.

## 4.0 — Internet connection monitor (for slow broadband)
- **Connection light while watching** (Fire TV and phone): a small dot in the corner of the picture – green when the
  internet keeps up, amber "Internet struggling", red "Internet too slow". By default it only appears when there's a
  problem (Settings → Connection light: only on problems / always / off).
- **Real numbers in the info banner** (OK while watching): e.g. "Internet good · 6.2 Mbps coming in · channel needs
  4.8". The app measures how fast the programme is arriving against how fast it's needed, plus any pauses to buffer.
- **Automatic switch to a lower-quality channel**: when a channel is too much for the internet (keeps buffering, or
  arriving slower than it plays), a box says "Your internet is too slow for this channel – switching to
  Sky Sports Main Event HD in 5, 4, 3, 2, 1". OK = switch now, Back = stay (it won't ask again about that channel
  for 15 minutes). It picks the best version the internet can actually carry – the same channel's HD/SD copy, found
  by name or guide listing. Settings can turn this off.
- **Warning before 4K / Full HD**: if your last speed test says the internet is too slow for a 4K or Full HD
  channel, the countdown appears as soon as you pick it.
- **Test my internet** in Settings: measures your speed for ~7 seconds and says in plain English what it can play
  ("OK – 6.1 Mbps · Fine for: SD, HD · Too slow for: 4K, Full HD"). Also on PC.
- **Slow-internet buffer**: Settings → Buffer for slow internet. Automatic (default) switches to a 45-second buffer
  if the picture keeps stopping (two pauses within 10 minutes) and says so; "Slow internet" keeps it on always.
  The bigger buffer builds up quietly while you watch (slightly slower playback), no restart needed.

## 3.9 — Phone search goes upright
- **Phone: Search turns the app upright**, so you get the normal full-width keyboard instead of the split one, and
  the results have room. Leaving Search turns it back sideways; playing something from Search goes full screen
  sideways as usual, and Back returns to the upright search.
- Phone search tidied: Live TV / Films / Series fill the width with the mic button beside them, and the bottom menu
  hides while the keyboard is open so the results get the space.

## 3.8 — Plain text menu
- Left menu back to plain words, no icons: Search, Live TV, Movies, Series, Favourites, Recently watched, Settings,
  Switch playlist ("TV guide" is now called "Live TV"). Search's magnifier icon removed too.
- Phone: no more solid orange block on the menu item you tapped (that was the Fire TV remote highlight showing on
  a touch screen); the current page is shown the normal way. Remote highlights only appear on the Fire Stick.
- Phone menu is a slim text column, so the categories keep their extra width.
- The guide redraws itself when the phone is turned or the window resized.

## 3.7 — Phone layout fixed
- **Phone: the guide and category lists scroll again.** The layout was taller than the screen, so the lists had
  nothing to scroll inside and the bottom was cut off. The page now always fits the screen.
- **Phone: wider categories.** The left menu is now icons only (Search, TV guide, Films, Series, Favourites,
  Recently watched, Settings, Switch playlist), giving the category list about 60% more width; long category names
  wrap onto two lines instead of being cut off.
- **Menu icons everywhere**: clean line icons next to every item in the left menu on PC and Fire TV too.

## 3.6 — Search asks first, voice search, no more freezing
- **Search asks before you type**: "What are you looking for?" – Live TV, Films or Series (and Speak on the
  Fire Stick / phone). Then the box opens. Changing Live TV / Films / Series afterwards keeps what you typed and
  no longer pops the keyboard back up. Back from the results returns to the question.
- **Say it in any order**: "Liverpool live TV", "live TV Liverpool", "Bad Boys movie", "film Bad Boys",
  "Friends TV show", "Friends series". The app picks Live TV / Films / Series from what you say and searches for
  the rest. Works with the Speak tile and mic button (phone: Google voice typing), with the Fire TV keyboard's
  voice dictation (hold the remote's mic button while the keyboard is open), and when typed.
- **Search no longer freezes**: the programme guide is now searched in small background slices, so the remote and
  keyboard stay responsive and results appear as soon as they're ready. Match cards and channel names are worked
  out once and remembered instead of on every key press, and the guide downloads and is read piece by piece.
- Fixed (later build): search still froze on the Fire Stick – mostly the first search after starting, and the
  first film search. Tested on a simulated Fire Stick (PC slowed down 8×) with 15,000 channels, 175,000 guide
  programmes and 40,000 films: the longest freeze went from about 3 seconds to about a tenth of a second while
  typing. What changed: channel names, film titles and suggestions are now prepared in the background just after
  start-up instead of on your first key press; match cards are worked out just after the list is on screen;
  times are formatted without the slow built-in clock formatter; the guide is read in smaller pieces.
- Changed (later build): the Fire Stick's mic button always goes to Alexa – Amazon doesn't let apps use it, and Fire
  TV has no speech service apps can borrow. So the Speak tile and mic button now only appear where voice works (phones).
  On the Fire Stick, voice still works through the Amazon Fire TV phone app: open the search box, tap the keyboard
  icon in the Fire TV app, and use your phone keyboard's mic – "Liverpool live TV" etc. is understood as normal.

## 3.5 — Phone in landscape, cleaner search
- **Phones go landscape once you're signed in** (turn the phone either way round). The sign-in page still works
  upright so typing is easy.
- **Landscape phone layout tightened**: slimmer menu and category columns, narrower channel-name column, so the
  guide gets most of the screen.
- **Search redesigned without emojis**: Live TV / Films / Series is now a single segmented switch with clean line
  icons, and suggestions and the Search menu item use a proper magnifier icon (PC, Fire TV and phone).

## 3.4 — Search suggestions, proper phone layout
- **Suggestions as you type** in Search and in the Films / Series search box: programme titles, channels and teams for
  Live TV; titles for films and series. Built once in the background, so each keystroke takes about a millisecond and
  the main search isn't slowed down. PC: ↑ ↓ + Enter to pick; TV: ▼ from the search box; phone: tap.
- **Phones get a phone layout** instead of the TV's: works in portrait (no more forced landscape and split keyboard),
  a tab bar along the bottom (Search · TV guide · Movies · Series · Favourites · Settings), categories as a strip you
  swipe sideways, the picture across the top of the guide, smaller posters in Films/Series, and the page shrinks above
  the keyboard instead of being covered. Full-screen video turns sideways and turns back afterwards. Landscape phones
  get a compact version of the full layout.
- Phones: no remote-control highlight on start-up.
- Fixed (later build): on real phones the layout stayed TV-sized in portrait – the app now chooses the phone
  layout width before the page loads.
- Fixed (later build): some phones were mistaken for a TV and locked sideways. Phones now always follow the way you
  hold them, the keyboard no longer splits, and the sign-in page shows the version and "phone layout" so you can
  check you have the new build.
- Fixed (later build): the real cause of the sideways phone – on start-up the app jumped straight into your last
  channel *full screen*, and full screen locks the phone sideways. Phones now open the last channel in the guide's
  picture at the top, upright; tap the picture for full screen (sideways), Back to return upright.

## 3.3 — Search Live TV / Films / Series, Netflix-style Series
- **Search asks what to search:** *Live TV* (channels, programmes, match cards – as before), *Films* or *Series*.
  Films and series results show the poster, year, category and rating; picking one opens its details.
- **Series** is now Netflix-style like Films: featured series, Continue watching (shows the episode, e.g. S2 E4),
  Recommended for you, New additions, Top rated, favourite and other categories.
- Series details: seasons and episodes, ▶ Resume / Next episode (carries on mid-episode, or moves to the next one,
  including into the next season), + My list.
- Episodes remember where you stopped, like films.

## 3.2 — Films, Netflix-style (Fire TV, phone and PC)
- **Movies** is now a Netflix-style browser: a large featured film at the top (backdrop, plot, rating, ▶ Play,
  More info), then rows of posters that scroll sideways:
  Continue watching · Recommended for you · Because you watched … · New additions · Top rated ·
  your ★ favourite categories · then every other category (with "See all").
- **Recommendations** for films you haven't seen: scored by the categories you watch (recent ones count more) and the
  categories you've starred, plus rating and how recently the film was added; anything you've watched is left out.
  Picks rotate a little each day.
- **Resume:** films remember where you stopped – *Continue watching* shows a progress bar, and the details page offers
  ▶ Resume from 42:10 or ↺ Start again. Films over 90 % watched count as seen.
- Film details: backdrop, year, running time, genre, rating, plot, cast and director, + My list (favourites).
- Search films from the box at the top.
- Playing a film takes over the whole window (TV: full screen with the remote's play/pause/seek); Back or Esc returns
  to Films.
- Fire TV remote: up/down move between rows (scrolling to rows below the screen), left/right along a row, left from
  the first poster goes to the menu.

## 3.1 — Favourite categories (Fire TV, phone and PC)
- Star categories to pin them to the top of the category list (marked ★, in the order you starred them), per
  playlist and per section (TV, films, series). The TV guide opens on your first favourite category.
  - Fire TV: hold OK (or press ☰) on a category → ★ Add category to favourites.
  - PC: right-click a category.
- PC brought up to 3.1 with the shared interface changes (search speed-ups, favourite categories).

## 3.0 (later builds) — Faster channels and full screen
- Search no longer freezes the Fire Stick: the full programme guide (~20 MB) is now read in small pieces in the
  background shortly after start-up, with the search text prepared once, so pressing Search is instant and you can
  scroll straight away. Each search scans the guide once (shared by the match cards and the programme list) and
  waits until you pause typing on the TV keyboard.
- Channels start faster: the picture appears after ~0.5 s of video instead of 2.5 s, the first recording chunks are
  shorter, and keyframes are found in the picture data itself – channels that don't flag them (previously several
  seconds slower) now start as quickly as the rest. Long gaps between keyframes no longer hold the stream up.
- Full screen is near-instant: the video now always sits underneath the page, so going full screen just stretches it
  instead of re-stacking and redrawing everything (which took 1–2 s on a Fire Stick).
- "Connecting…" / error messages now show over the picture area on the TV.
- Going full screen no longer flashes the guide over the picture for a split second (the guide hides first, then
  the picture stretches).
- Fixed: with no last channel to resume, the first channel you picked jumped straight to full screen.

## 3.0 — Phones too
- The same app now works on Android phones and tablets as well as Fire TV / Android TV – it detects which it's on.
- On a phone:
  - tap the small picture (or a channel twice) for full screen; the back button returns to the guide,
  - full screen: tap for the info banner with ⏪ ❚❚ ⏩ and ✕ (exit) buttons; double-tap the left/right side to jump
    10 s; swipe up/down to change channel,
  - live delay, 30-minute pause/rewind and the banner work the same as on the TV.
- TV / Fire TV unchanged (remote only, no on-screen buttons).
- Install on a phone: open the latest-release link in the phone's browser and allow it to install apps.

## 2.9 (later builds) — Remote-only rewind / fast-forward
- On-screen ⏪ ❚❚ ⏩ / LIVE buttons removed from the banner – the remote's own buttons do it:
  ⏪ ⏩ rewind / fast-forward (×2 → ×6 → ×12 → ×30), ▶❚❚ pause/play (hold = back to live), ◀ ▶ jump 10 s,
  OK shows the banner (OK again = pause/play). The banner and the centre box show how far behind live you are,
  updating as you rewind or fast-forward.
- Fixed: rewind / fast-forward kept snapping back to the nearest keyframe, so slow speeds barely moved or jumped
  about. They now move steadily.
- Pause & rewind now goes up to **30 minutes** (new default). Uses about 1.4 GB of storage for an HD channel; the
  recording automatically gives space back if the Stick drops below ~400 MB free.

## 2.9 — Live delay, pause, rewind & info banner (Fire TV)
- **Live delay (stops buffering):** live channels play a little behind live and keep that in reserve, so short drops in
  the stream no longer freeze the picture or skip ahead. Builds up by playing at 97 % speed – no wait when changing
  channel. Settings → *Live delay*: Off / 10 / 15 (default) / 20 / 30 s.
- **Pause, rewind and fast-forward live TV:** the channel is recorded to a rolling buffer while you watch.
  Settings → *Pause & rewind up to*: 3 / 5 (default) / 10 / 20 minutes.
  - ⏪ ⏩ on the remote: ×2 → ×6 → ×12 → ×30 per press; ▶❚❚ resumes. Fast-forward stops at live.
  - ◀ ▶ while watching: jump back / forward 10 seconds.
  - ▶❚❚: pause / play. Hold ▶❚❚: jump back to live.
- **Info banner (OK button):** set-top-box style banner along the bottom – channel number and logo, NOW programme with
  start/end times and a progress bar, where you are vs. live, time left, the clock, NEXT programme, and how far behind
  live you are. Settings → *Info banner*: hide after 5 s / 10 s / stay until Back.
- Leaving the app (Home) now releases the provider connection; coming back starts the channel again at live.
- Channels that stop sending show a clear message instead of an endless spinner.

## 2.8 — New logo
- Orange play-triangle "S" logo: Fire TV home-screen banner, app icon, sidebar, login and start-up screens.
- **PC:** window/taskbar icon, `starktv.ico` for shortcuts.
- Fire TV: icon/banner renamed so the home screen drops its cached copy of the old logo.

## 2.7 — Straight into TV
- Saved login: a short start-up screen instead of the login page flashing up; the Fire TV opens the last channel full
  screen. The login page only appears with no saved playlist, a failed connection, or *Switch playlist*.

## 2.6 — Fire TV app
- New Android TV / Fire TV app built on GitHub (Media3 player with FFmpeg audio, so Dolby/MP2 channels have sound).
- Remote navigation: arrows, OK, Back; guide rows don't jump to the categories at the end of the list; holding the
  arrows scrolls smoothly; left/right stay on the same channel row.
- Picking a channel plays it in the small window; OK on it again goes full screen. Up/Down change channel full screen.
- Favourites: hold OK (or ☰) on a channel; ☰ while watching stars the current channel.
- Version shown in full in the sidebar.
- **PC:** VLC can play inside StarkTV (Settings → Player: Automatic / Always VLC / Built-in only); automatic mode
  switches to VLC for channels with no sound. "Open in VLC" installs VLC if it's missing. Guide programme titles stay
  readable when a programme started off-screen.

## 2.5 — PC
- Renamed **StarkTV** (was Tidewatch IPTV); version in the window title and exe name.
- No-sound check with an Unmute / Open-in-VLC prompt; clearer handling of provider error 469 (connection limit).

## 2.3 – 2.4
- **Search** is its own section (Ctrl+F or /); Live TV merged into the TV guide.
- Smarter search: topics (*running* → marathons, athletics…), nicknames (*spurs*, *man utd*), typo tolerance, any word order,
  programme categories.
- Live sport without two sides (marathons, races, golf) gets its own card.

## 2.0 – 2.2
- Match & event cards: real kick-off times from ESPN (football, rugby, UFC), cricket from the guide, which channels show
  it and when TV coverage starts. Repeats/highlights are never treated as the live match; LIVE / REPEAT tags.
- Event-channel times read correctly (US Eastern, month names), ended events no longer badged.

## 1.8 – 1.9
- Programme search across the whole guide (not just channel names in one category), start times and countdowns.

## 1.7
- Original Tidewatch IPTV (PC): Xtream/M3U playlists, TV guide, favourites, recently watched, VLC hand-off.
