const { chromium } = require('playwright');
const ROOT = require('path').resolve(__dirname, '../..'); const OUT = ROOT + '/tests/out/';
 const fs = require('fs');
(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] }); const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const live = fs.readFileSync(ROOT + '/tests/perf/live.json'), xml = fs.readFileSync(ROOT + '/tests/perf/xmltv.xml'); const now = Math.floor(Date.now()/1000);
  await p.route('http://mock.test/**', async r => { const u = r.request().url(); const act = (u.match(/action=([a-z_]+)/) || [])[1];
    if (u.includes('xmltv.php')) return r.continue({ url: 'http://127.0.0.1:8765/x.xml' });
    let body = '[]'; if (!act) body = JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: String(now + 9e6) } });
    else if (act === 'get_live_categories') body = JSON.stringify(Array.from({length:60},(_, i)=>({ category_id: i+1, category_name: 'UK '+i })));
    else if (act === 'get_live_streams') body = live;
    else if (act === 'get_vod_categories') body = JSON.stringify([{ category_id: 1, category_name: 'Action' }]);
    else if (act === 'get_vod_streams') body = JSON.stringify(Array.from({length: 40000}, (_, i) => ({ stream_id: i, name: 'Film number ' + i + ' (' + (1980 + i % 40) + ')', category_id: 1 })));
    r.fulfill({ status: 200, contentType: 'application/json', body }); });
  await p.route('https://**', r => r.fulfill({ status: 200, body: JSON.stringify({ events: [{ id: '1', date: new Date(Date.now() + 3 * 3600e3).toISOString(), name: 'Arsenal at Liverpool', shortName: 'ARS @ LIV', competitions: [{ competitors: [{ homeAway: 'home', team: { displayName: 'Liverpool', shortDisplayName: 'Liverpool' } }, { homeAway: 'away', team: { displayName: 'Arsenal', shortDisplayName: 'Arsenal' } }], status: { type: { state: 'pre' } } }] }] }) }));
  await p.addInitScript(() => { const prof = { profiles: [{ id: 'p1', name: 'Home', type: 'xtream', server: 'http://mock.test', user: 'u', pass: 'p' }], last: 'p1', autoConnect: true };
    window.AndroidBridge = { loadProfiles: () => JSON.stringify(prof), saveProfiles: () => true, log: m => console.log('LOG ' + m), status: () => '{}', refreshStatus: () => '{}', play: () => {}, stop: () => {}, togglePause: () => {}, setBounds: () => {}, setVisible: () => {},
      setFullscreen: () => {}, exitApp: () => {}, toast: () => {}, version: () => '3.6.1', setOptions: () => {}, isTv: () => true, voiceSearch: () => {} };
    window.__long = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ entryTypes: ['longtask'] }); });
  p.on('console', m => { if (m.text().startsWith('LOG ')) console.log(m.text()); });
  const cdp = await p.context().newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: +(process.argv[3] || 8) });
  await p.goto('file://' + ROOT + '/app/src/main/assets/web/index.html');
  const mode = process.argv[2] || 'late';
  if (mode === 'early') await p.waitForTimeout(3000);
  else await p.waitForFunction(() => typeof xmltvState !== 'undefined' && xmltvState === 'ok' && sgIndex.liveFor, null, { timeout: 300000 });
  console.log('state', await p.evaluate(() => [xmltvState, !!sgIndex.liveFor]));
  await p.evaluate(() => { window.__long = []; });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval',{interval:1000}); await cdp.send('Profiler.start');
  await p.evaluate(async () => { await setSection('search'); });
  await p.waitForTimeout(500);
  await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  await p.focus('#itemSearch');
  const t0 = Date.now();
  for (const ch of 'liverpool') { await p.keyboard.type(ch); await p.waitForTimeout(250); }
  await p.waitForTimeout(8000);
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map(n => [n.id, n])); for (const n of profile.nodes) for (const c of n.children || []) byId.get(c).parent = n;
  { let run = [], t = 0; const runs = [];
    profile.samples.forEach((id, k) => { const n = byId.get(id); t += profile.timeDeltas[k] / 1000; const idle = n.callFrame.functionName === '(idle)';
      if (idle) { if (run.length) { const d = run[run.length - 1][0] - run[0][0]; if (d > 250) runs.push(run); } run = []; } else run.push([t, n]); });
    for (const r of runs) { const c = {}; for (const [, n] of r) { let x = n; const seen = new Set(); while (x) { const f = x.callFrame.functionName + ':' + x.callFrame.lineNumber; if (!seen.has(f)) { c[f] = (c[f] || 0) + 1; seen.add(f); } x = x.parent; } }
      console.log('RUN', Math.round(r[r.length-1][0] - r[0][0]), Object.entries(c).sort((a, b) => b[1] - a[1]).slice(1, 14).map(([k, v]) => k + '=' + v).join(' | ')); } }
  console.log('long tasks', JSON.stringify(await p.evaluate(() => window.__long)));
  console.log('count', await p.evaluate(() => $('#itemCount').textContent), 'xmltv', await p.evaluate(() => xmltvState));
  console.log(errs); await b.close();
})();
