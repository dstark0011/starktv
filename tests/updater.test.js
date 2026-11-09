const { chromium } = require('playwright');
const ROOT = require('path').resolve(__dirname, '..'); const OUT = ROOT + '/tests/out/';

(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); const errs = []; p.on('pageerror', e => errs.push(e.message)); const now = Math.floor(Date.now()/1000);
  await p.route('http://mock.test/**', r => { const u = r.request().url(); const act = (u.match(/action=([a-z_]+)/) || [])[1]; let body = '[]';
    if (!act) body = JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: String(now + 9e6) } });
    else if (act === 'get_live_categories') body = JSON.stringify([{ category_id: 1, category_name: 'UK' }]);
    else if (act === 'get_live_streams') body = JSON.stringify([{ stream_id: 1, name: 'BBC One', category_id: 1 }]);
    r.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.route('https://api.github.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tag_name: 'build-99', name: 'StarkTV 4.17.99 — Automatic updates', body: '- **Automatic updates**: StarkTV checks GitHub.\n- Second thing\n\nInstall on...', assets: [{ name: 'StarkTV.apk', browser_download_url: 'https://github.com/x/StarkTV.apk' }, { name: 'StarkTV-Windows.zip', browser_download_url: 'https://github.com/x/w.zip' }] }) }));
  await p.route('https://**', r => r.abort());
  await p.addInitScript(() => { window.__c = []; const prof = { profiles: [{ id: 'p1', name: 'Home', type: 'xtream', server: 'http://mock.test', user: 'u', pass: 'p' }], last: 'p1', autoConnect: true };
    window.AndroidBridge = { loadProfiles: () => JSON.stringify(prof), saveProfiles: () => true, log: () => {}, status: () => '{}', refreshStatus: () => '{}', play: () => true, stop: () => {}, togglePause: () => {}, setBounds: () => {}, setVisible: () => {},
      setFullscreen: () => {}, exitApp: () => {}, toast: () => {}, version: () => '4.16.50', versionCode: () => window.__vc ?? 50, installUpdate: u => window.__c.push('install:' + u), setOptions: () => {}, isTv: () => true }; });
  await p.goto('file://' + ROOT + '/app/src/main/assets/web/index.html'); await p.waitForTimeout(1500);
  const r1 = await p.evaluate(() => updCheck(true)); console.log('check', r1);
  await p.screenshot({ path: OUT + 'upd.png' });
  console.log('focus', await p.evaluate(() => document.activeElement.textContent));
  await p.evaluate(() => document.querySelector('#updPop [data-up="go"]').click()); await p.evaluate(() => window.__updProgress(42));
  console.log(await p.evaluate(() => [window.__c, $('#updMsg').textContent]));
  await p.evaluate(() => { window.__vc = 99; $('#updPop').hidden = true; }); console.log('uptodate', await p.evaluate(() => updCheck(true)));
  console.log(errs);

  // --- Fire Stick self-install: new builds go in on their own, no pop-up, no "Update now" tap ---
  const p2 = await b.newPage({ viewport: { width: 1280, height: 720 } }); const errs2 = []; p2.on('pageerror', e => errs2.push(e.message));
  await p2.route('http://mock.test/**', r => { const u = r.request().url(); const act = (u.match(/action=([a-z_]+)/) || [])[1]; let body = '[]';
    if (!act) body = JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: String(now + 9e6) } });
    else if (act === 'get_live_categories') body = JSON.stringify([{ category_id: 1, category_name: 'UK' }]);
    else if (act === 'get_live_streams') body = JSON.stringify([{ stream_id: 1, name: 'BBC One', category_id: 1 }]);
    r.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p2.route('https://api.github.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tag_name: 'build-99', name: 'StarkTV 4.21.99 — Fire Stick updates itself', body: '- **Self update**: the stick updates itself.\n\nInstall...', assets: [{ name: 'StarkTV.apk', browser_download_url: 'https://github.com/x/StarkTV.apk' }] }) }));
  await p2.route('https://**', r => r.abort());
  await p2.addInitScript(() => { window.__c = []; const prof = { profiles: [{ id: 'p1', name: 'Home', type: 'xtream', server: 'http://mock.test', user: 'u', pass: 'p' }], last: 'p1', autoConnect: true };
    window.AndroidBridge = { loadProfiles: () => JSON.stringify(prof), saveProfiles: () => true, log: () => {}, status: () => '{}', refreshStatus: () => '{}', play: () => true, stop: () => {}, togglePause: () => {}, setBounds: () => {}, setVisible: () => {},
      setFullscreen: () => {}, exitApp: () => {}, toast: t => window.__c.push('toast:' + t), version: () => '4.20.90', versionCode: () => 90, installUpdate: u => window.__c.push('install:' + u), setOptions: () => {}, isTv: () => true, selfInstall: () => true }; });
  await p2.goto('file://' + ROOT + '/app/src/main/assets/web/index.html'); await p2.waitForTimeout(1500);
  // while watching full screen: an update must NOT interrupt
  await p2.evaluate(() => { S.tvFull = true; window.__c = []; }); console.log('auto while watching', await p2.evaluate(() => updCheck(false)), await p2.evaluate(() => [window.__c.filter(x => x.startsWith('install')), $('#updPop').hidden]));
  // on the menu: it installs by itself, pop-up stays hidden
  await p2.evaluate(() => { S.tvFull = false; S.autoUpdating = null; window.__c = []; }); console.log('auto on menu', await p2.evaluate(() => updCheck(false)), await p2.evaluate(() => [window.__c, $('#updPop').hidden]));
  // setting off: fall back to the old "Update available" box instead of auto-installing
  await p2.evaluate(() => { S.settings.autoUpdate = false; S.autoUpdating = null; $('#updPop').hidden = true; window.__c = []; }); console.log('auto off', await p2.evaluate(() => updCheck(false)), await p2.evaluate(() => [window.__c.filter(x => x.startsWith('install')), $('#updPop').hidden]));
  console.log('errs2', errs2);
  await b.close(); })();
