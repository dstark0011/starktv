const { chromium } = require('playwright');
const ROOT = require('path').resolve(__dirname, '..'); const OUT = ROOT + '/tests/out/';

const fs = require('fs');
(async () => {
  const TV = process.argv[2] === 'tv';
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
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
      setFullscreen: v => window.__calls.push('full:' + v), exitApp: () => {}, toast: () => {}, version: () => '3.2.1', setOptions: () => {}, seekTo: ms => window.__calls.push('seek:' + ms), isTv: () => true };
    else { localStorage.setItem('profiles', JSON.stringify(prof.profiles)); localStorage.setItem('last', JSON.stringify('p1')); }
  }, [TV]);
  await p.goto(TV ? 'file://' + ROOT + '/app/src/main/assets/web/index.html' : 'file://' + ROOT + '/windows/app/index.html');
  await p.waitForTimeout(1800);
  await p.evaluate(() => setSection('movie'));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + `nf-${TV ? 'tv' : 'pc'}.png` });
  console.log('rows:', await p.evaluate(() => [...document.querySelectorAll('.nf-row h3')].map(h => h.textContent.trim().replace(/\s+/g, ' '))));
  console.log('hero:', await p.evaluate(() => document.querySelector('.nf-hero h1')?.textContent));
  console.log('watched film in Recommended?', await p.evaluate(() => [...document.querySelectorAll('.nf-row')].find(r => r.textContent.includes('Recommended'))?.innerHTML.includes('Lost Shadow')));
  if (TV) {
    console.log('focus', await p.evaluate(() => document.activeElement.className + ' ' + document.activeElement.textContent.trim().slice(0, 20)));
    for (const k of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft']) { await p.keyboard.press(k); await p.waitForTimeout(150); console.log('  ', k, await p.evaluate(() => { const a = document.activeElement; return a.className + ' | ' + (a.closest('.nf-row')?.querySelector('h3')?.textContent.slice(0, 25) || '') + ' | ' + a.textContent.trim().slice(0, 20); })); }
    console.log('after nav', await p.evaluate(() => document.activeElement.className + ' ' + document.activeElement.textContent.trim().slice(0, 30)));
    await p.keyboard.down('Enter'); await p.waitForTimeout(80); await p.keyboard.up('Enter'); await p.waitForTimeout(900);
    await p.screenshot({ path: OUT + 'nf-tv-modal.png' });
    console.log('modal focus', await p.evaluate(() => [!$('#nfModal').hidden, document.activeElement.textContent]));
    await p.keyboard.press('Enter'); await p.waitForTimeout(900);
    console.log('play calls', await p.evaluate(() => window.__calls));
    console.log('back->', await p.evaluate(() => { window.__tvAfterFull(); return [S.section, document.getElementById('main').className]; }));
  } else {
    await p.click('.nf-btn[data-info]'); await p.waitForTimeout(800);
    await p.screenshot({ path: OUT + 'nf-pc-modal.png' });
    await p.keyboard.press('Escape');
    await p.fill('#nfSearch', 'frozen'); await p.waitForTimeout(500);
    console.log('search', await p.evaluate(() => document.querySelector('.nf-grid-title')?.textContent));
  }
  console.log('errors', errs);
  await b.close();
})();
