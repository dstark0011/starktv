const { chromium } = require('playwright');
const ROOT = require('path').resolve(__dirname, '..'); const OUT = ROOT + '/tests/out/';

(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
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
      setFullscreen: v => window.__calls.push('full:' + v), exitApp: () => {}, toast: t => window.__calls.push('toast:' + t), version: () => '4.0.1', setOptions: o => window.__calls.push('opt:' + o), isTv: () => true, voiceSearch: () => {}, hasVoice: () => false, exitFull: () => {} }; });
  await p.goto('file://' + ROOT + '/app/src/main/assets/web/index.html'); await p.waitForTimeout(2000);
  await p.evaluate(() => { S.settings.clock = 'on'; openItem({ ...S.items.live[4], kind: 'live' }); }); await p.waitForTimeout(2500);
  console.log('small', await p.evaluate(() => [$('#clockOv').hidden, $('#clockOv').innerText.replace(/\n/g, ' | ')]));
  await p.screenshot({ path: OUT + 'clock-small.png' });
  await p.evaluate(() => { window.__full = true; window.__nativeState(JSON.parse(window.AndroidBridge.status())); document.documentElement.classList.add('tv-full'); }); await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + 'clock-full.png' });
  console.log('full', await p.evaluate(() => $('#clockOv').className));
  console.log(errs); await b.close(); })();
