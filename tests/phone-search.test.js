const { chromium } = require('playwright');
const ROOT = require('path').resolve(__dirname, '..'); const OUT = ROOT + '/tests/out/';

const fs = require('fs');
(async () => {
  const TV = process.argv[2] === 'tv';
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const now = Math.floor(Date.now() / 1000);
  const cats = ['Action', 'Comedy', 'Drama', 'Sci-Fi', 'Horror', 'Family', 'Thriller', 'Documentary'];
  const words = ['Dark', 'Last', 'Silent', 'Iron', 'Lost', 'Golden', 'Red', 'Hidden', 'Final', 'Wild', 'Broken', 'Frozen'];
  const nouns = ['Horizon', 'Empire', 'River', 'Signal', 'Kingdom', 'Protocol', 'Harbour', 'Shadow', 'Code', 'Storm'];
  const films = Array.from({ length: 400 }, (_, i) => ({ stream_id: 5000 + i, name: `EN - ${words[i % 12]} ${nouns[(i * 7) % 10]}${i % 3 ? '' : ' II'} (${2005 + (i % 20)})`, category_id: 1 + (i % 8),
    stream_icon: `http://img.test/p${i % 24}.jpg`, rating: ((i * 37) % 60 + 40) / 10, added: String(now - (i * 3600 * 7)), container_extension: 'mkv' }));
  await p.route('http://img.test/**', r => { const f = r.request().url().split('/').pop(); r.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(ROOT + '/tests/fixtures/posters/' + f) }); });
  await p.route('http://mock.test/**', r => {
    const u = r.request().url(); const act = (u.match(/action=([a-z_]+)/) || [])[1]; let body = '[]';
    if (!act) body = JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: String(now + 9e6), active_cons: 0, max_connections: 2 } });
    else if (act === 'get_live_categories') body = JSON.stringify([{ category_id: 1, category_name: 'UK' }]);
    else if (act === 'get_live_streams') body = JSON.stringify([{ stream_id: 1, name: 'BBC One', category_id: 1, num: 1 }]);
    else if (act === 'get_vod_categories') body = JSON.stringify(cats.map((c, i) => ({ category_id: i + 1, category_name: 'EN | ' + c })));
    else if (act === 'get_vod_streams') body = JSON.stringify(films);
    else if (act === 'get_series_categories') body = JSON.stringify([{ category_id: 31, category_name: 'EN | Crime' }, { category_id: 32, category_name: 'EN | Comedy' }]);
    else if (act === 'get_series') body = JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ series_id: 900 + i, name: (i % 2 ? 'Line of ' : 'The ') + nouns[i % 10] + (i > 9 ? ' ' + i : ''), category_id: 31 + (i % 2), cover: `http://img.test/p${i % 24}.jpg`, rating: String(6 + (i % 4)), last_modified: String(now - i * 86400), plot: 'Detectives untangle a case.', genre: 'Crime, Drama' })));
    else if (act === 'get_series_info') body = JSON.stringify({ info: { plot: 'Detectives untangle a case that reaches the top.', genre: 'Crime, Drama', cast: 'A, B', backdrop_path: ['http://img.test/bd.jpg'] }, episodes: { '1': [1, 2, 3].map(n => ({ id: String(7000 + n), episode_num: n, title: 'Episode ' + n, container_extension: 'mp4' })), '2': [1, 2].map(n => ({ id: String(7100 + n), episode_num: n, title: 'Second ' + n, container_extension: 'mp4' })) } });
    else if (act === 'get_vod_info') body = JSON.stringify({ info: { plot: 'A retired operative is pulled back for one last job when a signal from an abandoned station reveals the conspiracy that ended her career.', genre: 'Action, Thriller', duration: '01:58:00', releasedate: '2021-05-02', cast: 'Jane Doe, John Roe', director: 'A. Director', backdrop_path: ['http://img.test/bd.jpg'] } });
    r.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await p.route('https://site.api.espn.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"events":[]}' }));
  await p.addInitScript(([tv]) => {
    const prof = { profiles: [{ id: 'p1', name: 'Home', type: 'xtream', server: 'http://mock.test', user: 'u', pass: 'p' }], last: 'p1', autoConnect: true };
    localStorage.setItem('watch:p1', JSON.stringify({ '5003': { id: '5003', name: 'EN - Lost Shadow (2008)', cat: '4', at: Date.now() - 86400000, pos: 6000, dur: 6500, done: true },
      '5011': { id: '5011', name: 'EN - Lost Harbour II (2016)', cat: '4', at: Date.now() - 3600000, pos: 7000, dur: 7100, done: true },
      '5008': { id: '5008', name: 'EN - Hidden Kingdom (2013)', cat: '1', at: Date.now() - 600000, pos: 2700, dur: 7000, done: false } }));
    localStorage.setItem('favCats:p1', JSON.stringify({ movie: ['7'] }));
    window.__calls = [];
    if (tv) window.AndroidBridge = { loadProfiles: () => JSON.stringify(prof), saveProfiles: () => true, log: () => {}, status: () => '{}', refreshStatus: () => '{}',
      play: u => window.__calls.push('play:' + u), stop: () => window.__calls.push('stop'), togglePause: () => {}, setBounds: () => {}, setVisible: () => {},
      setFullscreen: v => window.__calls.push('full:' + v), exitApp: () => {}, toast: () => {}, version: () => '3.4.1', setOptions: () => {}, seekTo: ms => window.__calls.push('seek:' + ms), isTv: () => false, setOrientation: m => window.__calls.push('orient:'+m), jumpBy: () => {}, trick: () => {}, exitFull: () => {} };
    else { localStorage.setItem('profiles', JSON.stringify(prof.profiles)); localStorage.setItem('last', JSON.stringify('p1')); }
  }, [TV]);
  await p.goto('file://' + ROOT + '/app/src/main/assets/web/index.html?phone=1');
  await p.waitForTimeout(2000);
  console.log('classes:', await p.evaluate(() => document.documentElement.className), 'width', await p.evaluate(() => innerWidth));
  await p.screenshot({ path: OUT + 'ph-guide.png' });
  await p.evaluate(() => setSection('search')); await p.waitForTimeout(300);
  await p.evaluate(() => pickScope('movie')); await p.waitForTimeout(800);
  await p.focus('#itemSearch'); await p.keyboard.type('fro', { delay: 60 }); await p.waitForTimeout(400);
  console.log('suggestions:', await p.evaluate(() => [...document.querySelectorAll('#suggest .sg-item')].map(b => b.textContent.replace('⌕', '').trim())));
  await p.screenshot({ path: OUT + 'ph-search-land.png' });
  await p.evaluate(() => document.querySelector('#suggest .sg-item').click()); await p.waitForTimeout(500);
  console.log('after pick:', await p.evaluate(() => [$('#itemSearch').value, $('#itemCount').textContent, document.getElementById('suggest').hidden]));
  await p.evaluate(() => setSection('movie')); await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + 'ph-films.png' });
  console.log('calls', await p.evaluate(()=>window.__calls.filter(c=>c.startsWith('orient')))); console.log('errors', errs);
  await b.close();
})();
