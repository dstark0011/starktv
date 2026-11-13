// Real-touch test for the phone: tap the live picture to go full screen, then tap again to show the controls.
// Unlike phone-osd.test.js (which forces tv-full by hand and uses the remote __osdKey path), this drives the
// actual touch handlers: page.tap() on the video box and on #touchpad.
const { chromium } = require('playwright');
const ROOT = require('path').resolve(__dirname, '..'); const OUT = ROOT + '/tests/out/';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 800, height: 370 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); const now = Math.floor(Date.now() / 1000);
  await p.route('http://mock.test/**', r => { const u = r.request().url(); const act = (u.match(/action=([a-z_]+)/) || [])[1];
    if (u.includes('xmltv.php')) return r.fulfill({ status: 200, body: '<tv></tv>' });
    let body = '[]'; if (!act) body = JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: String(now + 9e6) } });
    else if (act === 'get_live_categories') body = JSON.stringify([{ category_id: 1, category_name: 'UK' }]);
    else if (act === 'get_live_streams') body = JSON.stringify([{ stream_id: 1, name: 'BBC One HD', category_id: 1, num: 1, epg_channel_id: 'bbc1' }]);
    r.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.route('https://**', r => r.abort());
  await p.addInitScript(() => {
    const prof = { profiles: [{ id: 'p1', name: 'Home', type: 'xtream', server: 'http://mock.test', user: 'u', pass: 'p' }], last: 'p1', autoConnect: true };
    window.__full = false; window.__calls = [];
    const stat = () => JSON.stringify({ state: 'playing', live: true, timeshift: true, full: window.__full, behind: 15400, delay: 15000, window: 600000, pos: 584600 });
    // native contract: when the page asks for full screen, the real app flips the flag, tells the page, and streams state back
    const goFull = on => { window.__full = on; window.__calls.push('full:' + on); if (window.__tvFullMode) window.__tvFullMode(on); if (window.__nativeState) window.__nativeState(JSON.parse(stat())); };
    window.AndroidBridge = { loadProfiles: () => JSON.stringify(prof), saveProfiles: () => true, log: () => {}, status: stat, refreshStatus: stat,
      play: u => (window.__calls.push('play:' + u), true), stop: () => {}, togglePause: () => window.__calls.push('pp'), setBounds: () => {}, setVisible: () => {},
      setFullscreen: v => goFull(!!v), exitFull: () => goFull(false), exitApp: () => {}, toast: t => window.__calls.push('toast:' + t),
      version: () => '4.0.1', setOptions: () => {}, isTv: () => false, getBrightness: () => 0.6, setBrightness: v => window.__calls.push('br:' + v.toFixed(2)),
      getVolume: () => 0.4, setVolume: v => window.__calls.push('vol:' + v.toFixed(2)), jumpBy: () => {}, trick: () => {}, pip: () => true, enterPip: () => {},
      seekTo: () => {}, goLive: () => {}, setOrientation: () => {}, voiceSearch: () => {}, hasVoice: () => false, tracks: () => '{}', chooseTrack: () => {} }; });
  await p.goto('file://' + ROOT + '/app/src/main/assets/web/index.html?phone=1'); await p.waitForTimeout(1500);

  // play a live channel from the guide (phone: this plays in the box, NOT full screen)
  await p.evaluate(() => openItem({ ...S.items.live[0], kind: 'live' })); await p.waitForTimeout(1200);
  console.log('after play: tvFull=', await p.evaluate(() => !!S.tvFull), ' engine=', await p.evaluate(() => S.engineNow), ' calls=', await p.evaluate(() => window.__calls.slice()));

  // TAP 1: the picture → should go full screen
  await p.tap('#playerWrap'); await p.waitForTimeout(500);
  console.log('after tap box: tvFull=', await p.evaluate(() => !!S.tvFull), ' tv-full class=', await p.evaluate(() => document.documentElement.classList.contains('tv-full')), ' touchpad display=', await p.evaluate(() => getComputedStyle($('#touchpad')).display));

  // TAP 2: the screen (touchpad) → should show the OSD: play/pause + brightness + volume
  await p.tap('#touchpad'); await p.waitForTimeout(600);
  console.log('after tap screen: osd hidden=', await p.evaluate(() => $('#osd').hidden),
    ' playpause=', await p.evaluate(() => !!document.querySelector('#osd [data-act="pp"]')),
    ' bright hidden=', await p.evaluate(() => $('#slBright').hidden), ' vol hidden=', await p.evaluate(() => $('#slVol').hidden));
  await p.screenshot({ path: OUT + 'phone-tap-fs.png' });
  console.log('errs', errs); await b.close();
})();
