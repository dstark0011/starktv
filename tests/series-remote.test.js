const { chromium } = require('playwright');
const ROOT = require('path').resolve(__dirname, '..'); const OUT = ROOT + '/tests/out/';
 const fs = require('fs');
(async () => { const PH = process.argv[2] === 'phone';
  const b = await chromium.launch(); const ctx = PH ? await b.newContext({ viewport: { width: 800, height: 370 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }) : await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); const now = Math.floor(Date.now()/1000);
  await p.route('http://img.test/**', r => { const f = r.request().url().split('/').pop(); r.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(ROOT + '/tests/fixtures/posters/' + f) }); });
  await p.route('http://mock.test/**', r => { const u = r.request().url(); const act = (u.match(/action=([a-z_]+)/) || [])[1]; let body = '[]';
    if (!act) body = JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: String(now + 9e6) } });
    else if (act === 'get_live_categories') body = JSON.stringify([{ category_id: 1, category_name: 'UK' }]);
    else if (act === 'get_live_streams') body = JSON.stringify([{ stream_id: 1, name: 'BBC One', category_id: 1 }]);
    else if (act === 'get_series_categories') body = JSON.stringify([{ category_id: 31, category_name: 'Drama' }, { category_id: 32, category_name: 'Comedy' }]);
    else if (act === 'get_series') body = JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ series_id: 900 + i, name: 'Show ' + i, category_id: 31 + (i % 2), cover: `http://img.test/p${(i % 20) + 1}.jpg`, rating: '7' })));
    else if (act === 'get_series_info') body = JSON.stringify({ info: { plot: 'A show.' }, episodes: { '1': Array.from({ length: 24 }, (_, k) => ({ id: '7' + k, episode_num: k + 1, title: 'Episode title ' + (k + 1), container_extension: 'mkv' })), '2': Array.from({ length: 10 }, (_, k) => ({ id: '8' + k, episode_num: k + 1, title: 'S2 ep ' + (k + 1), container_extension: 'mkv' })) } });
    r.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.route('https://**', r => r.abort());
  await p.addInitScript(([ph]) => { const prof = { profiles: [{ id: 'p1', name: 'Home', type: 'xtream', server: 'http://mock.test', user: 'u', pass: 'p' }], last: 'p1', autoConnect: true };
    window.AndroidBridge = { loadProfiles: () => JSON.stringify(prof), saveProfiles: () => true, log: () => {}, status: () => '{}', refreshStatus: () => '{}', play: () => true, stop: () => {}, togglePause: () => {}, setBounds: () => {}, setVisible: () => {},
      setFullscreen: () => {}, exitApp: () => {}, toast: () => {}, version: () => '4.17.1', versionCode: () => 999, setOptions: () => {}, isTv: () => !ph, setOrientation: () => {} }; }, [PH]);
  await p.goto('file://' + ROOT + '/app/src/main/assets/web/index.html' + (PH ? '?phone=1' : '')); await p.waitForTimeout(1500);
  const foc = () => p.evaluate(() => { const a = document.activeElement; return (a.className || a.tagName) + ' | ' + (a.textContent || '').trim().slice(0, 25); });
  if (PH) {
    await p.tap('.rail-btn[data-sec="series"]'); await p.waitForTimeout(1500);
    console.log('section', await p.evaluate(() => S.section));
    await p.evaluate(() => itemModal({ ...S.items.series[0], kind: 'series' })); await p.waitForTimeout(800);
    console.log('modal scroll', await p.evaluate(() => { const els = [...document.querySelectorAll('#nfModal *')].filter(e => { const s = getComputedStyle(e); return /auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight; }); return els.map(e => e.className + ' ' + e.scrollHeight + '/' + e.clientHeight); }), await p.evaluate(() => getComputedStyle(document.querySelector('.nf-modal')).overflowY + ' ' + getComputedStyle(document.querySelector('.nf-dlg')).overflowY));
    await p.screenshot({ path: OUT + 'ser-phone.png' });
  } else {
    await p.evaluate(() => document.querySelector('.rail-btn[data-sec="series"]').focus());
    await p.keyboard.down('Enter'); await p.waitForTimeout(80); await p.keyboard.up('Enter'); await p.waitForTimeout(1500);
    console.log('after OK on Series:', await p.evaluate(() => S.section), await foc());
    for (const k of ['ArrowDown', 'ArrowDown', 'ArrowDown']) { await p.keyboard.press(k); await p.waitForTimeout(250); console.log(k, await p.evaluate(() => S.section), await foc()); }
    await p.evaluate(() => itemModal({ ...S.items.series[0], kind: 'series' })); await p.waitForTimeout(800);
    await p.keyboard.press('ArrowDown'); await p.waitForTimeout(150); console.log('down1', await foc());
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(150); console.log('right', await foc());
    await p.keyboard.down('Enter'); await p.waitForTimeout(80); await p.keyboard.up('Enter'); await p.waitForTimeout(300);
    console.log('after picking season 2', await foc());
    for (let i = 0; i < 4; i++) { await p.keyboard.press('ArrowDown'); await p.waitForTimeout(150); console.log(' down', await foc(), await p.evaluate(() => S.section)); }
    await p.screenshot({ path: OUT + 'ser-tv.png' });
  }
  console.log(errs); await b.close(); })();
