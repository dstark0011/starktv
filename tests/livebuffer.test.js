// Node test for the PC live buffer (windows/main.js LiveBuffer): fake provider that drops once; checks it reconnects
// and keeps recording while a slow client reads. Run: node tests/livebuffer.test.js
const http = require('http'), path = require('path'), fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(path.resolve(__dirname, '../windows/main.js'), 'utf8');
const start = src.indexOf('const LIVE_DIR'), code = src.slice(start, src.indexOf('\nipcMain.', start));
const mod = { exports: {} };
new Function('require', 'module', 'http', 'path', 'fs', 'mainLog', code + '\nmodule.exports = { LB, LiveBuffer, liveServer, isLiveUrl };')(require, mod, http, path, fs, m => console.log('[log]', m));
const { LB, LiveBuffer, liveServer, isLiveUrl } = mod.exports;
let conns = 0;
const prov = http.createServer((req, res) => { conns++; res.writeHead(200); const me = conns;
  const t = setInterval(() => res.write(Buffer.alloc(188 * 50, 0x47)), 10);
  if (me === 1) setTimeout(() => { clearInterval(t); res.destroy(); }, 3000);
  res.on('close', () => clearInterval(t)); }).listen(0, async () => {
  const url = `http://127.0.0.1:${prov.address().port}/live/u/p/1.ts`;
  console.assert(isLiveUrl(url) && !isLiveUrl('http://x/movie/u/p/2.mkv'), 'isLiveUrl');
  const port = await liveServer(); LB.cur = new LiveBuffer(url, 1);
  await new Promise(r => setTimeout(r, 500));
  let got = 0;
  http.get(`http://127.0.0.1:${port}/live/1.ts`, res => res.on('data', c => { got += c.length; res.pause(); setTimeout(() => res.resume(), 12); }));
  setTimeout(() => {
    console.log('provider connections', conns, '(expect 2)', 'recorded MB', (LB.cur.size / 1e6).toFixed(1), 'client MB', (got / 1e6).toFixed(1));
    const ok = conns >= 2 && got > 1e6; console.log(ok ? 'PASS' : 'FAIL'); LB.cur.stop(); process.exit(ok ? 0 : 1);
  }, 6000);
});
