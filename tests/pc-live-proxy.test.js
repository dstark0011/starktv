const { chromium } = require('playwright');
const ROOT = require('path').resolve(__dirname, '..'); const OUT = ROOT + '/tests/out/';

(async () => { const b = await chromium.launch(); const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); const now = Math.floor(Date.now()/1000);
  await p.route('http://mock.test/**', r => { const u = r.request().url(); const act = (u.match(/action=([a-z_]+)/) || [])[1]; let body = '[]';
    if (!act) body = JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: String(now + 9e6) } });
    else if (act === 'get_live_categories') body = JSON.stringify([{ category_id: 1, category_name: 'UK' }]);
    else if (act === 'get_live_streams') body = JSON.stringify([{ stream_id: 1, name: 'BBC One', category_id: 1 }]);
    r.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.route('https://**', r => r.abort());
  await p.addInitScript(() => { window.__c = []; const prof = { id: 'p1', name: 'Home', type: 'xtream', server: 'http://mock.test', user: 'u', pass: 'p' };
    localStorage.setItem('profiles', JSON.stringify([prof])); localStorage.setItem('last', JSON.stringify('p1'));
    window.native = { loadProfiles: () => null, saveProfiles: () => true, log: () => {}, liveOptions: o => window.__c.push('opts'), liveOpen: async u => { window.__c.push('open:' + u); return 'http://127.0.0.1:9/live/1.ts'; }, liveClose: () => window.__c.push('close'), onPlayerStatus: () => {} }; });
  await p.goto('file://' + ROOT + '/windows/app/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => openItem({ ...S.items.live[0], kind: 'live' })); await p.waitForTimeout(1500);
  console.log(await p.evaluate(() => window.__c), await p.evaluate(() => S.current?.url), errs); await b.close(); })();
