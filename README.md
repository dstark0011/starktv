# StarkTV for Fire TV / Android TV

Same StarkTV as on the PC (guide, smart search, match cards, favourites, films and series), with the TV's own video
player underneath so Dolby and other broadcast audio formats play with sound.

## Build
Every push to `main` builds the app on GitHub (Actions tab) and publishes `StarkTV.apk` as the latest release.

## Install on the Fire TV
1. Fire TV: Settings → My Fire TV → Developer options → **Install unknown apps** → turn on for **Downloader**
   (if Developer options is hidden: Settings → My Fire TV → About → click the device name 7 times).
2. Install **Downloader** (by AFTVnews) from the Amazon Appstore.
3. In Downloader, enter: `https://github.com/dstark0011/starktv/releases/latest/download/StarkTV.apk`
4. Install, open StarkTV, add your playlist once.

## Install on an Android phone
Open `https://github.com/dstark0011/starktv/releases/latest/download/StarkTV-Phone.apk` in Chrome, tap the download,
and allow Chrome to install apps when asked.

Updates: repeat step 3 – it installs over the old version and keeps your login.

## Remote
- Arrows move around, OK selects, Back goes back (Back twice on the guide exits).
- Watching full screen: Up/Down change channel, Back shows the guide with the picture still playing.
- Menu (☰): favourites for the highlighted channel.
- Films/series full screen: OK shows play/pause and the seek bar.
