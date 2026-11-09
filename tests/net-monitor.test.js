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
    const stat = () => JSON.stringify({ state: 'playing', live: true, timeshift: true, behind: 15000, delay: 15000, net: window.__net });
    window.AndroidBridge = { loadProfiles: () => JSON.stringify(prof), saveProfiles: () => true, log: () => {}, status: stat, refreshStatus: stat, play: u => (window.__calls.push('play:' + u), true), stop: () => {}, togglePause: () => {}, setBounds: () => {}, setVisible: () => {},
      setFullscreen: v => window.__calls.push('full:' + v), exitApp: () => {}, toast: t => window.__calls.push('toast:' + t), version: () => '4.0.1', setOptions: o => window.__calls.push('opt:' + o), isTv: () => true, voiceSearch: () => {}, hasVoice: () => false, exitFull: () => {} }; });
  await p.goto('file://' + ROOT + '/app/src/main/assets/web/index.html'); await p.waitForTimeout(2000);
  console.log('lower UHD:', await p.evaluate(() => lowerVersions(S.items.live[0]).map(c => c.name)), 'lower TNT:', await p.evaluate(() => lowerVersions(S.items.live[4]).map(c => c.name)));
  console.log('quality', await p.evaluate(() => S.items.live.map(c => c.name + '=' + qualityOf(c.name) + '|' + baseOf(c.name))));
  await p.evaluate(() => openItem({ ...S.items.live[0], kind: 'live' })); await p.waitForTimeout(1500);
  await p.evaluate(() => { window.__net = { stalls1: 0, stalls10: 1, down: 5200, need: 5800, factor: 0.95, ahead: 9000 }; }); await p.waitForTimeout(2500);
  console.log('dot', await p.evaluate(() => [$('#netDot').hidden, $('#netDot').className, $('#netDot').textContent]));
  await p.screenshot({ path: OUT + 'net-dot.png' });
  await p.evaluate(() => { window.__net = { stalls1: 1, stalls10: 2, down: 5000, need: 19800, factor: 0.25, ahead: 2000 }; }); await p.waitForTimeout(6800);
  console.log('countdown', await p.evaluate(() => [$('#netSwitch').hidden, $('#netSwitch .ns-n')?.textContent, $('#netSwitch .ns-to')?.textContent.trim()]));
  await p.screenshot({ path: OUT + 'net-cd.png' });
  await p.waitForTimeout(5200);
  console.log('after', await p.evaluate(() => [S.current?.name, $('#netSwitch').hidden]), await p.evaluate(() => window.__calls.filter(c => !c.startsWith('full'))));
  // 4K start with a slow speed test on record: countdown, then Back = stay
  await p.evaluate(() => { store.set('netTest', { kbps: 6100, at: Date.now() }); window.__net = { stalls1: 0, stalls10: 0, down: 6000, need: 5800, factor: 1, ahead: 15000 }; openItem({ ...S.items.live[0], kind: 'live' }); }); await p.waitForTimeout(2500);
  console.log('pre-warn', await p.evaluate(() => [$('#netSwitch').hidden, $('#netSwitch .ns-why')?.textContent]));
  console.log('back handled', await p.evaluate(() => window.__tvBack()), await p.evaluate(() => [$('#netSwitch').hidden, S.current.name]));
  // OSD line
  await p.evaluate(() => { window.__osdKey('ok'); }); await p.waitForTimeout(700);
  console.log('osd line', await p.evaluate(() => $('#osd .osd-r4')?.textContent.trim()));
  // settings speed test (falls back to provider file)
  await p.evaluate(() => $('#btnSettings').click()); await p.waitForTimeout(300);
  await p.evaluate(() => $('#btnSpeed').click()); await p.waitForTimeout(9000);
  console.log('speed', await p.evaluate(() => $('#speedOut').innerText));
  await p.screenshot({ path: OUT + 'net-settings.png' });
  console.log(errs); await b.close(); })();
