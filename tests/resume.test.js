const { chromium } = require('playwright');
const ROOT = require('path').resolve(__dirname, '..'); const OUT = ROOT + '/tests/out/';

(async () => { const b = await chromium.launch(); const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); const now = Math.floor(Date.now()/1000);
  await p.route('http://mock.test/**', r => { const u = r.request().url(); const act = (u.match(/action=([a-z_]+)/) || [])[1]; let body = '[]';
    if (!act) body = JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: String(now + 9e6) } });
    else if (act === 'get_live_categories') body = JSON.stringify([{ category_id: 1, category_name: 'UK' }]);
    else if (act === 'get_live_streams') body = JSON.stringify([{ stream_id: 1, name: 'BBC One', category_id: 1 }]);
    else if (act === 'get_vod_categories') body = JSON.stringify([{ category_id: 1, category_name: 'Drama' }]);
    else if (act === 'get_vod_streams') body = JSON.stringify([{ stream_id: 9, name: 'EN - Verity (2025)', category_id: 1, container_extension: 'mkv' }]);
    r.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.route('https://**', r => r.abort());
  await p.addInitScript(() => { const prof = { profiles: [{ id: 'p1', name: 'Home', type: 'xtream', server: 'http://mock.test', user: 'u', pass: 'p' }], last: 'p1', autoConnect: true }; window.__t = 0; window.__c = [];
    const st = () => JSON.stringify(window.__t ? { state: 'playing', live: false, time: window.__t, length: 6000 } : { state: 'idle' });
    window.AndroidBridge = { loadProfiles: () => JSON.stringify(prof), saveProfiles: () => true, log: () => {}, status: st, refreshStatus: st, play: () => true, stop: () => { window.__t = 0; }, togglePause: () => {}, setBounds: () => {}, setVisible: () => {},
      setFullscreen: () => {}, exitApp: () => {}, toast: () => {}, version: () => '4.3.1', setOptions: () => {}, isTv: () => true, seekTo: ms => window.__c.push('seek:' + ms), setStart: ms => window.__c.push('start:' + ms), exitFull: () => {} }; });
  await p.goto('file://' + ROOT + '/app/src/main/assets/web/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => setSection('movie')); await p.waitForTimeout(800);
  await p.evaluate(() => playFilm({ ...S.items.movie[0], kind: 'movie' }, 0)); await p.waitForTimeout(500);
  await p.evaluate(() => { window.__t = 2737; }); await p.waitForTimeout(1500);
  await p.evaluate(() => exitFilmPlay()); await p.waitForTimeout(300);
  console.log('saved', JSON.stringify(await p.evaluate(() => store.get('watch:p1'))));
  await p.evaluate(() => closeFilmModal && 0); await p.evaluate(() => setSection('recent')); await p.waitForTimeout(500);
  console.log('recent list', await p.evaluate(() => $('#itemList').textContent.trim().slice(0, 60)));
  await p.evaluate(() => document.querySelector('#itemList li[data-idx]').click()); await p.waitForTimeout(500);
  console.log('modal', await p.evaluate(() => [!$('#nfModal').hidden, document.querySelector('#nfModal .nf-btn.play')?.textContent]));
  await p.evaluate(() => document.querySelector('#nfModal .nf-btn.play').click()); await p.waitForTimeout(800);
  await p.evaluate(() => { window.__t = 5; }); await p.waitForTimeout(3000); console.log('seek', await p.evaluate(() => window.__c), errs); await b.close(); })();
