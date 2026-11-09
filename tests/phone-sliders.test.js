const { chromium } = require('playwright');
const ROOT = require('path').resolve(__dirname, '..'); const OUT = ROOT + '/tests/out/';

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 800, height: 370 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); const now = Math.floor(Date.now()/1000);
  const chans = [['Sky Sports Main Event UHD', 'SkySpMainEvent.uk'], ['UK: Sky Sports Main Event FHD', 'SkySpMainEvent.uk'], ['UK: Sky Sports Main Event HD', 'SkySpMainEvent.uk'], ['UK: Sky Sports Main Event SD', ''], ['TNT Sports 1 HD', 'tnt1'], ['BBC One HD', 'bbc1']];
  await p.route('http://mock.test/**', r => { const u = r.request().url(); const act = (u.match(/action=([a-z_]+)/) || [])[1];
    if (u.includes('xmltv.php')) return r.fulfill({ status: 200, body: '<tv>' + 'x'.repeat(3e6) + '</tv>' });
    let body = '[]'; if (!act) body = JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: String(now + 9e6) } });
    else if (act === 'get_live_categories') body = JSON.stringify([{ category_id: 1, category_name: 'UK | Sky Sports' }, { category_id: 2, category_name: 'UK | Sports' }]);
    else if (act === 'get_live_streams') body = JSON.stringify(chans.map(([n, e], i) => ({ stream_id: i + 1, name: n, category_id: i < 3 ? 1 : 2, num: i + 1, epg_channel_id: e })));
    r.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.route('https://**', r => r.abort());
  await p.addInitScript(() => { const prof = { profiles: [{ id: 'p1', name: 'Home', type: 'xtream', server: 'http://mock.test', user: 'u', pass: 'p' }], last: 'p1', autoConnect: true };
    window.__net = { stalls1: 0, stalls10: 0, down: 6200, need: 5800, factor: 1.0, ahead: 15000 }; window.__calls = [];
    const stat = () => JSON.stringify({ state: 'playing', live: true, timeshift: true, full: window.__full || false, behind: 15400, delay: 15000, net: window.__net });
    window.AndroidBridge = { loadProfiles: () => JSON.stringify(prof), saveProfiles: () => true, log: () => {}, status: stat, refreshStatus: stat, play: u => (window.__calls.push('play:' + u), true), stop: () => {}, togglePause: () => {}, setBounds: () => {}, setVisible: () => {},
      setFullscreen: v => window.__calls.push('full:' + v), exitApp: () => {}, toast: t => window.__calls.push('toast:' + t), version: () => '4.0.1', setOptions: o => window.__calls.push('opt:' + o), isTv: () => false, getBrightness: () => 0.6, setBrightness: v => window.__calls.push('br:' + v.toFixed(2)), getVolume: () => 0.4, setVolume: v => window.__calls.push('vol:' + v.toFixed(2)), jumpBy: () => {}, trick: () => {}, pip: () => true, enterPip: () => {}, setOrientation: () => {}, voiceSearch: () => {}, hasVoice: () => false, exitFull: () => {} }; });
  await p.goto('file://' + ROOT + '/app/src/main/assets/web/index.html?phone=1'); await p.waitForTimeout(2000);
  await p.evaluate(() => openItem({ ...S.items.live[1], kind: 'live' })); await p.waitForTimeout(1500);
  await p.evaluate(() => { window.__full = true; window.__nativeState(JSON.parse(window.AndroidBridge.status())); document.documentElement.classList.add('tv-full'); }); await p.waitForTimeout(500);
  await p.evaluate(() => { const S0 = window.S; }); 
  await p.evaluate(() => { S.tvFull = true; window.__osdKey('ok'); }); await p.waitForTimeout(600);
  console.log('sliders', await p.evaluate(() => [$('#slBright').hidden, $('#slVol').hidden, $('#slBright').innerText, $('#slVol').innerText]));
  await p.screenshot({ path: OUT + 'sliders.png' });
  const r = await p.evaluate(() => { const b = $('#slVol .vs-track').getBoundingClientRect(); return [b.left + 4, b.top, b.height]; });
  await p.mouse.move(r[0], r[1] + r[2] * 0.5); await p.mouse.down(); await p.mouse.move(r[0], r[1] + r[2] * 0.1, { steps: 4 }); await p.mouse.up();
  console.log('calls', await p.evaluate(() => window.__calls.filter(c => /^(br|vol)/.test(c)).slice(-3)), await p.evaluate(() => $('#slVol').innerText));
  console.log(errs); await b.close(); })();
