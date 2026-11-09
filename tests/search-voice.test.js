const { chromium } = require('playwright');
const ROOT = require('path').resolve(__dirname, '..'); const OUT = ROOT + '/tests/out/';
 const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const live = fs.readFileSync(ROOT + '/tests/perf/live.json'), xml = fs.readFileSync(ROOT + '/tests/perf/xmltv.xml'); const now = Math.floor(Date.now()/1000);
  await p.route('http://mock.test/**', r => { const u = r.request().url(); const act = (u.match(/action=([a-z_]+)/) || [])[1];
    if (u.includes('xmltv.php')) return r.fulfill({ status: 200, body: xml });
    let body = '[]';
    if (!act) body = JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: String(now + 9e6) } });
    else if (act === 'get_live_categories') body = JSON.stringify(Array.from({length:60},(_, i)=>({ category_id: i+1, category_name: 'UK '+i })));
    else if (act === 'get_live_streams') body = live;
    else if (act === 'get_vod_categories') body = JSON.stringify([{ category_id: 1, category_name: 'Action' }]);
    else if (act === 'get_vod_streams') body = JSON.stringify([{ stream_id: 9, name: 'Bad Boys for Life (2020)', category_id: 1 }, { stream_id: 10, name: 'Bad Boys II (2003)', category_id: 1 }]);
    else if (act === 'get_series_categories') body = JSON.stringify([{ category_id: 1, category_name: 'Comedy' }]);
    else if (act === 'get_series') body = JSON.stringify([{ series_id: 5, name: 'Friends', category_id: 1 }]);
    r.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.route('https://**', r => r.fulfill({ status: 200, body: '{"events":[]}' }));
  await p.addInitScript(() => { const prof = { profiles: [{ id: 'p1', name: 'Home', type: 'xtream', server: 'http://mock.test', user: 'u', pass: 'p' }], last: 'p1', autoConnect: true };
    window.__calls = [];
    window.AndroidBridge = { loadProfiles: () => JSON.stringify(prof), saveProfiles: () => true, log: () => {}, status: () => '{}', refreshStatus: () => '{}', play: () => {}, stop: () => {}, togglePause: () => {}, setBounds: () => {}, setVisible: () => {},
      setFullscreen: () => {}, exitApp: () => {}, toast: t => window.__calls.push('toast:' + t), version: () => '3.5.1', setOptions: () => {}, isTv: () => true, voiceSearch: () => window.__calls.push('voice') }; });
  await p.goto('file://' + ROOT + '/app/src/main/assets/web/index.html');
  await p.waitForFunction(() => typeof xmltvState !== 'undefined' && xmltvState === 'ok', null, { timeout: 90000 });
  console.log('split', await p.evaluate(() => ['liverpool live tv', 'Live TV Liverpool', 'bad boys movie', 'Friends TV show', 'friends series', 'liverpool live', 'live golf', 'liverpool', 'the movie show', 'film bad boys', 'sky sports channel'].map(t => t + ' => ' + JSON.stringify(splitScope(t)))));
  await p.evaluate(() => setSection('search')); await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + 'v-picker.png' });
  console.log('focus', await p.evaluate(() => document.activeElement.dataset.pick));
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(100); console.log('down ->', await p.evaluate(() => document.activeElement.dataset.pick));
  await p.keyboard.press('ArrowUp'); await p.keyboard.down('Enter'); await p.waitForTimeout(60); await p.keyboard.up('Enter'); await p.waitForTimeout(300);
  console.log('picked', await p.evaluate(() => [S.searchScope, S.scopePicked, document.activeElement.id]));
  await p.keyboard.type('bad boys', { delay: 80 }); await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('#searchScope button[data-scope="movie"]').click()); await p.waitForTimeout(1200);
  console.log('after switch', await p.evaluate(() => [S.searchScope, $('#itemSearch').value, document.activeElement.id || document.activeElement.tagName, $('#itemCount').textContent, $('#itemList').textContent.slice(0, 60)]));
  await p.evaluate(() => window.__tvBack()); await p.evaluate(() => window.__tvBack()); await p.waitForTimeout(200);
  console.log('back ->', await p.evaluate(() => [S.scopePicked, !!document.querySelector('.scope-tile')]));
  await p.evaluate(() => document.querySelector('[data-pick="voice"]').click()); await p.waitForTimeout(100);
  console.log('calls', await p.evaluate(() => window.__calls));
  for (const said of ['Liverpool live TV', 'friends TV show', 'bad boys movie']) {
    await p.evaluate(t => window.__voiceResult(t), said); await p.waitForTimeout(1500);
    console.log(said, '=>', await p.evaluate(() => [S.searchScope, $('#itemSearch').value, $('#itemCount').textContent]));
  }
  // dictated by Fire TV keyboard straight into the box
  await p.evaluate(() => { showScopePicker(); pickScope('movie'); }); await p.waitForTimeout(200);
  await p.fill('#itemSearch', 'arsenal live tv'); await p.dispatchEvent('#itemSearch', 'input'); await p.waitForTimeout(1800);
  console.log('dictated =>', await p.evaluate(() => [S.searchScope, $('#itemSearch').value, $('#itemCount').textContent]));
  await p.screenshot({ path: OUT + 'v-results.png' });
  console.log(errs); await b.close();
})();
