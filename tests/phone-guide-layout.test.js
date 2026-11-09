const { chromium } = require('playwright');
const ROOT = require('path').resolve(__dirname, '..'); const OUT = ROOT + '/tests/out/';
 const fs = require('fs');
(async () => {
  const b = await chromium.launch({ args: ['--touch-events=enabled'] }); const ctx = await b.newContext({ viewport: { width: 770, height: 347 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const live = fs.readFileSync(ROOT + '/tests/perf/live.json'); const now = Math.floor(Date.now()/1000);
  await p.route('http://mock.test/**', r => { const u = r.request().url(); const act = (u.match(/action=([a-z_]+)/) || [])[1];
    if (u.includes('xmltv.php')) return r.fulfill({ status: 200, body: '<tv></tv>' });
    let body = '[]'; if (!act) body = JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: String(now + 9e6) } });
    else if (act === 'get_live_categories') body = JSON.stringify(Array.from({length:60},(_, i)=>({ category_id: i+1, category_name: 'UK | Sky Sports Extra ' + i })));
    else if (act === 'get_live_streams') body = live;
    else if (act === 'get_short_epg' || act === 'get_simple_data_table') body = JSON.stringify({ epg_listings: [] });
    r.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.route('https://**', r => r.fulfill({ status: 200, body: '{"events":[]}' }));
  await p.addInitScript(() => { const prof = { profiles: [{ id: 'p1', name: 'Home', type: 'xtream', server: 'http://mock.test', user: 'u', pass: 'p' }], last: 'p1', autoConnect: true };
    window.AndroidBridge = { loadProfiles: () => JSON.stringify(prof), saveProfiles: () => true, log: () => {}, status: () => '{}', refreshStatus: () => '{}', play: () => {}, stop: () => {}, togglePause: () => {}, setBounds: () => {}, setVisible: () => {},
      setFullscreen: () => {}, exitApp: () => {}, toast: () => {}, version: () => '3.6.1', setOptions: () => {}, isTv: () => false, voiceSearch: () => {}, hasVoice: () => true, setOrientation: () => {} }; });
  await p.goto('file://' + ROOT + '/app/src/main/assets/web/index.html?phone=1');
  await p.waitForTimeout(2500);
  await p.evaluate(() => { const li = [...document.querySelectorAll('#catList li[data-id]')][3]; li.click(); });
  await p.waitForTimeout(800);
  await p.screenshot({ path: OUT + 'phl-1.png' });
  await p.evaluate(() => { S.items.live = S.items.live.map((c, i) => i < 2 ? { ...c, cat: '77' } : c); S.cats.live.push({ id: '77', name: 'Tiny' }); S.catId = '77'; renderItems(); });
  await p.waitForTimeout(800); await p.screenshot({ path: OUT + 'phl-2.png' });
  const info = await p.evaluate(() => { const r = el => { const b = document.querySelector(el)?.getBoundingClientRect(); return b && [Math.round(b.top), Math.round(b.height)]; };
    const g = $('#gScroll'); const c = $('#catList');
    return { inner: [innerWidth, innerHeight], doc: document.documentElement.scrollHeight, main: r('#main'), g: r('#gScroll'), gsh: g && [g.scrollHeight, g.clientHeight, getComputedStyle(g).overflowY], cat: [c.scrollHeight, c.clientHeight, getComputedStyle(c).overflowY], stage: r('.stage'), guide: r('.guide') }; });
  console.log(JSON.stringify(info)); console.log(await p.evaluate(() => [...document.querySelector('.stage').children].map(c => c.className + ':' + c.getBoundingClientRect().height + ':' + getComputedStyle(c).display)), await p.evaluate(() => [...document.querySelector('.guide').children].map(c => (c.id||c.className) + ':' + Math.round(c.getBoundingClientRect().height))), await p.evaluate(() => getComputedStyle(document.querySelector('.stage')).cssText || [getComputedStyle(document.querySelector('.stage')).height, getComputedStyle(document.querySelector('.main')).gridTemplateRows, getComputedStyle(document.querySelector('.main')).height]));
  const cdp = await ctx.newCDPSession(p);
  for (const [sel, x, y] of [['#gScroll', 500, 300], ['#catList', 200, 250]]) {
    const before = await p.evaluate(s => $(s).scrollTop, sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let yy = y - 5; yy >= y - 150; yy -= 5) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: yy }] }); await p.waitForTimeout(8); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(500);
    console.log(sel, before, '->', await p.evaluate(s => $(s).scrollTop, sel), 'el at point:', await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e.id + '.' + e.className; }, [x, y]));
  }
  console.log(errs); await b.close();
})();
