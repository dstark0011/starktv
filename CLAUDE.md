# CLAUDE.md – StarkTV

The full picture — platforms, build, architecture, tests and open issues — is in **HANDOVER.md**, which is kept out of this public repo (it has personal notes); ask Dave for it. This file is the rules for every change.

Rules for every change:

1. **Shared page code.** `app/src/main/assets/web/app.js` and `style.css` are the master copies. After editing them, run `tools/sync-web.sh` to copy them into `windows/app/`. The two `index.html` files are separate: add new page elements to both.
2. **Every build:**
   - Bump `versionName` (`"X.Y.$buildNo"`) in `app/build.gradle.kts` and `"version"` (`"X.Y.0"`) in `windows/package.json`.
   - Add a `## X.Y — title` entry at the top of `CHANGELOG.md`, written in plain English for Dave. The release name and the in-app update box come from it.
3. **Never change `app/starktv.keystore`** (password `starktv`). Installed copies only update if the key stays the same.
4. **Keep the `REQUEST_INSTALL_PACKAGES` permission out of the main manifest.** It belongs only in `src/tv/`, because phones show a Play Protect "harmful app" warning if it's there.
5. **Kotlin has no local compiler set up.** GitHub Actions is the compile check: push, then watch the run (`gh run watch`).
6. **Page changes:** test with the Playwright scripts in `tests/`. They use a fake provider and a fake `AndroidBridge`.
7. **UI style:**
   - UK English, no emoji in the UI.
   - The left menu is plain text.
   - Phones show no remote-focus highlight.
   - On the Fire Stick, never let the remote highlight escape a pop-up to the menu behind it.
8. **Windows `%AppData%\Tidewatch IPTV` folder:** never rename it. It holds Dave's saved logins.
