const { app, BrowserWindow, ipcMain, shell, safeStorage, session, Menu, screen } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Many IPTV panels only answer player-style user agents
app.userAgentFallback = 'VLC/3.0.20 LibVLC/3.0.20';
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/* ---------- small JSON files in %APPDATA%\Tidewatch IPTV (folder name kept from before the rename to StarkTV) ---------- */
// keep using the old settings folder so saved logins, favourites and history carry over after the rename
app.setPath('userData', path.join(app.getPath('appData'), 'Tidewatch IPTV'));
const dataFile = name => path.join(app.getPath('userData'), name);
function readJson(name, dflt) { try { return JSON.parse(fs.readFileSync(dataFile(name), 'utf8')); } catch { return dflt; } }
function writeJson(name, obj) {
  const f = dataFile(name), tmp = f + '.tmp';
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, f);
}

// Passwords / M3U links are encrypted with Windows DPAPI (tied to your Windows login)
function enc(s) {
  if (!s) return '';
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(s).toString('base64');
  return 'b64:' + Buffer.from(s, 'utf8').toString('base64');
}
function dec(s) {
  if (!s) return '';
  if (s.startsWith('enc:')) { try { return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')); } catch { return ''; } }
  if (s.startsWith('b64:')) return Buffer.from(s.slice(4), 'base64').toString('utf8');
  return s;
}

ipcMain.on('profiles-load', e => {
  const d = readJson('profiles.json', null);
  e.returnValue = d ? { ...d, profiles: (d.profiles || []).map(p => ({ ...p, pass: dec(p.pass), m3u: dec(p.m3u) })) } : null;
});
ipcMain.on('profiles-save', (e, d) => {
  try {
    writeJson('profiles.json', { ...d, profiles: (d.profiles || []).map(p => ({ ...p, pass: enc(p.pass), m3u: enc(p.m3u) })) });
    e.returnValue = true;
  } catch { e.returnValue = false; }
});

// native right-click menu (resolves with the chosen id, or null)
ipcMain.handle('ctx-menu', (e, items) => new Promise(res => {
  let done = false; const finish = v => { if (!done) { done = true; res(v); } };
  const menu = Menu.buildFromTemplate(items.map(i => i.sep ? { type: 'separator' } : { label: i.label, click: () => finish(i.id) }));
  menu.popup({ window: BrowserWindow.fromWebContents(e.sender), callback: () => setTimeout(() => finish(null), 100) });
}));
// error log next to the .exe (and in AppData) so problems can be diagnosed
ipcMain.on('log', (_e, line) => {
  const txt = `${new Date().toISOString()} ${line}\n`;
  for (const f of [path.join(path.dirname(process.execPath), 'starktv-log.txt'), dataFile('starktv-log.txt')]) { try { fs.appendFileSync(f, txt); } catch {} }
});

let mainWin = null;
function createWindow() {
  const b = readJson('window.json', {});
  const win = mainWin = new BrowserWindow({
    width: b.width || 1400, height: b.height || 860, x: b.x, y: b.y, minWidth: 1000, minHeight: 600,
    backgroundColor: '#13202b',
    icon: path.join(__dirname, 'starktv.png'),
    autoHideMenuBar: true,
    title: 'StarkTV v' + app.getVersion().replace(/\.0$/, ''),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,          // panels rarely send CORS headers
      allowRunningInsecureContent: true,
      backgroundThrottling: false, // keep streams fed when the window isn't focused
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (b.max) win.maximize();
  win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) ipcMain.emit('log', null, `console: ${message} (${path.basename(src || '')}:${line})`); });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  for (const ev of ['move', 'resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, () => vlcPlace());
  win.on('minimize', () => vlcHost.send('hide'));
  win.on('restore', () => { if (vlcState.visible) vlcHost.send('show'); vlcPlace(); });
  win.on('close', () => {
    try { writeJson('window.json', { ...win.getNormalBounds(), max: win.isMaximized() }); } catch {}
  });
}

const playerCandidates = () => {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    path.join(pf, 'VideoLAN', 'VLC', 'vlc.exe'),
    path.join(pf86, 'VideoLAN', 'VLC', 'vlc.exe'),
    path.join(pf, 'mpv', 'mpv.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'mpv', 'mpv.exe')
  ];
};

const findPlayer = custom => (custom ? [custom, ...playerCandidates()] : playerCandidates()).find(p => p && fs.existsSync(p));
const mainLog = line => { const txt = `${new Date().toISOString()} ${line}\n`; for (const f of [path.join(path.dirname(process.execPath), 'starktv-log.txt'), dataFile('starktv-log.txt')]) { try { fs.appendFileSync(f, txt); } catch {} } };

// no VLC on this PC → install it with Windows' own package manager (winget), straight from VideoLAN
let vlcInstall = null;
function installVlc() {
  if (vlcInstall) return vlcInstall;
  vlcInstall = new Promise(res => {
    let out = '';
    const p = spawn('winget', ['install', '--exact', '--id', 'VideoLAN.VLC', '--source', 'winget', '--silent',
      '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], { windowsHide: true });
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('error', e => res({ ok: false, why: 'winget not available (' + e.message + ')' }));
    p.on('close', code => res({ ok: !!findPlayer(''), why: `winget exit ${code}: ${out.replace(/\s+/g, ' ').slice(-300)}` }));
  }).then(r => { mainLog('vlc install: ' + (r.ok ? 'ok' : r.why)); return r; }).finally(() => { vlcInstall = null; });
  return vlcInstall;
}

ipcMain.handle('open-external-player', async (e, url, title, custom) => {
  let exe = findPlayer(custom), installed = false;
  if (!exe) {
    try { e.sender.send('player-status', 'VLC isn’t installed – installing it now (first time only, about a minute)…'); } catch {}
    await installVlc();
    exe = findPlayer(custom); installed = !!exe;
    if (!exe) {
      shell.openExternal('https://www.videolan.org/vlc/');
      return { ok: false, error: 'Couldn’t install VLC automatically, so the VLC download page has opened in your browser. Install it, then press “Open in VLC” again.' };
    }
  }
  const isVlc = exe.toLowerCase().includes('vlc');
  const args = isVlc
    ? [url, `--meta-title=${title || ''}`, '--network-caching=3000']
    : [url, `--title=${title || ''}`, '--cache=yes', '--demuxer-max-bytes=150MiB'];
  spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
  return { ok: true, player: path.basename(exe), installed };
});

/* ---------- Embedded VLC ----------
   VLC runs hidden in the background and draws into a borderless native window (vlchost.ps1) that sits exactly
   over StarkTV's player area. StarkTV controls it through VLC's local web interface (127.0.0.1 only, random password). */
const vlcState = { proc: null, port: 0, pass: '', hwnd: 0, rect: null, visible: false, poll: null, starting: null, wantShow: false };
const vlcHost = {
  proc: null, ready: null,
  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((res, rej) => {
      const owner = mainWin ? mainWin.getNativeWindowHandle().readBigInt64LE(0).toString() : '0';
      const p = this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-WindowStyle', 'Hidden',
        '-File', path.join(__dirname, 'vlchost.ps1'), '-Owner', owner], { windowsHide: true });
      let buf = '';
      p.stdout.on('data', d => {
        buf += d; let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (line.startsWith('HWND ')) res(+line.slice(5));
          else if (line === 'activated') { try { mainWin?.focus(); } catch {} }
          else if (line === 'dblclick') { try { mainWin?.webContents.send('vlc-event', 'dblclick'); } catch {} }
        }
      });
      p.stderr.on('data', d => mainLog('vlchost: ' + String(d).trim().slice(0, 300)));
      p.on('exit', () => { this.proc = null; this.ready = null; });
      p.on('error', e => rej(e));
      setTimeout(() => rej(new Error('video window did not start')), 15000);
    });
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  },
  send(cmd) { try { this.proc?.stdin.write(cmd + '\n'); } catch {} }
};
function vlcPlace() {
  if (!mainWin || !vlcState.rect || !vlcHost.proc) return;
  const cb = mainWin.getContentBounds(), r = vlcState.rect;
  const s = screen.dipToScreenRect(mainWin, { x: Math.round(cb.x + r.x), y: Math.round(cb.y + r.y), width: Math.max(1, Math.round(r.w)), height: Math.max(1, Math.round(r.h)) });
  vlcHost.send(`bounds ${s.x} ${s.y} ${s.width} ${s.height}`);
}
function vlcReq(query) {
  return new Promise(res => {
    const req = http.get({ host: '127.0.0.1', port: vlcState.port, path: '/requests/status.json' + (query ? '?' + query : ''),
      headers: { Authorization: 'Basic ' + Buffer.from(':' + vlcState.pass).toString('base64') }, timeout: 3000 }, r => {
      let d = ''; r.on('data', c => { d += c; }); r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
    });
    req.on('error', () => res(null)); req.on('timeout', () => { req.destroy(); res(null); });
  });
}
async function vlcStart() {
  if (vlcState.proc) return true;
  if (vlcState.starting) return vlcState.starting;
  vlcState.starting = (async () => {
    let exe = findPlayer('');
    if (!exe || !/vlc/i.test(exe)) { await installVlc(); exe = findPlayer(''); }
    if (!exe || !/vlc/i.test(exe)) throw new Error('VLC isn’t installed and couldn’t be installed automatically.');
    const hwnd = await vlcHost.start();
    vlcState.port = 40000 + Math.floor(Math.random() * 9000);
    vlcState.pass = require('crypto').randomBytes(12).toString('hex');
    const p = vlcState.proc = spawn(exe, ['--intf', 'dummy', '--dummy-quiet', '--extraintf', 'http', '--http-host', '127.0.0.1',
      '--http-port', String(vlcState.port), '--http-password', vlcState.pass, `--drawable-hwnd=${hwnd}`,
      '--no-video-title-show', '--no-osd', '--no-snapshot-preview', '--no-qt-error-dialogs', '--no-mouse-events', '--no-keyboard-events',
      '--network-caching=2000', '--live-caching=2000', '--http-reconnect', '--no-random', '--no-loop', '--no-repeat', '--quiet'],
      { windowsHide: true, stdio: 'ignore' });
    p.on('exit', code => { mainLog('vlc exited ' + code); vlcState.proc = null; vlcHost.send('hide'); vlcState.visible = false; try { mainWin?.webContents.send('vlc-state', { state: 'exited' }); } catch {} });
    for (let i = 0; i < 40; i++) { if (await vlcReq('')) return true; await new Promise(r => setTimeout(r, 250)); }
    throw new Error('VLC started but isn’t answering');
  })().finally(() => { vlcState.starting = null; });
  return vlcState.starting;
}
/* ---------- Live buffer (PC) ----------
   Like the Fire Stick: StarkTV itself reads the live channel from the provider (reconnecting on its own) and keeps
   the last 10 minutes on disk; VLC plays from that copy through a little local web server. VLC plays at 97 % until
   the picture is "Live delay" seconds behind, so drop-outs are covered by what's already been downloaded. */
const LIVE_DIR = path.join(require('os').tmpdir(), 'starktv-live');
const CHUNK = 16 * 1024 * 1024, KEEP_MS = 10 * 60000, VLC_CACHE_MS = 2000;
const LB = { cur: null, srv: null, port: 0, gen: 0, delay: 15000 };
class LiveBuffer {
  constructor(url, gen) {
    this.url = url; this.gen = gen; this.chunks = []; this.size = 0; this.base = 0; this.marks = []; this.waiters = new Set();
    this.served = 0; this.stopped = false; this.fails = 0; this.gotData = false; this.started = Date.now(); this.code = 0;
    try { fs.mkdirSync(LIVE_DIR, { recursive: true }); for (const f of fs.readdirSync(LIVE_DIR)) try { fs.unlinkSync(path.join(LIVE_DIR, f)); } catch {} } catch {}
    this.fetch();
  }
  fetch() {
    if (this.stopped) return;
    const mod = this.url.startsWith('https') ? require('https') : http;
    let req;
    try {
      req = mod.get(this.url, { headers: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20' }, timeout: 20000 }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) { this.url = new URL(res.headers.location, this.url).toString(); res.resume(); return this.fetch(); }
        this.code = res.statusCode;
        if (res.statusCode !== 200) { res.resume(); mainLog('live buffer: provider replied ' + res.statusCode); return this.retry(); }
        this.fails = 0;
        res.on('data', c => this.append(c));
        res.on('end', () => { mainLog('live buffer: stream ended, reconnecting'); this.retry(); });
        res.on('error', () => this.retry());
      });
    } catch (e) { mainLog('live buffer: ' + e.message); return this.retry(); }
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', e => { mainLog('live buffer: ' + e.message); this.retry(); });
    this.req = req;
  }
  retry() {
    if (this.stopped || this.retrying) return;
    this.retrying = true; this.fails++;
    setTimeout(() => { this.retrying = false; this.fetch(); }, Math.min(5000, 800 * this.fails));
  }
  append(c) {
    if (this.stopped) return;
    let cur = this.chunks[this.chunks.length - 1];
    if (!cur || cur.len >= CHUNK) {
      const file = path.join(LIVE_DIR, `${this.gen}-${this.chunks.length ? cur.start + cur.len : 0}.ts`);
      cur = { start: this.size, len: 0, file, fd: fs.openSync(file, 'w+') }; this.chunks.push(cur);
    }
    fs.writeSync(cur.fd, c, 0, c.length, cur.len); cur.len += c.length; this.size += c.length; this.gotData = true;
    const now = Date.now(), last = this.marks[this.marks.length - 1];
    if (!last || now - last[1] >= 400) this.marks.push([this.size, now]);
    // forget what's older than 10 minutes – but never what VLC still has to play
    while (this.chunks.length > 2 && this.chunks[1].start <= this.served && this.arrival(this.chunks[1].start) < now - KEEP_MS) {
      const old = this.chunks.shift(); try { fs.closeSync(old.fd); fs.unlinkSync(old.file); } catch {}
      this.base = this.chunks[0].start;
      while (this.marks.length > 1 && this.marks[1][0] <= this.base) this.marks.shift();
    }
    for (const w of this.waiters) w(); this.waiters.clear();
  }
  arrival(off) {                                   // when the byte at this offset arrived (ms)
    const m = this.marks; if (!m.length) return Date.now();
    let lo = 0, hi = m.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (m[mid][0] < off) lo = mid + 1; else hi = mid; }
    return m[lo][1];
  }
  read(pos, max) {
    const c = this.chunks.find(c => pos >= c.start && pos < c.start + c.len); if (!c) return null;
    const n = Math.min(max, c.start + c.len - pos), b = Buffer.allocUnsafe(n);
    const got = fs.readSync(c.fd, b, 0, n, pos - c.start);
    return got === n ? b : b.subarray(0, got);
  }
  wait(ms) { return new Promise(r => { const t = setTimeout(() => { this.waiters.delete(f); r(); }, ms); const f = () => { clearTimeout(t); r(); }; this.waiters.add(f); }); }
  behindMs() { return this.gotData ? Math.max(0, Date.now() - this.arrival(this.served) + VLC_CACHE_MS) : 0; }
  stop() {
    this.stopped = true; try { this.req?.destroy(); } catch {}
    for (const w of this.waiters) w(); this.waiters.clear();
    for (const c of this.chunks) { try { fs.closeSync(c.fd); fs.unlinkSync(c.file); } catch {} }
    this.chunks = [];
  }
}
function liveServer() {
  if (LB.srv) return Promise.resolve(LB.port);
  return new Promise(res => {
    LB.srv = http.createServer(async (req, rsp) => {
      const m = /^\/live\/(\d+)\.ts/.exec(req.url || ''); const buf = LB.cur;
      if (!m || !buf || +m[1] !== buf.gen) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache' });
      let pos = Math.max(buf.base, buf.size - (buf.size % 188)), closed = false;     // start at the newest data
      rsp.on('close', () => { closed = true; });
      while (!closed && !buf.stopped) {
        if (pos < buf.base) pos = buf.base;
        if (pos >= buf.size) { await buf.wait(15000); continue; }
        const data = buf.read(pos, 256 * 1024); if (!data || !data.length) { await buf.wait(500); continue; }
        pos += data.length; buf.served = pos;
        if (!rsp.write(data)) await new Promise(r => { rsp.once('drain', r); rsp.once('close', r); });
      }
      try { rsp.end(); } catch {}
    });
    LB.srv.listen(0, '127.0.0.1', () => { LB.port = LB.srv.address().port; res(LB.port); });
  });
}
const isLiveUrl = u => !/\/(movie|series)\//.test(u) && !/\.m3u8(\?|$)/i.test(u) && /^https?:/i.test(u);
ipcMain.handle('open-link', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; });
ipcMain.on('app-version', e => { e.returnValue = app.getVersion().replace(/\.0$/, ''); });
ipcMain.on('live-opts', (_e, o) => { if (o && o.delay != null) LB.delay = Math.max(0, +o.delay) * 1000; });
// the built-in player uses the same buffer
ipcMain.handle('live-open', async (_e, url) => {
  try { LB.cur?.stop(); const port = await liveServer(); const gen = ++LB.gen; LB.cur = new LiveBuffer(url, gen); return `http://127.0.0.1:${port}/live/${gen}.ts`; }
  catch (e) { mainLog('live-open: ' + e.message); return null; }
});
ipcMain.on('live-close', () => { LB.cur?.stop(); LB.cur = null; });

function vlcPollStart() {
  clearInterval(vlcState.poll);
  vlcState.poll = setInterval(async () => {
    const s = await vlcReq(''); if (!s) return;
    const playing = s.state === 'playing' || s.state === 'paused';
    // live: play at 97 % until the picture is far enough behind live, then normal speed
    let behind = null;
    const buf = LB.cur;
    if (buf && !buf.stopped) {
      behind = buf.behindMs();
      if (s.state === 'playing') {
        const want = behind < LB.delay - 700 ? 0.97 : 1;
        if (Math.abs((+s.rate || 1) - want) > 0.005) vlcReq('command=rate&val=' + want);
      }
      if (!buf.gotData && Date.now() - buf.started > 20000 && !buf.toldErr) {
        buf.toldErr = true;
        try { mainWin?.webContents.send('vlc-state', { state: 'error', msg: buf.code && buf.code !== 200 ? `Your provider refused the stream (${buf.code}${buf.code === 469 ? ' – all connections in use' : ''}).` : 'This channel isn’t sending a picture right now.' }); } catch {}
      }
    }
    if (playing && vlcState.wantShow && !vlcState.visible) { vlcState.visible = true; vlcPlace(); vlcHost.send('show'); }
    try { mainWin?.webContents.send('vlc-state', { state: s.state, volume: s.volume, time: s.time, length: s.length, behind, delay: buf ? LB.delay : null, rate: s.rate }); } catch {}
  }, 700);
}
ipcMain.handle('vlc-play', async (_e, url) => {
  try {
    await vlcStart();
    vlcState.wantShow = true;
    LB.cur?.stop(); LB.cur = null;
    if (isLiveUrl(url)) {                        // live: VLC plays StarkTV's own buffered copy
      const port = await liveServer();
      const gen = ++LB.gen; LB.cur = new LiveBuffer(url, gen);
      url = `http://127.0.0.1:${port}/live/${gen}.ts`;
    }
    await vlcReq('command=rate&val=1');
    await vlcReq('command=in_play&input=' + encodeURIComponent(url));
    vlcPollStart();
    return { ok: true };
  } catch (err) { mainLog('vlc-play: ' + err.message); return { ok: false, error: err.message }; }
});
ipcMain.handle('vlc-stop', async () => {
  vlcState.wantShow = false; vlcState.visible = false; vlcHost.send('hide'); clearInterval(vlcState.poll);
  LB.cur?.stop(); LB.cur = null;
  if (vlcState.proc) await vlcReq('command=pl_stop');
  return true;
});
ipcMain.handle('vlc-cmd', async (_e, q) => (vlcState.proc ? vlcReq(q) : null));
ipcMain.on('vlc-bounds', (_e, r) => { vlcState.rect = r; vlcPlace(); });
ipcMain.on('vlc-visible', (_e, v) => {           // the page hides the video window while a dialog is open over it
  if (!vlcState.wantShow) return;
  vlcState.visible = !!v; vlcHost.send(v ? 'show' : 'hide'); if (v) vlcPlace();
});
app.on('will-quit', () => { LB.cur?.stop(); try { vlcState.proc?.kill(); } catch {} vlcHost.send('exit'); try { vlcHost.proc?.kill(); } catch {} });

app.whenReady().then(createWindow);
// make sure favourites / column widths in localStorage hit disk before exit
app.on('before-quit', () => { try { session.defaultSession.flushStorageData(); } catch {} });
app.on('window-all-closed', () => app.quit());
