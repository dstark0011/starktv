'use strict';
window.addEventListener('error', e => window.native?.log?.(`error: ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', e => window.native?.log?.('rejection: ' + (e.reason?.message || e.reason)));
const $ = s => document.querySelector(s);
const TV = !!window.AndroidBridge;                 // running inside the Android app (TV, Fire TV or phone)
const PHONE = TV && !!window.AndroidBridge.isTv && !window.AndroidBridge.isTv();   // same app on a phone/tablet: touch controls
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
/* Saved logins: encrypted JSON file via the main process (falls back to localStorage) */
const prof = {
  data: null,
  load() {
    if (this.data) return this.data;
    let d = null;
    try { d = window.native?.loadProfiles?.(); } catch {}
    if (!d) {                                   // first run or old version: migrate from localStorage
      d = { profiles: store.get('profiles', []), last: store.get('last', null), autoConnect: true };
      this.data = d; if (d.profiles.length) this.save(d);
    }
    d.profiles = d.profiles || [];
    return this.data = d;
  },
  save(d = this.data) {
    this.data = d;
    let ok = false; try { ok = window.native?.saveProfiles?.(d); } catch {}
    if (!ok) { store.set('profiles', d.profiles); store.set('last', d.last); }
  }
};
const b64 = s => { try { return decodeURIComponent(escape(atob(s))); } catch { return s || ''; } };

const S = {
  profile: null, section: 'live', catId: null,
  cats: { live: [], movie: [], series: [] },
  items: { live: [], movie: [], series: [] },   // all items per section (loaded lazily for xtream)
  loaded: {}, view: [], shown: 200, current: null,
  settings: { format: 'ts', player: '', hideAdult: false, buffer: 'smooth', resume: true, engine: 'auto', liveDelay: 15, rewindMin: 30, osdTime: 5, netMode: 'auto', netSwitch: 'ask', netDot: 'problem', clock: 'off', subs: 'off', autoUpdate: true, ...store.get('settings', {}) }
};
const adultRx = /adult|xxx|18\+|porn/i;

/* ---------- Xtream API ---------- */
function base(p) { return p.server.replace(/\/+$/, ''); }
async function api(action, extra = '') {
  const p = S.profile;
  const url = `${base(p)}/player_api.php?username=${encodeURIComponent(p.user)}&password=${encodeURIComponent(p.pass)}${action ? '&action=' + action : ''}${extra}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Server replied ${r.status}`);
  return r.json();
}
function streamUrl(kind, id, ext) {
  const p = S.profile;
  if (p.type === 'm3u') return id;
  const b = `${base(p)}`, u = encodeURIComponent(p.user), pw = encodeURIComponent(p.pass);
  if (kind === 'live') return `${b}/live/${u}/${pw}/${id}.${S.settings.format}`;
  if (kind === 'movie') return `${b}/movie/${u}/${pw}/${id}.${ext || 'mp4'}`;
  return `${b}/series/${u}/${pw}/${id}.${ext || 'mp4'}`;
}

/* ---------- M3U ---------- */
function parseM3U(text) {
  const out = { live: [], movie: [], series: [] }, groups = { live: new Map(), movie: new Map(), series: new Map() };
  const lines = text.split(/\r?\n/);
  let meta = null, n = 0;
  for (const raw of lines) {
    const l = raw.trim();
    if (l.startsWith('#EXTINF')) {
      const attr = k => (l.match(new RegExp(k + '="([^"]*)"')) || [])[1] || '';
      meta = { name: l.slice(l.lastIndexOf(',') + 1).trim() || attr('tvg-name'), logo: attr('tvg-logo'), group: attr('group-title') || 'Ungrouped', epgId: attr('tvg-id') };
    } else if (l && !l.startsWith('#') && meta) {
      const kind = /\/movie\//.test(l) ? 'movie' : /\/series\//.test(l) ? 'series' : 'live';
      const g = groups[kind];
      if (!g.has(meta.group)) g.set(meta.group, 'g' + g.size);
      out[kind].push({ id: l, name: meta.name, icon: meta.logo, cat: g.get(meta.group), num: ++n, url: l, direct: true });
      meta = null;
    }
  }
  const cats = {};
  for (const k of Object.keys(groups)) cats[k] = [...groups[k]].map(([name, id]) => ({ id, name }));
  return { items: out, cats };
}

/* ---------- Connect ---------- */
async function connect(p) {
  S.profile = p; S.loaded = {}; S.cats = { live: [], movie: [], series: [] }; S.items = { live: [], movie: [], series: [] };
  if (p.type === 'xtream') {
    const info = await api('');
    if (!info.user_info || info.user_info.auth === 0) throw new Error('Login refused. Check the username and password.');
    const ui = info.user_info;
    const exp = ui.exp_date ? new Date(ui.exp_date * 1000).toLocaleDateString('en-GB') : 'never';
    $('#acct').innerHTML = `${esc(p.name)}<br>Status: ${esc(ui.status)}<br>Expires: ${exp}<br>Connections: ${esc(ui.active_cons)}/${esc(ui.max_connections)}`;
  } else {
    const r = await fetch(p.m3u);
    if (!r.ok) throw new Error(`Playlist download failed (${r.status})`);
    const txt = await r.text();
    if (!txt.includes('#EXTINF')) throw new Error('That link did not return an M3U playlist.');
    const parsed = parseM3U(txt);
    S.items = parsed.items; S.cats = parsed.cats; S.loaded = { live: 1, movie: 1, series: 1 };
    $('#acct').innerHTML = `${esc(p.name)}<br>${S.items.live.length} channels`;
  }
  $('#login').hidden = true; $('#main').hidden = false;
  if (PHONE) window.AndroidBridge.setOrientation?.('auto');        // phone: turns with the phone once signed in
  await setSection('guide');
  if (S.settings.resume) resumeLast();
  hideSplash();
  // warm up search in the background (programme guide + fixtures) so pressing Search later is instant
  if (p.type === 'xtream') setTimeout(() => { if (S.profile === p) { loadXmltv(); loadSched(); } }, TV ? 6000 : 2000);
  if (!S.updTimer) { S.updTimer = setTimeout(() => updCheck(false), TV ? 25000 : 10000); setInterval(() => updCheck(false), 12 * 3600000); }
  if (p.type === 'xtream') { setTimeout(() => { if (S.profile === p) newsCheck(); }, TV ? 90000 : 30000); newsBadge(); setTimeout(newsNotify, 8000); }
}
// start-up screen shown while a saved playlist reconnects, so the login page never flashes up
function hideSplash() { const s = $('#splash'); if (s) s.hidden = true; }
function showLogin() { hideSplash(); $('#main').hidden = true; $('#login').hidden = false; if (PHONE) window.AndroidBridge.setOrientation?.('any'); }

/* reopen the last live channel watched on this playlist, with its category selected for zapping */
function resumeLast() {
  const last = store.get('lastLive:' + S.profile.id, null); if (!last) return;
  const it = S.items.live.find(i => i.id === last.id); if (!it) return;
  S.catId = it.cat; renderCats(); renderItems();
  let idx = S.view.findIndex(v => v.id === it.id);
  if (idx < 0) { S.catId = null; renderCats(); renderItems(); idx = S.view.findIndex(v => v.id === it.id); }   // e.g. category now hidden
  if (idx < 0) return;
  if (idx >= S.shown) { S.shown = idx + 100; renderItems(); }
  S.startFull = TV && !PHONE;                     // TV: the channel you come back to opens full screen (phones: plays in the guide, upright)
  openItem(S.view[idx]);
  document.querySelector(`#itemList li[data-idx="${idx}"]`)?.scrollIntoView({ block: 'center' });
  document.querySelector(`#gInner .g-row[data-i="${idx}"]`)?.scrollIntoView({ block: 'center', inline: 'nearest' });
  document.querySelector('#catList li.on')?.scrollIntoView({ block: 'center' });
}

async function loadSection(sec) {
  if (S.loaded[sec] || S.profile.type !== 'xtream') return;
  const map = { live: ['get_live_categories', 'get_live_streams'], movie: ['get_vod_categories', 'get_vod_streams'], series: ['get_series_categories', 'get_series'] };
  const [cA, iA] = map[sec];
  const [cats, items] = await Promise.all([api(cA), api(iA)]);
  S.cats[sec] = (cats || []).map(c => ({ id: String(c.category_id), name: c.category_name }));
  S.items[sec] = (items || []).map(i => ({
    id: String(sec === 'series' ? i.series_id : i.stream_id),
    name: i.name, icon: i.stream_icon || i.cover || '', cat: String(i.category_id),
    num: i.num, ext: i.container_extension, epgId: i.epg_channel_id, rating: i.rating || i.rating_5based * 2 || 0,
    added: +i.added || +i.last_modified || 0,
    ...(sec === 'series' ? { plot: i.plot || '', genre: i.genre || '', backdrop: Array.isArray(i.backdrop_path) ? i.backdrop_path[0] || '' : '' } : {})
  }));
  S.loaded[sec] = 1;
  if (sec === 'live') setTimeout(() => prepareSearch(S.items.live).catch(() => {}), TV ? 2500 : 500);
  if (sec === 'movie' || sec === 'series') setTimeout(() => sgBuildVod(sec).catch(() => {}), 300);
}
// get the channel list search-ready in the background (lower-case names, typo words, suggestions), in small
// slices, so the first search on a Fire Stick doesn't have to do it all at once while you wait
async function prepareSearch(list) {
  let at = performance.now();
  const v = new Set();
  for (let k = 0; k < list.length; k++) {
    const i = list[k];
    const n = i._nr ?? (i._nr = nrm(i.name)); if (i._nm === undefined) i._nm = norm(i.name);
    for (const w of n.split(' ')) if (w.length >= 4 && !/^\d+$/.test(w)) v.add(w);
    if ((k & 127) === 0 && performance.now() - at > 15) { await new Promise(r => setTimeout(r, 0)); at = performance.now(); if (S.items.live !== list) return; }
  }
  if (!vocab) { vocab = [...v]; vocabFor = xmltv; }
  if (!sgIndex.live) await sgBuildLiveSliced();
  epgIndex();
}

/* ---------- Favourites / recent ---------- */
const favKey = () => 'fav:' + S.profile.id, recKey = () => 'rec:' + S.profile.id;
const favs = () => store.get(favKey(), []);
const isFav = it => favs().some(f => f.kind === it.kind && f.id === it.id);
function toggleFav(it) {
  let f = favs();
  f = isFav(it) ? f.filter(x => !(x.kind === it.kind && x.id === it.id)) : [...f, it];
  store.set(favKey(), f); updateFavBtn();
  if (S.section !== 'guide') keepScroll(renderItems);       // re-drawing the guide would lose your place in it
}
function keepScroll(fn) { const l = $('#itemList'), y = l.scrollTop; fn(); l.scrollTop = y; }
const favData = c => ({ kind: c.kind, id: c.id, name: c.name, icon: c.icon, ext: c.ext, num: c.num, cat: c.cat, url: c.direct ? c.url : undefined, direct: c.direct });
function pushRecent(it) {
  const r = store.get(recKey(), []).filter(x => !(x.kind === it.kind && x.id === it.id));
  r.unshift(it); store.set(recKey(), r.slice(0, 50));
}

/* ---------- Rendering ---------- */
const dsec = () => S.section === 'guide' || S.section === 'search' || S.section === 'live' ? 'live' : S.section;   // guide + search use live TV data
const isSearch = () => S.section === 'search';
async function setSection(sec) {
  S.section = sec; S.catId = null; S.shown = 200;
  document.querySelectorAll('.rail-btn[data-sec]').forEach(b => b.classList.toggle('on', b.dataset.sec === sec));
  $('#catSearch').value = ''; $('#itemSearch').value = '';
  $('#itemSearch').placeholder = sec === 'search' ? SCOPES[S.searchScope || 'live'][1] : 'Search this category';
  $('#main').classList.toggle('guide-mode', sec === 'guide');
  $('#main').classList.toggle('search-mode', sec === 'search');
  if (sec !== 'search') $('#main').classList.remove('scope-pick');
  if (PHONE && document.activeElement?.matches?.('input')) { document.activeElement.blur(); document.documentElement.classList.remove('kb'); }
  if (PHONE) window.AndroidBridge.setOrientation?.(sec === 'search' ? 'portrait' : 'auto');   // phone: Search upright (full keyboard); elsewhere it turns with the phone   // phone: Search is upright (full keyboard), the rest sideways
  $('#main').classList.toggle('nf-mode', sec === 'movie' || sec === 'series');
  $('#main').classList.remove('film-play');
  S.allProgs = false;
  if (sec !== 'guide') stopGuideClock();
  if (sec === 'fav' || sec === 'recent') {
    $('#catList').innerHTML = ['live', 'movie', 'series'].map(k => `<li data-id="${k}"><span class="n">${{ live: 'TV channels', movie: 'Movies', series: 'Series' }[k]}</span></li>`).join('');
    S.catId = null; renderItems(); return;
  }
  $('#catList').innerHTML = '<li class="loading">Loading…</li>';
  $('#itemList').innerHTML = '';
  // Films / Series can take a few seconds to load: show it, and keep the remote on the page meanwhile
  // (pressing ▼ used to slide down the menu to Favourites while it loaded)
  if ((sec === 'movie' || sec === 'series') && !S.loaded[sec]) {
    $('#nf').innerHTML = `<div class="nf-loading" tabindex="-1">Loading ${sec === 'series' ? 'series' : 'films'}…</div>`;
    if (TV && !PHONE) setTimeout(() => $('#nf .nf-loading')?.focus(), 0);
  }
  try { await loadSection(dsec()); } catch (e) { $('#catList').innerHTML = `<li class="err">${esc(e.message)}</li>`; return; }
  if (sec === 'search') { showScopePicker(); return; }
  if (sec === 'movie' || sec === 'series') { renderBrowse(sec); setTimeout(() => document.querySelector('#nf .nf-btn.play, #nf .nf-card')?.focus(), 60); return; }
  if (sec === 'guide' && !S.catId) {   // start on the category of what's playing / last watched, else the first one
    const last = S.current?.kind === 'live' ? S.current : store.get('lastLive:' + S.profile.id, null);
    S.catId = (last && S.cats.live.some(c => c.id === last.cat)) ? last.cat : (visibleCats()[0]?.id || null);
  }
  renderCats(); renderItems();
}

/* favourite categories: starred ones go to the top of the list (per playlist, per section) */
const favCatKey = () => 'favCats:' + S.profile.id;
const favCats = (sec = dsec()) => (store.get(favCatKey(), {})[sec] || []);
const isFavCat = (id, sec = dsec()) => favCats(sec).includes(id);
function toggleFavCat(id, sec = dsec()) {
  const all = store.get(favCatKey(), {}), list = all[sec] || [];
  all[sec] = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
  store.set(favCatKey(), all);
  renderCats();
}
function visibleCats() {
  const q = $('#catSearch').value.toLowerCase();
  const list = S.cats[dsec()].filter(c => !(S.settings.hideAdult && adultRx.test(c.name)) && c.name.toLowerCase().includes(q));
  const fav = favCats();
  if (!fav.length) return list;
  const starred = fav.map(id => list.find(c => c.id === id)).filter(Boolean);     // in the order you starred them
  return [...starred, ...list.filter(c => !fav.includes(c.id))];
}
function renderCats() {
  const counts = {};
  for (const i of S.items[dsec()]) counts[i.cat] = (counts[i.cat] || 0) + 1;
  const cats = visibleCats();
  $('#catList').innerHTML = `<li data-id="" class="${S.catId ? '' : 'on'}"><span class="n">All</span><span class="c">${S.items[dsec()].length}</span></li>` +
    cats.map(c => { const f = isFavCat(c.id); return `<li data-id="${esc(c.id)}" class="${S.catId === c.id ? 'on' : ''}${f ? ' favcat' : ''}">${f ? '<span class="cstar">★</span>' : ''}<span class="n">${esc(c.name)}</span><span class="c">${counts[c.id] || 0}</span></li>`; }).join('');
}


/* ---------- Search suggestions (as you type) ----------
   A short list of titles is built once (programme titles + channel names + teams for Live TV, titles for films/series)
   and each keystroke only scans that list, so suggestions are instant and don't slow the main search down. */
const sgIndex = { live: null, liveFor: null, movie: null, series: null };
// live suggestions built in small slices in the background once the guide has loaded
// film / series suggestions (and search-ready titles) built in slices as soon as the list has loaded
const sgVodBusy = {};
function sgBuildVod(kind) {
  if (sgVodBusy[kind]) return sgVodBusy[kind];
  return (sgVodBusy[kind] = (async () => {
    const items = S.items[kind], m = new Map(); let at = performance.now();
    for (let i = 0; i < items.length; i++) {
      const it = items[i]; const t = cleanTitle(it.name); const k = nrm(t);
      if (it._nr === undefined) it._nr = nrm(it.name);
      if (k && !m.has(k)) m.set(k, { t, k, w: 1 + (+it.rating || 0) / 10 });
      if ((i & 127) === 0 && performance.now() - at > 15) { await new Promise(r => setTimeout(r, 0)); at = performance.now(); if (S.items[kind] !== items) return; }
    }
    sgIndex[kind] = { n: items.length, list: [...m.values()] };
  })().finally(() => { sgVodBusy[kind] = null; }));
}
let sgBuilding = null;
function sgBuildLiveSliced() { return sgBuilding || (sgBuilding = sgBuildLiveRun().finally(() => { sgBuilding = null; })); }
async function sgBuildLiveRun() {
  const key = (xmltv ? xmltv.length : 0) + ':' + S.items.live.length + ':' + (sched ? sched.length : 0);
  if (sgIndex.liveFor === key) return;
  const m = new Map(), list = xmltv || [];
  const add = (t, k, w) => { if (!k || k.length < 2) return; const o = m.get(k); if (o) o.w += w; else m.set(k, { t, k, w }); };
  const addRaw = (t, w) => { t = String(t || '').replace(/^\s*live\s*[:\-–]?\s*/i, '').trim(); add(t, nrm(t), w); };
  let at = performance.now();
  const breathe = async () => { if (performance.now() - at > 20) { await new Promise(r => setTimeout(r, 0)); at = performance.now(); } };
  for (let i = 0; i < S.items.live.length; i++) { addRaw(S.items.live[i].name.replace(/^[A-Z]{2,3}\s*[:|]\s*/, ''), 0.5); if ((i & 255) === 0) await breathe(); }
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (/^\s*live\b/i.test(p.title)) addRaw(p.title, 1); else add(p.title.trim(), p._t ?? nrm(p.title), 1);
    if ((i & 511) === 0) { await breathe(); if (xmltv !== list) return; }
  }
  if (sched) for (const e of sched) { addRaw(e.a?.full || e.a?.name, 3); addRaw(e.b?.full || e.b?.name, 3); }
  sgIndex.live = [...m.values()]; sgIndex.liveFor = key;
}
function sgTitles(kind) {
  if (kind === 'movie' || kind === 'series') {
    if (TV && (!sgIndex[kind] || sgIndex[kind].n !== S.items[kind].length)) { sgBuildVod(kind); return sgIndex[kind]?.list || []; }   // TV: built in the background
    if (!sgIndex[kind] || sgIndex[kind].n !== S.items[kind].length) {
      const m = new Map();
      for (const it of S.items[kind]) { const t = cleanTitle(it.name); const k = nrm(t); if (k && !m.has(k)) m.set(k, { t, k, w: 1 + (+it.rating || 0) / 10 }); }
      sgIndex[kind] = { n: S.items[kind].length, list: [...m.values()] };
    }
    return sgIndex[kind].list;
  }
  const key = (xmltv ? xmltv.length : 0) + ':' + S.items.live.length + ':' + (sched ? sched.length : 0);
  if (sgIndex.live && sgIndex.liveFor === key) return sgIndex.live;
  if (sgIndex.live) return sgIndex.live;          // a newer one is being built in the background – use the last one meanwhile
  if (TV) { sgBuildLiveSliced().catch(() => {}); return []; }   // TV: never build it while you wait
  const m = new Map();
  const add = (t, w) => { t = String(t || '').replace(/^\s*live\s*[:\-–]?\s*/i, '').trim(); const k = nrm(t); if (!k || k.length < 2) return; const o = m.get(k); if (o) o.w += w; else m.set(k, { t, k, w }); };
  for (const c of S.items.live) add(c.name.replace(/^[A-Z]{2,3}\s*[:|]\s*/, ''), 0.5);
  if (xmltv) for (const p of xmltv) add(p.title, 1);
  if (sched) for (const e of sched) { add(e.a?.full || e.a?.name, 3); add(e.b?.full || e.b?.name, 3); }
  sgIndex.live = [...m.values()]; sgIndex.liveFor = key;
  return sgIndex.live;
}
function sgFind(q, kind) {
  q = nrm(q); if (q.length < 2) return [];
  const starts = [], inside = [];
  for (const o of sgTitles(kind)) {
    if (o.k.startsWith(q)) starts.push(o);
    else if (inside.length < 200 && o.k.includes(' ' + q)) inside.push(o);
  }
  const by = (a, b) => b.w - a.w || a.t.length - b.t.length;
  return [...starts.sort(by), ...inside.sort(by)].filter(o => o.k !== q).slice(0, 7);
}
const SG = { input: null, list: [], idx: -1, pick: null };
const sgBox = Object.assign(document.createElement('div'), { id: 'suggest', className: 'suggest', hidden: true });
document.body.appendChild(sgBox);
function sgHide() { sgBox.hidden = true; SG.list = []; SG.idx = -1; }
function sgUpdate(input, kind, pick) {
  const list = sgFind(input.value, kind);
  SG.input = input; SG.list = list; SG.idx = -1; SG.pick = pick;
  if (!list.length || document.activeElement !== input) { sgHide(); return; }
  const r = input.getBoundingClientRect();
  sgBox.style.left = r.left + 'px'; sgBox.style.top = (r.bottom + 4) + 'px'; sgBox.style.width = r.width + 'px';
  const q = nrm(input.value);
  sgBox.innerHTML = list.map((o, i) => {
    const t = esc(o.t), at = o.k.indexOf(q);
    return `<button class="sg-item" tabindex="-1" data-i="${i}"><span class="sg-ico">${ICON.search}</span><span>${at === 0 ? `<b>${t.slice(0, input.value.trim().length)}</b>${t.slice(input.value.trim().length)}` : t}</span></button>`;
  }).join('');
  sgBox.hidden = false;
}
function sgChoose(i) {
  const o = SG.list[i]; if (!o || !SG.input) return;
  SG.input.value = o.t; sgHide(); SG.input.focus();
  SG.pick?.(o.t);
}
sgBox.addEventListener('mousedown', e => e.preventDefault());           // keep the search box focused
sgBox.addEventListener('click', e => { const b = e.target.closest('.sg-item'); if (b) sgChoose(+b.dataset.i); });
document.addEventListener('keydown', e => {
  if (sgBox.hidden) return;
  if (e.target === SG.input && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !TV) {
    e.preventDefault(); SG.idx += e.key === 'ArrowDown' ? 1 : -1;
    if (SG.idx >= SG.list.length) SG.idx = -1; if (SG.idx < -1) SG.idx = SG.list.length - 1;
    sgBox.querySelectorAll('.sg-item').forEach((b, i) => b.classList.toggle('on', i === SG.idx));
  } else if (e.target === SG.input && e.key === 'Enter' && SG.idx >= 0 && !TV) { e.preventDefault(); sgChoose(SG.idx); }
  else if (e.key === 'Escape') sgHide();
}, true);
document.addEventListener('focusout', () => setTimeout(() => { if (!sgBox.contains(document.activeElement) && document.activeElement !== SG.input) sgHide(); }, 150));
window.addEventListener('resize', sgHide);

/* Search: Live TV (channels, programmes, match cards) · Films · Series */
const ICON = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  live: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 21h8M9 2.5l3 3.5 3-3.5"/></svg>',
  movie: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>',
  series: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="14" height="12" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v9"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>'
};
document.querySelectorAll('#searchScope button[data-scope]').forEach(b => b.insertAdjacentHTML('afterbegin', ICON[b.dataset.scope]));
const SCOPES = { live: ['Live TV', 'Search teams, sports, channels, programmes…'], movie: ['Films', 'Search films by title…'], series: ['Series', 'Search series by title…'] };
// Search first asks what you're looking for (Live TV / Films / Series, or speak), then opens the box
let voiceOk = null;
// PC: show the real version in the menu (the Fire Stick / phone do it in tv-shim.js)
try { const v = !TV && window.native?.version?.(); if (v) document.querySelectorAll('.ver').forEach(el => { el.textContent = 'v' + v; }); } catch {}
const canPip = () => { try { return PHONE && !!window.AndroidBridge.pip && window.AndroidBridge.pip(); } catch { return false; } };
const canVoice = () => {
  if (voiceOk === null) { try { voiceOk = TV && !!window.AndroidBridge.voiceSearch && (window.AndroidBridge.hasVoice ? !!window.AndroidBridge.hasVoice() : true); } catch { voiceOk = false; } }
  return voiceOk;
};
function scopePickerHtml() {
  const tile = (k, t, d) => `<li class="scope-pick"><button class="scope-tile" data-pick="${k}">${ICON[k === 'voice' ? 'mic' : k]}<span><b>${t}</b><small>${d}</small></span></button></li>`;
  return `<li class="scope-q">What are you looking for?</li>` +
    tile('live', 'Live TV', 'Teams, sports, channels and programmes') + tile('movie', 'Films', 'Search films by title') + tile('series', 'Series', 'Search TV series by title') +
    (canVoice() ? tile('voice', 'Speak', 'Say it, e.g. “Liverpool live TV”, “Bad Boys film”, “Friends series”') : '');
}
function showScopePicker() {
  S.scopePicked = false; $('#main').classList.add('scope-pick');
  $('#itemSearch').value = ''; $('#itemCount').textContent = '';
  $('#itemList').innerHTML = scopePickerHtml();
  setTimeout(() => document.querySelector(`#itemList .scope-tile[data-pick="${S.searchScope || 'live'}"]`)?.focus(), 30);
}
function pickScope(k) {
  if (k === 'voice') return startVoice();
  S.scopePicked = true; $('#main').classList.remove('scope-pick');
  setSearchScope(k);
  setTimeout(() => $('#itemSearch').focus(), 0);
}
// "liverpool live tv", "live tv liverpool", "bad boys movie", "friends tv show" → where to search + what for
const SCOPE_WORDS = [
  ['series', /(^|\s)(tv shows?|tv series|series|box ?sets?|tv programmes?)(\s|$)/],
  ['movie', /(^|\s)(movies?|films?)(\s|$)/],
  ['live', /(^|\s)(live tv|live television|on tv|tv channels?|channels?|live|tv)(\s|$)/]
];
function splitScope(text) {
  const t = String(text || '').toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [k, rx] of SCOPE_WORDS) {
    const m = rx.exec(t); if (!m) continue;
    const at = m.index + m[1].length, before = t.slice(0, at).trim(), after = t.slice(at + m[2].length).trim();
    if (before && after) continue;                       // only at the start or the end ("live" inside "liverpool live arsenal" stays)
    const q = (before || after).replace(/^(search( for)?|find|play|watch|show me)\s+/, '').trim();
    if (!q) continue;
    if (k === 'live' && m[2] === 'live' && !before) continue;   // "live …" at the start is part of the search ("live golf")
    return { scope: k, q, bare: m[2] === 'live' };
  }
  return null;
}
function applySpoken(text) {
  if (S.section !== 'search') return false;
  const sp = splitScope(text);
  if (sp) { S.scopePicked = true; $('#main').classList.remove('scope-pick'); if (sp.scope !== S.searchScope) setSearchScope(sp.scope); $('#itemSearch').value = sp.q; }
  else { S.scopePicked = true; $('#main').classList.remove('scope-pick'); $('#itemSearch').value = text; }
  S.shown = 200; S.allProgs = false; renderItems();
  return !!sp;
}
function startVoice() {
  if (!canVoice()) return;
  if (S.section !== 'search') { setSection('search').then(() => window.AndroidBridge.voiceSearch()); return; }
  window.AndroidBridge.voiceSearch();
}
window.__voiceKey = () => startVoice();
if (canVoice()) { $('#btnVoice').innerHTML = ICON.mic; $('#btnVoice').hidden = false; }
window.__voiceResult = text => { if (S.section !== 'search') setSection('search').then(() => applySpoken(text)); else applySpoken(text); };
window.__voiceUnavailable = () => {
  if (S.section === 'search' && !S.scopePicked) pickScope(S.searchScope || 'live');
  window.AndroidBridge?.toast?.(PHONE ? 'Voice typing isn’t available – use the mic on your keyboard' : 'Open the keyboard, then hold the remote’s mic button and say e.g. “Liverpool live TV”');
};
function setSearchScope(sc) {
  S.searchScope = sc;
  document.querySelectorAll('#searchScope button').forEach(b => b.classList.toggle('on', b.dataset.scope === sc));
  $('#itemSearch').placeholder = SCOPES[sc][1];
  S.shown = 200; renderItems();
}
function renderSearchVod(q, kind) {
  const word = kind === 'series' ? 'series' : 'films';
  if (!S.loaded[kind] && S.profile.type === 'xtream') {
    $('#itemCount').textContent = ''; $('#itemList').innerHTML = `<li class="loading">Loading ${word}…</li>`;
    loadSection(kind).then(() => { if (isSearch() && S.searchScope === kind) renderItems(); }).catch(e => { $('#itemList').innerHTML = `<li class="err">${esc(e.message)}</li>`; });
    return;
  }
  if (!q) {
    S.view = []; $('#itemCount').textContent = '';
    $('#itemList').innerHTML = `<li class="search-hint"><b>Search ${word}</b><span>Type a title – nicknames and typos are fine. Or browse them in <i>${kind === 'series' ? 'Series' : 'Movies'}</i>.</span></li>`;
    return;
  }
  const hidden = S.settings.hideAdult ? new Set(S.cats[kind].filter(c => adultRx.test(c.name)).map(c => c.id)) : null;
  const sq = smartQuery(q);
  const list = S.items[kind].filter(m => !(hidden && hidden.has(m.cat)) && (sq.empty ? m.name.toLowerCase().includes(q) : sq.test(m._nr ?? (m._nr = nrm(m.name)))))
    .map(m => ({ ...m, kind })).sort((a, b) => (+b.rating || 0) - (+a.rating || 0));
  S.view = list;
  $('#itemCount').textContent = `${list.length.toLocaleString('en-GB')} ${kind === 'series' ? 'series' : list.length === 1 ? 'film' : 'films'}`;
  const catName = Object.fromEntries(S.cats[kind].map(c => [c.id, c.name]));
  $('#itemList').innerHTML = list.slice(0, S.shown).map((m, idx) => `<li data-idx="${idx}" class="vod-hit">
      ${m.icon ? `<img class="poster" loading="lazy" src="${esc(m.icon)}" onerror="this.style.visibility='hidden'">` : '<span class="poster"></span>'}
      <span class="n"><b>${esc(cleanTitle(m.name))}</b><small>${[yearOf(m.name), catName[m.cat], m.rating && +m.rating > 0 ? '★ ' + (+m.rating).toFixed(1) : ''].filter(Boolean).map(esc).join(' · ')}</small></span></li>`).join('')
    + (list.length > S.shown ? `<li class="more" data-more="1">Show more (${(list.length - S.shown).toLocaleString('en-GB')} left)</li>` : '')
    + (list.length ? '' : `<li class="loading">No ${word} match “${esc(q)}”.</li>`);
}

function renderItems() {
  if (isSearch() && !S.scopePicked) { $('#itemList').innerHTML = scopePickerHtml(); return; }
  const q = $('#itemSearch').value.toLowerCase();
  if (isSearch() && S.searchScope && S.searchScope !== 'live') return renderSearchVod(q.trim(), S.searchScope);
  let list;
  if (S.section === 'fav' || S.section === 'recent') {
    list = store.get(S.section === 'fav' ? favKey() : recKey(), []);
    if (S.catId) list = list.filter(i => i.kind === S.catId);
  } else {
    const hidden = S.settings.hideAdult ? new Set(S.cats[dsec()].filter(c => adultRx.test(c.name)).map(c => c.id)) : null;
    list = S.items[dsec()].filter(i => (!S.catId || i.cat === S.catId) && !(hidden && hidden.has(i.cat)));
  }
  if (isSearch() && !q) list = [];
  if (q) { const sq = smartQuery(q); list = sq.empty ? list.filter(i => (i.name || '').toLowerCase().includes(q)) : list.filter(i => sq.test(i._nr ?? (i._nr = nrm(i.name)))); }
  if (S.section !== 'fav' && S.section !== 'recent') { const k = dsec(); list = list.map(i => ({ ...i, kind: k })); }
  // live TV / guide: also look through programme titles across every channel
  const pq = (isSearch() || S.section === 'guide') && S.profile.type === 'xtream' && q.length >= 3 ? q : '';
  const progs = pq ? progMatches(pq) : [];
  if (S.section === 'guide' && progs.length) {             // show the channels carrying matching programmes too
    const have = new Set(list.map(i => i.id));
    for (const p of progs) if (!have.has(p.ch.id)) { have.add(p.ch.id); list.push({ ...p.ch, kind: 'live' }); }
  }
  S.view = list; S.progView = isSearch() ? progs : [];
  if (S.section === 'guide') return renderGuide();
  let elsewhere = 0;
  if (q && S.catId && S.section !== 'fav' && S.section !== 'recent') {
    const hidden = S.settings.hideAdult ? new Set(S.cats[dsec()].filter(c => adultRx.test(c.name)).map(c => c.id)) : null;
    elsewhere = S.items[dsec()].filter(i => i.cat !== S.catId && !(hidden && hidden.has(i.cat)) && (i.name || '').toLowerCase().includes(q)).length;
  }
  if (isSearch() && !q) {
    $('#itemCount').textContent = '';
    $('#itemList').innerHTML = `<li class="search-hint"><b>Search live TV</b><span>Teams, sports, competitions, channels and programmes – e.g. <i>liverpool</i>, <i>running</i>, <i>ufc</i>, <i>england cricket</i>, <i>f1</i>. Nicknames and typos are fine.</span></li>`;
    return;
  }
  $('#itemCount').textContent = `${list.length.toLocaleString('en-GB')} ${isSearch() ? (list.length === 1 ? 'channel' : 'channels') : list.length === 1 ? 'item' : 'items'}` +
    (pq ? (xmltvState === 'loading' || scanBusy ? ' · searching programmes…' : ` · ${progs.length} ${progs.length === 1 ? 'programme' : 'programmes'}`) : '');
  const favSet = new Set(favs().map(f => f.kind + ':' + f.id));
  const html = list.slice(0, S.shown).map((i, idx) => {
    const img = i.icon ? `<img class="${i.kind === 'live' ? 'logo' : 'poster'}" loading="lazy" src="${esc(i.icon)}" onerror="this.style.visibility='hidden'">` : `<span class="${i.kind === 'live' ? 'logo' : 'poster'}"></span>`;
    const on = S.current && S.current.kind === i.kind && S.current.id === i.id ? 'on' : '';
    const ev = i.kind === 'live' ? eventTime(i.name) : 0;
    return `<li data-idx="${idx}" class="${on}">${i.kind === 'live' ? `<span class="num">${esc(i.num ?? '')}</span>` : ''}${img}<span class="n">${esc(i.name)}</span>${ev ? `<span class="evt" title="Event starts ${esc(whenLong(ev))}">${hhmm(ev)} <span class="cd" data-st="${ev}">${countdown(ev)}</span></span>` : ''}${favSet.has(i.kind + ':' + i.id) ? '<span class="star">★</span>' : ''}</li>`;
  }).join('');
  const other = elsewhere ? `<li class="more" data-allcats="1">${elsewhere.toLocaleString('en-GB')} more ${elsewhere === 1 ? 'match' : 'matches'} in other categories – search all</li>` : '';
  const progHtml = pq ? progListHtml(progs) : '';
  // match cards: shown straight away if already worked out, otherwise worked out just after this list is on screen
  let evs = [];
  if (pq && isSearch()) {
    evs = evPeek(pq);
    if (!evs) { evs = []; clearTimeout(S.evT); S.evT = setTimeout(() => { if ($('#itemSearch').value.toLowerCase() === pq && isSearch()) { eventSearch(pq); keepScroll(renderItems); } }, 30); }
  }
  $('#itemList').innerHTML = (evs.length ? eventsHtml(evs) : '') + (evs.length && list.length ? '<li class="ev-head">Channels</li>' : '') + html + (list.length > S.shown ? `<li class="more" data-more="1">Show more (${(list.length - S.shown).toLocaleString('en-GB')} left)</li>` : '') + other +
    (list.length || other || (pq && (progs.length || xmltvState === 'loading' || scanBusy)) ? '' : `<li class="loading">${S.section === 'fav' ? 'Star a channel, film or series to see it here.' : S.section === 'recent' ? 'Things you watch will appear here.' : 'No matches.'}</li>`) + progHtml;
}

/* ---------- Player ---------- */
// start = seconds buffered before (re)starting live; stash = mpegts read-ahead KB; hls = segments behind live edge
const BUF = {
// target = seconds behind the newest data we aim to sit at; the player quietly speeds up to stay there
  smooth:   { start: 2,   target: 1.8, stash: 128, hlsSync: 3, hlsBuf: 30 },
  balanced: { start: 1,   target: 1,   stash: 0,   hlsSync: 3, hlsBuf: 20 },
  low:      { start: 0,   target: 0.5, stash: 0,   hlsSync: 2, hlsBuf: 10 }
};
let hls = null, ts = null, wd = null, playId = 0;
const video = $('#video');
function stopPlayer(keepLive) {
  stopBuiltin();
  if (!keepLive && !TV) window.native?.liveClose?.();      // PC: stop downloading the live buffer
  if (S.engineNow === 'vlc') { S.engineNow = 'builtin'; window.native?.vlc?.stop(); vlcUi(false); }
}
function stopBuiltin() {
  playId++; clearInterval(wd); wd = null;
  video.onplaying = video.onwaiting = video.onerror = null;
  if (hls) { try { hls.destroy(); } catch {} hls = null; }
  if (ts) { try { ts.pause(); ts.unload(); ts.detachMediaElement(); ts.destroy(); } catch {} ts = null; }
  video.removeAttribute('src'); video.load();
}
/* ---------- Embedded VLC engine ----------
   Settings → Player: "auto" = built-in first, VLC for channels it can't play or hear; "vlc" = always VLC; "builtin" = never. */
const vlcKey = it => (it.kind || 'live') + ':' + (it.parent?.id || it.id);
const vlcSet = new Set(store.get('vlcChannels', []));
function rememberVlc(it) { vlcSet.add(vlcKey(it)); store.set('vlcChannels', [...vlcSet].slice(-500)); }
function wantsVlc(it) {
  if (TV) return true;
  if (!window.native?.vlc || S.settings.engine === 'builtin') return false;
  return S.settings.engine === 'vlc' || vlcSet.has(vlcKey(it));
}
let vlcWatch = null;
async function playVlc(url, note) {
  stopBuiltin(); soundWarn('');
  const first = S.engineNow !== 'vlc';
  S.engineNow = 'vlc'; vlcUi(true); sendVlcBounds();
  msg(note || 'Starting VLC…');
  if (first) await new Promise(r => setTimeout(r, 800));       // let the provider drop the built-in player's connection
  if (TV) window.AndroidBridge.setOptions?.(JSON.stringify({ delay: liveDelayNow(), keepMin: +S.settings.rewindMin || 30, subs: S.settings.subs || 'off' }));
  else window.native?.liveOptions?.({ delay: liveDelayNow() });   // PC: the same live delay, built up at 97 %
  if (PHONE && S.section !== 'guide' && first) S.startFull = true;
  const r = await window.native.vlc.play(url);
  if (TV && r.ok) window.__netOnStart?.(S.current);
  if (TV && r.ok && S.startFull) { S.startFull = false; S.tvHinted = true; window.native.vlc.fullscreen(true); }
  if (TV && r.ok && !S.tvHinted) { S.tvHinted = true; window.AndroidBridge.toast?.(PHONE ? 'Tap the picture for full screen' : 'Press OK again for full screen'); }
  if (!r.ok) { S.engineNow = 'builtin'; vlcUi(false); msg('VLC couldn’t start: ' + r.error, true); return; }
  if (!TV && (S.settings.subs || 'off') === 'off') [2500, 6000].forEach(t => setTimeout(() => { if (S.engineNow === 'vlc') window.native.vlc.cmd('command=subtitle_track&val=-1'); }, t));
  clearTimeout(vlcWatch);
  vlcWatch = setTimeout(() => { if (S.engineNow === 'vlc' && $('#vlcState').dataset.s !== 'playing' && $('#vlcState').dataset.s !== 'paused') msg('VLC couldn’t open this stream. Try another channel, or wait a moment and try again.', true); }, 20000);
}
function sendVlcBounds() {
  if (S.engineNow !== 'vlc') return;
  const r = $('#playerWrap').getBoundingClientRect();
  window.native?.vlc?.bounds({ x: r.left, y: r.top, w: r.width, h: r.height });
}
function vlcUi(on) {
  $('#vlcBar').hidden = !on; $('#playerWrap').classList.toggle('vlc-on', on);
  $('#btnLive').hidden = on || S.current?.kind !== 'live';
  if (!on) { clearTimeout(vlcWatch); if (document.body.classList.contains('vlc-full')) toggleFull(); }
}
function toggleFull() {
  if (TV) { if (S.engineNow === 'vlc') window.native.vlc.fullscreen(!S.tvFull); return; }
  if (S.engineNow === 'vlc') {                    // VLC's window isn't part of the page, so make the whole window full screen and stretch the player
    const on = !document.body.classList.contains('vlc-full');
    document.body.classList.toggle('vlc-full', on);
    if (on) document.documentElement.requestFullscreen?.().catch(() => {}); else if (document.fullscreenElement) document.exitFullscreen();
    setTimeout(sendVlcBounds, 300);
  } else $('#playerWrap').requestFullscreen?.();
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('vlc-full')) { document.body.classList.remove('vlc-full'); setTimeout(sendVlcBounds, 300); } });
new ResizeObserver(sendVlcBounds).observe($('#playerWrap'));
window.addEventListener('resize', sendVlcBounds);
window.native?.vlc?.onEvent(ev => { if (ev === 'dblclick') toggleFull(); });
window.native?.vlc?.onState(s => {
  if (S.engineNow !== 'vlc') return;
  const st = $('#vlcState'); st.dataset.s = s.state;
  if (s.full !== undefined) S.tvFull = s.full;
  if (s.state === 'error') { msg(s.msg || 'Can’t play this channel.', true); clearTimeout(vlcWatch); return; }
  if (s.state === 'buffering') msg('Connecting…');
  if (s.state === 'playing') { msg(''); clearTimeout(vlcWatch); }
  if (s.state === 'exited') { S.engineNow = 'builtin'; vlcUi(false); msg('VLC closed unexpectedly – pick the channel again.', true); return; }
  const lag = s.behind != null && s.delay != null ? ` · ${Math.round(s.behind / 1000)} s behind live${s.behind < s.delay - 700 && s.state === 'playing' ? ' (building to ' + Math.round(s.delay / 1000) + ' s)' : ''}` : '';
  st.textContent = (s.state === 'playing' ? 'Playing in VLC' : s.state === 'paused' ? 'Paused' : 'Connecting…') + lag;
  $('#vlcPause').textContent = s.state === 'paused' ? '▶ Play' : '❚❚ Pause';
  if (s.volume != null) $('#vlcVol').textContent = Math.round(s.volume / 2.56) + '%';
});
let vlcLastVol = 256;
$('#vlcPause').onclick = () => window.native.vlc.cmd('command=pl_pause');
$('#vlcDown').onclick = () => window.native.vlc.cmd('command=volume&val=-26');
$('#vlcUp').onclick = () => window.native.vlc.cmd('command=volume&val=%2B26');
$('#vlcMute').onclick = async () => {
  const s = await window.native.vlc.cmd(''); if (!s) return;
  if (s.volume > 0) { vlcLastVol = s.volume; window.native.vlc.cmd('command=volume&val=0'); } else window.native.vlc.cmd('command=volume&val=' + (vlcLastVol || 256));
};
$('#vlcBuiltin').onclick = () => {                 // try the built-in player again for this channel
  if (!S.current?.url) return;
  vlcSet.delete(vlcKey(S.current)); store.set('vlcChannels', [...vlcSet]);
  const c = S.current; stopPlayer(); setTimeout(() => startItem(c, c.url, c.title), 800);
};

/* no-sound check: a muted player, or audio the built-in player can't decode (usually Dolby AC-3 / E-AC-3) */
function soundWarn(html) { const w = $('#soundWarn'); if (!w) return; w.innerHTML = html; w.hidden = !html; }
function checkSound(codec) {
  if (video.paused) return;
  const decoded = video.webkitAudioDecodedByteCount;
  window.native?.log?.(`audio: codec=${codec || '?'} decoded=${decoded} muted=${video.muted} vol=${video.volume.toFixed(2)} (${S.current?.name || ''})`);
  if (video.muted || video.volume === 0) {
    soundWarn(`<b>Sound is muted.</b> <button class="ghost" id="swUnmute">Unmute</button>`);
    $('#swUnmute').onclick = () => { video.muted = false; if (!video.volume) video.volume = 1; soundWarn(''); };
  } else if (decoded === 0 && codec !== 'none' && S.settings.engine === 'auto' && window.native?.vlc && S.current?.url) {
    rememberVlc(S.current);                       // next time this channel opens straight in VLC
    playVlc(S.current.url, 'No sound from the built-in player – switched to VLC for this channel.');
  } else if (decoded === 0 && codec !== 'none') {
    const dolby = /ac-?3|ec-?3|eac3|dolby/i.test(codec);
    soundWarn(`<b>No sound on this channel.</b> Its audio is ${dolby ? 'Dolby Digital (' + esc(codec) + ')' : esc(codec || 'in a format')} the built-in player can’t decode. <button class="ghost" id="swVlc">Open in VLC for sound</button>`);
    $('#swVlc').onclick = () => $('#btnExt').click();
  }
}
function msg(t, bad) { const m = $('#playerMsg'); m.textContent = t || ''; m.classList.toggle('bad', !!bad); m.hidden = !t; }
function ahead() {
  const b = video.buffered, t = video.currentTime;
  for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.3 && b.end(i) > t) return b.end(i) - t;
  return 0;
}

const LOCAL_LIVE = /^http:\/\/127\.0\.0\.1:\d+\/live\//;
function play(url, isLive, fallback, attempt = 0, busy = 0) {
  const proxied = LOCAL_LIVE.test(url);
  // PC: live .ts channels go through StarkTV's own buffer (keeps downloading across drop-outs, builds the live delay)
  if (!TV && isLive && !proxied && window.native?.liveOpen && !/\.m3u8(\?|$)/i.test(url) && !url.endsWith('#direct')) {
    stopPlayer(); const id0 = playId;
    window.native.liveOpen(url).then(u => { if (id0 === playId) play(u || url + '#direct', isLive, fallback, attempt, busy); });
    return;
  }
  stopPlayer(proxied); soundWarn(''); msg(busy ? `Provider busy – waiting for the last channel to disconnect (${busy})…` : attempt ? `Stream dropped – reconnecting (${attempt})…` : 'Connecting…');
  const id = playId, cfg = BUF[S.settings.buffer] || BUF.smooth;
  const kind = /\.m3u8(\?|$)/i.test(url) ? 'hls' : /\.(ts)(\?|$)/i.test(url) || (isLive && !/\.(mp4|mkv|avi|mov|webm)(\?|$)/i.test(url)) ? 'ts' : 'file';
  let started = 0, rebuf = isLive && cfg.start > 0, stuck = 0, lastT = -1;

  const fail = why => {
    if (id !== playId) return;
    // 469 = the provider still counts the channel you just left as connected: give it a moment, then retry the same stream
    if (!started && /\b469\b/.test(why) && busy < 4) {
      setTimeout(() => { if (id === playId) play(url, isLive, fallback, attempt, busy + 1); }, 1500 + busy * 1000);
      msg(`Provider busy – waiting for the last channel to disconnect…`); return;
    }
    // already played → the panel dropped us: reconnect to the same stream
    if (isLive && started && attempt < 6) {
      const next = Date.now() - started > 60000 ? 1 : attempt + 1;
      setTimeout(() => { if (id === playId) play(url, isLive, fallback, next); }, 800 * next);
      msg('Stream dropped – reconnecting…'); return;
    }
    if (fallback) { const f = fallback; fallback = null; play(f, isLive, null); return; }
    if (isLive && attempt < 2) { setTimeout(() => { if (id === playId) play(url, isLive, null, attempt + 1); }, 1500); return; }
    if (!/\b469\b/.test(why) && S.settings.engine === 'auto' && window.native?.vlc && S.current?.url) { rememberVlc(S.current); playVlc(S.current.url, 'The built-in player couldn’t play this – using VLC.'); return; }
    msg(/\b469\b/.test(why) ? 'Your provider refused the stream (469 – all connections on your account are in use). Stop it on other devices, or wait a minute.' : `Can’t play this here (${why}). Try “Open in VLC”.`, true);
  };
  const resume = () => { rebuf = false; video.play().catch(() => {}); };

  let audioCodec = '';
  video.onplaying = () => {
    if (id !== playId) return; msg('');
    if (!started) { started = Date.now(); setTimeout(() => { if (id === playId) checkSound(audioCodec); }, 6000); }
  };
  video.onwaiting = () => {
    if (id !== playId) return;
    msg('Buffering…');
    // live: hold until a proper cushion has built up instead of stutter-stall-stutter
    if (isLive && started && cfg.start > 0 && !rebuf) { rebuf = true; video.pause(); }
  };
  video.onerror = () => fail(video.error ? 'decoder error ' + video.error.code : 'unknown error');

  if (kind === 'hls' && window.Hls && Hls.isSupported()) {
    hls = new Hls({
      enableWorker: true, lowLatencyMode: false,
      maxBufferLength: cfg.hlsBuf, maxMaxBufferLength: cfg.hlsBuf * 2, backBufferLength: 30,
      liveSyncDurationCount: cfg.hlsSync, liveMaxLatencyDurationCount: cfg.hlsSync + 4, maxLiveSyncPlaybackRate: 1.1,
      manifestLoadingMaxRetry: 4, levelLoadingMaxRetry: 6, fragLoadingMaxRetry: 8, fragLoadingRetryDelay: 500
    });
    let mediaRecovered = 0;
    hls.on(Hls.Events.ERROR, (_e, d) => {
      if (!d.fatal || id !== playId) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecovered++ < 2) { hls.recoverMediaError(); return; }
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR && started) { hls.startLoad(); return; }
      fail(d.details);
    });
    hls.on(Hls.Events.MANIFEST_PARSED, (_e, d) => { audioCodec = d.levels?.[0]?.audioCodec || ''; });
    hls.loadSource(url); hls.attachMedia(video);
  } else if (kind === 'ts' && window.mpegts && mpegts.isSupported()) {
    ts = mpegts.createPlayer({ type: 'mpegts', isLive, url }, {
      enableWorker: true, lazyLoad: false,
      enableStashBuffer: cfg.stash > 0, stashInitialSize: Math.max(cfg.stash, 64) * 1024,   // stash = hidden extra delay, keep it small
      liveBufferLatencyChasing: S.settings.buffer === 'low',   // chasing is what caused constant skipping/stalls
      liveBufferLatencyMaxLatency: 8, liveBufferLatencyMinRemain: 3,
      autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 60, autoCleanupMinBackwardDuration: 30,
      fixAudioTimestampGap: true
    });
    ts.on(mpegts.Events.ERROR, (t, d, info) => fail(`${t} ${d || ''} ${info?.code || ''}`.trim()));
    ts.on(mpegts.Events.MEDIA_INFO, mi => { audioCodec = mi?.audioCodec || (mi?.hasAudio === false ? 'none' : ''); });
    if (isLive) ts.on(mpegts.Events.LOADING_COMPLETE, () => fail('stream ended'));
    ts.attachMediaElement(video); ts.load();
  } else {
    video.src = url;
  }
  video.muted = false;
  if (!rebuf) video.play().catch(() => {});

  // live watchdog: release the pre-buffer, and reconnect if the picture freezes
  if (isLive) wd = setInterval(() => {
    if (id !== playId) return;
    const a = ahead();
    if (rebuf && (a >= cfg.start || (stuck >= 8 && a > 0.5))) resume();
    const frozen = rebuf || (!video.paused && video.currentTime === lastT);
    stuck = frozen ? stuck + 1 : 0;
    lastT = video.currentTime;
    if (stuck >= 20) { stuck = 0; fail('stalled'); }
    // PC live buffer: play at 97 % until the picture is "Live delay" seconds behind, never chase live
    if (proxied && !rebuf && !video.paused) {
      const want = a < liveDelayNow() - 0.7 ? 0.97 : 1;
      if (video.playbackRate !== want) video.playbackRate = want;
      S.liveLag = a;
    }
    // catch-up: every stall used to add delay permanently; now drift back towards live
    else if (!rebuf && !video.paused && kind !== 'hls') {
      if (a > cfg.target + 20) { video.currentTime += a - cfg.target; }          // way behind (e.g. after a pause) → jump
      else if (a > cfg.target + 0.5) video.playbackRate = a > cfg.target + 4 ? 1.12 : 1.05;  // slightly faster, pitch kept
      else if (a < cfg.target + 0.15) video.playbackRate = 1;
    }
  }, 1000);
}

function startItem(it, url, title) {
  S.current = { ...it, url, title: title || it.name };
  $('#npTitle').textContent = S.current.title;
  ['#btnFav', '#btnExt', '#btnFull'].forEach(s => $(s).disabled = false);
  $('#btnLive').hidden = it.kind !== 'live';
  updateFavBtn();
  const isLive = it.kind === 'live';
  if (S.section === 'guide') document.querySelectorAll('#gInner .g-row').forEach(r => r.classList.toggle('on', S.view[r.dataset.i]?.id === it.id));
  if (isLive) store.set('lastLive:' + S.profile.id, { id: it.id, cat: it.cat });
  let fallback = null;
  if (isLive && S.profile.type === 'xtream') fallback = streamUrl('live', it.id, '').replace(/\.(ts|m3u8)$/, S.settings.format === 'ts' ? '.m3u8' : '.ts');
  if (wantsVlc(it)) playVlc(url); else play(url, isLive, fallback);
  pushRecent({ kind: it.kind, id: it.id, name: it.name, icon: it.icon, ext: it.ext, num: it.num, cat: it.cat });
  document.querySelectorAll('#itemList li').forEach(li => li.classList.toggle('on', S.view[li.dataset.idx]?.id === it.id));
}
function updateFavBtn() {
  if (!S.current) return;
  const target = S.current.parent || S.current;
  $('#btnFav').textContent = isFav(target) ? 'Remove from favourites' : 'Add to favourites';
}

/* ---------- Item actions ---------- */
async function openItem(it) {
  // TV: picking a channel plays it in the small window; picking the same channel again goes full screen
  if (TV && S.engineNow === 'vlc' && S.current && S.current.id === it.id && (S.current.kind || 'live') === (it.kind || 'live')) {
    window.native.vlc.fullscreen(true); return;
  }
  const d = $('#detail');
  if (it.kind === 'live') {
    startItem(it, it.direct ? it.url : streamUrl('live', it.id));
    d.innerHTML = '';
    if (S.profile.type === 'xtream') loadEpg(it);
    return;
  }
  if (it.direct) { startItem(it, it.url); d.innerHTML = ''; return; }
  if (it.kind === 'movie') {
    d.innerHTML = '<div class="loading">Loading details…</div>';
    let info = {};
    try { info = (await api('get_vod_info', `&vod_id=${it.id}`)).info || {}; } catch {}
    d.innerHTML = `<div class="vod">${info.movie_image ? `<img src="${esc(info.movie_image)}">` : ''}<div>
      <p>${esc(info.plot || info.description || 'No description.')}</p>
      <div>${[info.releasedate || info.release_date, info.duration, info.genre, info.rating ? '★ ' + info.rating : ''].filter(Boolean).map(esc).join('  |  ')}</div>
      ${info.cast ? `<div style="margin-top:6px">Cast: ${esc(info.cast)}</div>` : ''}
      <p><button class="primary" id="playMovie">Play film</button></p></div></div>`;
    const w = watchAll('movie')[it.id], from = w && !w.done && w.pos > 60 && w.pos < w.dur - 120 ? w.pos : 0;
    if (from) $('#playMovie').textContent = `▶ Resume from ${hhmmss(from)}`;
    $('#playMovie').onclick = () => playFilm(it, from);
    S.current = { ...it, title: it.name }; $('#npTitle').textContent = it.name; $('#btnFav').disabled = false; updateFavBtn();
    return;
  }
  // series
  d.innerHTML = '<div class="loading">Loading episodes…</div>';
  $('#npTitle').textContent = it.name; S.current = { ...it, title: it.name }; $('#btnFav').disabled = false; updateFavBtn();
  let data;
  try { data = await api('get_series_info', `&series_id=${it.id}`); } catch (e) { d.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const eps = data.episodes || {}, seasons = Object.keys(eps).sort((a, b) => a - b), info = data.info || {};
  if (!seasons.length) { d.innerHTML = '<p>No episodes listed for this series.</p>'; return; }
  const draw = s => {
    d.querySelectorAll('.season-tabs button').forEach(b => b.classList.toggle('on', b.dataset.s === s));
    d.querySelector('.eps').innerHTML = eps[s].map((e, i) => `<li data-i="${i}"><b>E${esc(e.episode_num)}</b><span>${esc(e.title)}</span></li>`).join('');
    d.querySelectorAll('.eps li').forEach(li => li.onclick = () => {
      const e = eps[s][li.dataset.i];
      startItem({ kind: 'series', id: it.id, name: it.name, icon: it.icon, cat: it.cat }, streamUrl('series', e.id, e.container_extension), `${it.name} – S${s} E${e.episode_num}`);
    });
  };
  d.innerHTML = `${info.plot ? `<p>${esc(info.plot)}</p>` : ''}<div class="season-tabs">${seasons.map(s => `<button class="ghost" data-s="${s}">Season ${s}</button>`).join('')}</div><ul class="eps"></ul>`;
  d.querySelectorAll('.season-tabs button').forEach(b => b.onclick = () => draw(b.dataset.s));
  draw(seasons[0]);
}

async function loadEpg(it) {
  const d = $('#detail');
  try {
    const r = await api('get_short_epg', `&stream_id=${it.id}&limit=6`);
    if (S.current?.id !== it.id) return;
    const list = (r.epg_listings || []);
    if (!list.length) { d.innerHTML = '<p>No programme guide for this channel.</p>'; return; }
    const now = Date.now() / 1000;
    const fmt = t => { const d = new Date(t * 1000); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    d.innerHTML = '<div class="epg">' + list.map(p => {
      const st = +p.start_timestamp, en = +p.stop_timestamp, live = st <= now && now < en;
      const pct = live ? Math.round((now - st) / (en - st) * 100) : 0;
      return `<span class="t">${fmt(st)}–${fmt(en)}</span><span class="${live ? 'now' : ''}">${esc(b64(p.title))}</span>` +
        (live ? `<span></span><div class="bar"><i style="width:${pct}%"></i></div><span></span><span>${esc(b64(p.description))}</span>` : '');
    }).join('') + '</div>';
  } catch { d.innerHTML = ''; }
}


/* ---------- Programme search ----------
   Xtream panels publish the whole guide at xmltv.php. It's fetched once (in the background), trimmed to
   what's on now / coming up, and searched by title. Falls back to listings already loaded in the guide. */
let xmltv = null, xmltvFor = '', xmltvAt = 0, xmltvState = '', xmltvP = null;
const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (XML_ENT[e.toLowerCase()] ?? m)).trim();
function xmltvTime(s) {                          // "20261101200000 +0000" → unix seconds
  const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-]\d{4})?/.exec(s || ''); if (!m) return 0;
  const t = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000;
  if (!m[7]) return t;
  const z = m[7], off = (+z.slice(1, 3) * 3600 + +z.slice(3, 5) * 60) * (z[0] === '-' ? -1 : 1);
  return t - off;
}
function loadXmltv() {
  const pid = S.profile.id;
  if (xmltv && xmltvFor === pid && Date.now() - xmltvAt < 60 * 60000) return Promise.resolve(xmltv);
  if (xmltvP && xmltvFor === pid) return xmltvP;
  xmltvFor = pid; xmltvState = 'loading';
  const p = S.profile;
  xmltvP = (async () => {
    const r = await fetch(`${base(p)}/xmltv.php?username=${encodeURIComponent(p.user)}&password=${encodeURIComponent(p.pass)}`);
    if (!r.ok) throw new Error(`guide download failed (${r.status})`);
    // read the guide as it downloads and parse it piece by piece (no giant string, no long freeze on a Fire Stick)
    const now = Date.now() / 1000, until = now + 8 * 86400, out = [];
    const attr = (a, k) => (new RegExp(`\\b${k}="([^"]*)"`).exec(a) || [])[1] || '';
    const rx = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
    let sliceAt = performance.now(), total = 0, buf = '';
    const eat = async final => {
      rx.lastIndex = 0; let m, end = 0;
      while ((m = rx.exec(buf))) {
        end = rx.lastIndex;
        if (performance.now() - sliceAt > 12) { await new Promise(r => setTimeout(r, 0)); sliceAt = performance.now(); if (xmltvFor !== pid) return false; }
        const st = xmltvTime(attr(m[1], 'start')), en = xmltvTime(attr(m[1], 'stop'));
        if (!st || en <= now || st > until) continue;
        const title = unxml((/<title\b[^>]*>([\s\S]*?)<\/title>/.exec(m[2]) || [])[1]);
        const sub = unxml((/<sub-title\b[^>]*>([\s\S]*?)<\/sub-title>/.exec(m[2]) || [])[1]);
        const desc = unxml((/<desc\b[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]) || [])[1]);
        const cat = [...m[2].matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/g)].map(x => unxml(x[1])).join(' ');
        const o = { st, en, title, desc: sub && !desc.includes(sub) ? (sub + (desc ? ' – ' + desc : '')) : desc, epg: unxml(attr(m[1], 'channel')).toLowerCase(), cat,
          live: /<live\s*\/?>/.test(m[2]) || /\blive\b/i.test(title) || /^\s*live\b/i.test(desc), rerun: /<previously-shown\b/.test(m[2]) };
        o._t = nrm(o.title); o._r = nrm(o.cat + ' ' + o.desc);    // search-ready text, prepared once here instead of on every search
        out.push(o);
      }
      // keep only the unfinished tail (from the last complete programme, or the last "<programme" seen)
      if (end) buf = buf.slice(end);
      else if (!final) { const k = buf.lastIndexOf('<programme'); buf = k > 0 ? buf.slice(k) : buf; }
      return true;
    };
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader(), dec = new TextDecoder();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) { buf += dec.decode(); break; }
        total += value.length; buf += dec.decode(value, { stream: true });
        if (buf.length > 1 << 18 && !(await eat(false))) { try { rd.cancel(); } catch {} return []; }
      }
    } else { buf = await r.text(); total = buf.length; }
    if (!(await eat(true))) return [];
    const txt = { length: total };
    if (xmltvFor !== pid) return [];
    xmltv = out; xmltvAt = Date.now(); xmltvState = out.length ? 'ok' : 'empty';
    await buildVocabSliced();
    window.native?.log?.(`xmltv: ${out.length} upcoming programmes (${Math.round(txt.length / 1048576)} MB)`);
    return out;
  })().catch(e => { if (xmltvFor === pid) { xmltvState = 'failed'; xmltv = null; } window.native?.log?.('xmltv: ' + e.message); return []; })
    .finally(() => { if (xmltvFor === pid) xmltvP = null; });
  return xmltvP;
}
/* ---------- Smart matching: synonyms, topics, nicknames, typos ----------
   Every word of the search must match (in any order). A word matches its own text at a word start,
   any synonym ("soccer" ⇄ "football", "spurs" → "tottenham"), any topic expansion ("running" → marathon,
   athletics, 10k…) and, if it looks like a typo, close spellings of words that are actually in the guide. */
const SYN_GROUPS = [
  'football|soccer|futbol', 'premier league|epl|prem', 'champions league|ucl', 'europa league|uel', 'carabao cup|efl cup|league cup',
  'formula 1|formula one|f1|grand prix', 'motogp|moto gp', 'american football|nfl|gridiron', 'basketball|nba', 'ice hockey|nhl', 'baseball|mlb',
  'ufc|mma|cage fighting', 'wrestling|wwe|aew', 'darts|pdc', 'snooker|wst', 'six nations|6 nations', 'odi|one day international|one day',
  't20|twenty20|t20i', 'match of the day|motd', 'monday night football|mnf', 'sunday night football|snf',
  'manchester united|man utd|man united|man u', 'manchester city|man city', 'tottenham|spurs', 'wolverhampton|wolves', 'nottingham forest|nottm forest',
  'brighton|seagulls', 'west ham|hammers', 'newcastle|toon', 'psg|paris saint germain|paris sg', 'inter|inter milan|internazionale',
  'barcelona|barca', 'atletico|atleti', 'bayern|bayern munich', 'dortmund|bvb', 'juventus|juve',
  'south africa|proteas|springboks', 'new zealand|all blacks|black caps|blackcaps', 'australia|wallabies|aussies|socceroos',
  'west indies|windies', 'england|three lions|lionesses', 'argentina|pumas'
].map(l => l.split('|'));
// topic words widen to everything that belongs to them (one way: "running" finds marathons, not the reverse)
const TOPICS = {
  running: ['running', 'marathon', 'half marathon', 'athletics', '10k', 'parkrun', 'great north run', 'great run', 'cross country', 'ultra trail', 'road race', 'world marathon majors', 'track and field', 'diamond league'],
  athletics: ['athletics', 'marathon', 'diamond league', 'track and field', 'world athletics', 'sprint', 'relay'],
  marathon: ['marathon', 'world marathon majors'],
  football: ['football', 'soccer', 'premier league', 'championship', 'fa cup', 'efl', 'carabao cup', 'champions league', 'europa league', 'conference league', 'la liga', 'serie a', 'bundesliga', 'ligue 1', 'spfl', 'wsl', 'mls', 'futbol', 'match of the day'],
  cricket: ['cricket', 'test match', 'odi', 't20', 'ipl', 'the hundred', 'ashes', 'big bash', 'county championship', 'vitality blast'],
  rugby: ['rugby', 'six nations', 'premiership rugby', 'gallagher', 'urc', 'top 14', 'champions cup', 'super rugby', 'autumn nations', 'super league', 'challenge cup', 'rugby league'],
  ufc: ['ufc', 'mma', 'fight night', 'bellator', 'pfl'], mma: ['mma', 'ufc', 'fight night', 'bellator', 'pfl'],
  boxing: ['boxing', 'fight night', 'heavyweight', 'title fight', 'undercard'],
  fighting: ['ufc', 'mma', 'boxing', 'fight night'],
  motorsport: ['motorsport', 'f1', 'formula 1', 'formula one', 'grand prix', 'motogp', 'indycar', 'nascar', 'btcc', 'wec', 'le mans', 'formula e', 'wrc', 'rally'],
  racing: ['racing', 'horse racing', 'motorsport', 'f1', 'grand prix', 'motogp', 'nascar', 'indycar'],
  'horse racing': ['horse racing', 'racing', 'cheltenham', 'ascot', 'aintree', 'grand national', 'epsom', 'newmarket'],
  golf: ['golf', 'pga', 'dp world tour', 'ryder cup', 'the masters', 'open championship', 'liv golf', 'lpga'],
  tennis: ['tennis', 'atp', 'wta', 'wimbledon', 'us open', 'australian open', 'roland garros', 'french open', 'davis cup', 'queens'],
  cycling: ['cycling', 'tour de france', 'giro', 'vuelta', 'velodrome', 'tour of britain'],
  swimming: ['swimming', 'aquatics', 'diving'],
  nfl: ['nfl', 'american football', 'super bowl', 'redzone', 'red zone'],
  sport: ['sport', 'sports', 'live'], sports: ['sport', 'sports', 'live']
};
TOPICS.soccer = TOPICS.football; TOPICS.run = TOPICS.running; TOPICS.f1 = ['f1', 'formula 1', 'formula one', 'grand prix']; TOPICS['formula 1'] = TOPICS.f1;
const SYN_OF = new Map(); for (const g of SYN_GROUPS) for (const t of g) SYN_OF.set(t, g);
const SMART_STOP = new Set(['v', 'vs', 'versus', 'the', 'on', 'at', 'watch', 'whats', 'what', 'is', 'and', 'for', 'tonight', 'today', 'tv', 'channel']);
const nrm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

let vocab = null, vocabFor = null;                 // distinct words in channel names + the guide, for typo correction
function buildVocab() {               // normally already done in the background by buildVocabSliced()
  if (vocab && vocabFor === xmltv) return vocab;
  if (vocab && (TV || xmltvState === 'loading')) return vocab;   // the background build will bring it up to date
  const v = new Set();
  const add = t => { for (const w of t.split(' ')) if (w.length >= 4 && !/^\d+$/.test(w)) v.add(w); };
  for (const i of S.items.live) add(nrm(i.name));
  if (xmltv) for (const p of xmltv) add(p._t ?? nrm(p.title));
  vocab = [...v]; vocabFor = xmltv; return vocab;
}
async function buildVocabSliced() {
  const list = xmltv, v = new Set();
  const add = t => { for (const w of t.split(' ')) if (w.length >= 4 && !/^\d+$/.test(w)) v.add(w); };
  let at = performance.now();
  const live = S.items.live;
  for (let k = 0; k < live.length; k++) {
    add(live[k]._nr ?? (live[k]._nr = nrm(live[k].name)));
    if ((k & 255) === 0 && performance.now() - at > 25) { await new Promise(r => setTimeout(r, 0)); at = performance.now(); }
  }
  for (let k = 0; k < (list || []).length; k++) {
    add(list[k]._t ?? nrm(list[k].title));
    if (performance.now() - at > 25) { await new Promise(r => setTimeout(r, 0)); at = performance.now(); if (xmltv !== list) return; }
  }
  vocab = [...v]; vocabFor = list;
  setTimeout(() => { sgBuildLiveSliced().catch(() => {}); }, 300);      // suggestions ready before you type
}
function editDist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev[j - 2] + 1);   // swapped letters
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
const smartCache = new Map();
// q → { terms: [{ word, alts:[...] }], test(text) → true/false, score(title, rest) }
function smartQuery(q) {
  const key = q + '|' + (xmltv ? xmltv.length : 0);
  if (smartCache.has(key)) return smartCache.get(key);
  let s = ' ' + nrm(q) + ' ';
  const terms = [];
  // phrases first ("formula 1", "american football", "horse racing", "man utd"…)
  const phrases = [...Object.keys(TOPICS), ...SYN_GROUPS.flat()].filter(p => p.includes(' ')).sort((a, b) => b.length - a.length);
  for (const p of phrases) if (s.includes(' ' + p + ' ')) { terms.push(p); s = s.replace(' ' + p + ' ', ' '); }
  terms.push(...s.trim().split(' ').filter(w => w && !SMART_STOP.has(w)));
  const words = vocab || [];
  const out = terms.map(t => {
    const alts = new Set([t]);
    (SYN_OF.get(t) || []).forEach(a => alts.add(a));
    (TOPICS[t] || []).forEach(a => alts.add(a));
    // typo: an unknown word of 5+ letters → close real words from the guide/channel names
    if (t.length >= 5 && !t.includes(' ') && !TOPICS[t] && !SYN_OF.get(t) && words.length && !words.some(w => w.startsWith(t))) {
      const max = t.length >= 8 ? 2 : 1;
      for (const w of words) if (w[0] === t[0] || w[1] === t[1]) { if (editDist(t, w, max) <= max) alts.add(w); }
    }
    const list = [...alts];
    return { word: t, alts: list, rx: new RegExp('(?:^|[^a-z0-9])(?:' + list.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')') };
  });
  const res = {
    terms: out, empty: !out.length,
    test: txt => out.length > 0 && out.every(t => t.rx.test(txt)),
    // 3 = every word in the title, 2 = some in the title, 1 = description only
    score: (title, rest) => { if (!out.length) return 0; let inT = 0; for (const t of out) { if (t.rx.test(title)) inT++; else if (!t.rx.test(rest)) return 0; } return inT === out.length ? 3 : inT ? 2 : 1; }
  };
  smartCache.set(key, res); if (smartCache.size > 200) smartCache.clear();
  return res;
}

// one pass over the guide per search, shared by the programme list and the match cards (and remembered while typing)
const scanCache = new Map();
// The scan runs in small slices in the background (a Fire Stick needs ~0.5 s for a big guide), so typing never
// freezes. While it runs the caller gets [] and scanBusy is true; when it finishes the search redraws itself.
let scanBusy = false, scanTok = 0;
const scanKey = q => q + '|' + xmltvAt + '|' + Math.floor(Date.now() / 60000);
function guideScan(q) {
  if (!xmltv) return [];
  const key = scanKey(q);
  const hit = scanCache.get(key); if (hit) { if (scanBusy && scanBusy.key === key) scanBusy = false; return hit; }
  if (scanBusy && scanBusy.key === key) return [];
  const sq = smartQuery(q); if (sq.empty) return [];
  const tok = ++scanTok, job = { key }; scanBusy = job;
  (async () => {
    const now = Date.now() / 1000, out = [], list = xmltv;
    let t0 = performance.now();
    for (let i = 0; i < list.length; i++) {
      if ((i & 1023) === 0 && performance.now() - t0 > 12) { await new Promise(r => setTimeout(r, 0)); if (tok !== scanTok) return; t0 = performance.now(); }
      const p = list[i];
      if (p.en <= now) continue;
      if (p._t === undefined) { p._t = nrm(p.title); p._r = nrm((p.cat || '') + ' ' + p.desc); }
      const sc = sq.score(p._t, p._r); if (sc) out.push([p, sc]);
    }
    if (scanCache.size > 30) scanCache.clear();
    scanCache.set(key, out);
    if (scanBusy === job) scanBusy = false;
    const v = ($('#itemSearch').value || '').toLowerCase();
    if (v === q || v.trim() === q.trim()) renderItems();
  })();
  return [];
}
// programmes (on now or later) that match the search, each paired with a channel you can play
// epg id → channels carrying it (built once per channel list, not on every keystroke)
let epgIdx = null, epgIdxKey = null;
function epgIndex() {
  const key = S.items.live.length + ':' + (S.items.live[0]?.id ?? '') + ':' + !!S.settings.hideAdult + ':' + S.profile?.id;
  if (epgIdx && epgIdxKey === key) return epgIdx;
  const hidden = S.settings.hideAdult ? new Set(S.cats.live.filter(c => adultRx.test(c.name)).map(c => c.id)) : null;
  const m = new Map();
  for (const i of S.items.live) if (i.epgId && !(hidden && hidden.has(i.cat))) { const k = String(i.epgId).toLowerCase(); if (!m.has(k)) m.set(k, []); m.get(k).push(i); }
  epgIdx = m; epgIdxKey = key; return m;
}
const chNorm = ch => ch._nm ?? (ch._nm = norm(ch.name));
function progMatches(q) {
  if (!(xmltv && xmltvFor === S.profile.id) && !(xmltvState === 'failed' && xmltvFor === S.profile.id)) {
    const want = q;
    loadXmltv().then(() => { if ($('#itemSearch').value.toLowerCase() === want) renderItems(); });
  }
  const now = Date.now() / 1000;
  const hidden = S.settings.hideAdult ? new Set(S.cats.live.filter(c => adultRx.test(c.name)).map(c => c.id)) : null;
  const ok = i => !(hidden && hidden.has(i.cat));
  const hits = [], seen = new Set();
  const add = (p, ch, score) => {
    const k = ch.id + ':' + p.st; if (seen.has(k)) return; seen.add(k);
    hits.push({ ...p, ch, score });
  };
  buildVocab();
  const sq = smartQuery(q); if (sq.empty) return [];
  const score = p => { if (p._t === undefined) { p._t = nrm(p.title); p._r = nrm((p.cat || '') + ' ' + p.desc); }
    const s = sq.score(p._t, p._r); return s ? s + (isLiveProg(p) ? 0.5 : 0) : 0; };
  if (xmltv && xmltvFor === S.profile.id) {
    const byEpg = epgIndex();
    for (const [p, s0] of guideScan(q)) {
      const s = s0 + (isLiveProg(p) ? 0.5 : 0);
      const chs = byEpg.get(p.epg); if (!chs) continue;
      const k = p.epg + ':' + p.st; if (seen.has(k)) continue; seen.add(k);   // one row per programme, even if several streams carry it
      hits.push({ ...p, ch: chs[0], alts: chs.length - 1, score: s });
    }
  } else {                                        // fallback: whatever the guide has already fetched
    const byId = new Map(S.items.live.map(i => [i.id, i]));
    for (const [id, c] of epgCache) { const ch = byId.get(id); if (!ch || !ok(ch)) continue; for (const p of c.list) if (p.en > now) { const s = score(p); if (s) add(p, ch, s); } }
  }
  // best matches first (whole search in the title, live coverage); then on now, then by start time
  return hits.sort((a, b) => (b.score - a.score) || ((a.st > now) - (b.st > now)) || (a.st - b.st)).slice(0, 200);
}
function progListHtml(progs) {
  const now = Date.now() / 1000;
  const day = t => { const d = new Date(t * 1000), td = new Date(); const diff = Math.round((new Date(d.toDateString()) - new Date(td.toDateString())) / 86400000);
    return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); };
  let h = `<li class="sec-head">On TV</li>`;
  if (!progs.length) {
    return h + `<li class="loading">${xmltvState === 'loading' || scanBusy ? 'Searching the programme guide…' : xmltvState === 'failed' ? 'Couldn’t download the programme guide from your provider, so only channel names were searched.' : 'No programmes on now or coming up match.'}</li>`;
  }
  const cut = S.allProgs ? progs.length : 8;
  return h + progs.slice(0, cut).map((p, k) => {
    const live = p.st <= now && now < p.en;
    return `<li class="prog${live ? ' live' : ''}" data-prog="${k}" title="${esc(p.desc || p.title)}">
      <span class="pt">${live ? '<b>On now</b>' : `${day(p.st)}<br><b class="st">${hhmm(p.st)}</b>`}<br>${live ? `<span class="cd" data-left="${p.en}">${leftText(p.en)}</span>` : `<span class="cd" data-st="${p.st}" data-en="${p.en}">${countdown(p.st, p.en)}</span>`}</span>
      <span class="pb"><span class="pn">${p.live !== undefined ? (isLiveProg(p) ? '<em class="tag live">LIVE</em>' : NOT_LIVE_RX.test(p.title + ' ' + p.desc.slice(0, 60)) || p.rerun ? '<em class="tag">REPEAT</em>' : '') : ''}${esc(p.title)}</span><span class="pc">${esc(p.ch.name)}${p.alts ? ` <i>+${p.alts}</i>` : ''} · ${hhmm(p.st)}–${hhmm(p.en)}</span></span></li>`;
  }).join('') + (progs.length > cut ? `<li class="more" data-allprogs="1">Show all ${progs.length} programmes</li>` : '');
}

/* ---------- Start times: countdowns, event channels, helper box ---------- */
function countdown(st, en) {
  const now = Date.now() / 1000;
  if (en && now >= en) return 'finished';
  if (now >= st) return en ? 'on now' : 'started';
  const m = Math.round((st - now) / 60);
  if (m < 1) return 'starting';
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `in ${h}h ${String(m % 60).padStart(2, '0')}m` : `in ${Math.round(h / 24)} ${Math.round(h / 24) === 1 ? 'day' : 'days'}`;
}
function dayName(t) {
  const d = new Date(t * 1000), diff = Math.round((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
const whenLong = t => `${dayName(t)} ${hhmm(t)}`;
// keep every countdown on screen ticking
const leftText = en => { const c = countdown(en); return c.startsWith('in ') ? c.slice(3) + ' left' : 'finished'; };
setInterval(() => {
  document.querySelectorAll('.cd[data-st]').forEach(e => { e.textContent = countdown(+e.dataset.st, +e.dataset.en || 0); });
  document.querySelectorAll('.cd[data-left]').forEach(e => { e.textContent = leftText(+e.dataset.left); });
}, 20000);

// event channels often carry the kick-off in their name: "EPL 03: Arsenal v Burnley @ 20:00 UK", "UFC 310 (8pm ET) 12/07"
const TZ = { uk: 'Europe/London', bst: 'Europe/London', gmt: 'UTC', utc: 'UTC', et: 'America/New_York', est: 'America/New_York', edt: 'America/New_York',
  ct: 'America/Chicago', cst: 'America/Chicago', pt: 'America/Los_Angeles', pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', cet: 'Europe/Berlin', cest: 'Europe/Berlin' };
function zoneTime(y, mo, d, h, mi, tz) {        // wall-clock time in a zone → unix seconds
  const guess = Date.UTC(y, mo, d, h, mi) / 1000;
  if (!tz) return new Date(y, mo, d, h, mi).getTime() / 1000;   // no zone given → your PC's time
  const off = t => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(t * 1000)).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute) / 1000 - t; };
  let t = guess - off(guess); t = guess - off(t); return t;
}
const evCache = new Map();
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// pull the date/time out of an event channel name: "Liverpool v Arsenal @ Nov 1 10:30 AM :Peacock Event 02"
function eventParts(name) {
  if (!name) return null;
  const hit = evCache.get(name); if (hit) return hit.p;
  let p = null;
  const mon = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?/i.exec(name);
  const num = mon ? null : /\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/.exec(name);
  const rest = name.replace(mon ? mon[0] : num ? num[0] : '\u0000', ' ');
  // needs minutes or am/pm, so "Sky Sports 1" isn't read as 1 o'clock
  const m = /(?:^|[^\d:])(2[0-3]|[01]?\d)(?:[:.h]([0-5]\d)\s*(am|pm)?|\s*(am|pm))(?![\d])\s*(uk|bst|gmt|utc|et|est|edt|ct|cst|pt|pst|pdt|cet|cest)?\b/i.exec(rest);
  if (m) {
    let h = +m[1]; const mi = +(m[2] || 0), ap = (m[3] || m[4] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    const tz = TZ[(m[5] || '').toLowerCase()] || '';
    const now = new Date(); let y = now.getFullYear(), mo = now.getMonth(), d = now.getDate(), dated = false;
    if (mon) { mo = MONTHS[mon[1].toLowerCase()]; d = +mon[2]; if (mon[3]) y = +mon[3]; else if (mo - now.getMonth() > 6) y--; else if (now.getMonth() - mo > 6) y++; dated = true; }
    else if (num) {                               // day/month, or month/day for US-style names
      let a1 = +num[1], b1 = +num[2]; if ((/^America/.test(tz) || ap) && a1 <= 12) [a1, b1] = [b1, a1];
      if (b1 >= 1 && b1 <= 12 && a1 >= 1 && a1 <= 31) { d = a1; mo = b1 - 1; dated = true; if (num[3]) y = +num[3] < 100 ? 2000 + +num[3] : +num[3]; }
    }
    p = { y, mo, d, h, mi, tz, ampm: !!ap, dated };
  }
  evCache.set(name, { p });
  return p;
}
// start time of an event channel. Without a zone in the name, AM/PM names are US-style feeds (Eastern time);
// pass `near` (a known kick-off) to pick whichever zone makes the time land just before it.
function eventTime(name, near) {
  const p = eventParts(name); if (!p) return 0;
  const at = tz => { let t = zoneTime(p.y, p.mo, p.d, p.h, p.mi, tz); if (!p.dated && Date.now() / 1000 - t > 12 * 3600) t += 86400; return t; };
  if (!p.tz && near) {
    for (const tz of ['Europe/London', 'America/New_York', 'Europe/Berlin', 'America/Chicago', 'America/Los_Angeles']) {
      const t = at(tz); if (near - t >= -15 * 60 && near - t <= 4 * 3600) return t;
    }
  }
  const t = at(p.tz || (p.ampm ? 'America/New_York' : ''));
  if (!near && Date.now() / 1000 - t > 5 * 3600) return 0;       // long finished – don't badge it
  return t;
}

/* ---------- Events: what's on, when it starts, where to watch (football, rugby, cricket, UFC) ----------
   Official start times come from ESPN's public schedules; anything ESPN doesn't cover (cricket, smaller
   events) is built from your provider's own data: event-channel names and the programme guide. */
const SCHED = [
  ...['eng.1', 'eng.2', 'eng.fa', 'eng.league_cup', 'sco.1', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'esp.1', 'ger.1',
      'ita.1', 'fra.1', 'uefa.nations', 'fifa.worldq.uefa', 'fifa.world', 'eng.w.1', 'fifa.friendly'].map(l => ({ path: 'soccer/' + l, sport: 'Football' })),
  ...['267979', '180659', '270557', '271937', '272073', '164205', '289234', '270559', '242041'].map(l => ({ path: 'rugby/' + l, sport: 'Rugby' })),
  { path: 'mma/ufc', sport: 'UFC' }
];
const COMP_NAMES = ['Premier League', 'Championship', 'FA Cup', 'Carabao Cup', 'EFL Cup', 'League One', 'League Two', 'Champions League', 'Europa League',
  'Conference League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Scottish Premiership', 'SPFL', 'Nations League', 'World Cup', 'WSL', "Women's Super League", 'MLS',
  'Six Nations', 'Premiership Rugby', 'Gallagher Premiership', 'URC', 'United Rugby Championship', 'Top 14', 'Champions Cup', 'Challenge Cup', 'Autumn Nations Series',
  'Rugby Championship', 'Super Rugby', 'Super League', 'Rugby World Cup',
  'Test Match', 'Test', 'ODI', 'One-Day International', 'T20 World Cup', 'T20I', 'T20', 'IPL', 'The Hundred', 'Big Bash', 'County Championship', 'Ashes', 'Vitality Blast',
  'UFC Fight Night', 'UFC'];
const SPORT_RX = [
  ['UFC', /\bufc\b|\bmma\b/],
  ['Athletics', /marathon|athletics|diamond league|track and field|\bparkrun\b|great north run|cross country/],
  ['Cricket', /cricket|\btest match|\bodi\b|\bt20|\bipl\b|the hundred|\bashes\b|big bash|county championship|vitality blast|\bfirst ball\b/],
  ['Rugby', /rugby|six nations|gallagher|\burc\b|top 14|champions cup|super rugby|autumn nations|\bsuper league\b|challenge cup/],
  ['Boxing', /boxing|fight night|heavyweight/],
  ['Motorsport', /\bf1\b|formula (1|one|e)|grand prix|motogp|indycar|nascar|\bbtcc\b|le mans|\bwrc\b/],
  ['Golf', /\bgolf\b|\bpga\b|ryder cup|dp world tour|the masters|open championship/],
  ['Tennis', /tennis|\batp\b|\bwta\b|wimbledon|roland garros|davis cup/],
  ['Darts', /\bdarts\b|\bpdc\b/], ['Snooker', /snooker/], ['Cycling', /cycling|tour de france|\bgiro\b|vuelta/],
  ['NFL', /\bnfl\b|american football|super bowl/], ['Horse racing', /horse racing|racecourse|cheltenham|ascot|aintree/],
  ['Football', /football|soccer|premier league|\bepl\b|championship|fa cup|carabao|\befl\b|champions league|europa|la liga|serie a|bundesliga|ligue 1|spfl|\bwsl\b|\bmls\b|futbol/]
];
const START_WORD = { Football: 'Kick-off', Rugby: 'Kick-off', Cricket: 'Play starts', UFC: 'Starts' };
let sched = null, schedAt = 0, schedP = null, schedState = '';
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
function loadSched() {
  if (sched && Date.now() - schedAt < 20 * 60000) return Promise.resolve(sched);
  if (schedP) return schedP;
  schedState = 'loading';
  const from = ymd(new Date(Date.now() - 86400000)), to = ymd(new Date(Date.now() + 8 * 86400000));
  schedP = Promise.all(SCHED.map(s => fetch(`https://site.api.espn.com/apis/site/v2/sports/${s.path}/scoreboard?dates=${from}-${to}&limit=300`)
    .then(r => r.ok ? r.json() : null).catch(() => null).then(d => {
      if (!d) return [];
      const comp = (d.leagues?.[0]?.name || '').replace(/^(English|Spanish|German|Italian|French) /, '');
      return (d.events || []).map(e => {
        const c = e.competitions?.[0] || {}, cs = c.competitors || [];
        const base = { src: 'espn', sport: s.sport, comp: s.sport === 'UFC' ? 'UFC' : comp, start: Date.parse(e.date) / 1000,
          state: e.status?.type?.state || 'pre', detail: e.status?.type?.shortDetail || '' };
        if (s.sport === 'UFC') {                    // one "event" = a fight card; headline from the name ("UFC 310: Pantoja vs. Asakura")
          const [code, main = ''] = String(e.name || '').split(/:\s*/);
          const [fa = '', fb = ''] = main.split(/\s+vs?\.?\s+/i);
          const names = (e.competitions || []).flatMap(x => (x.competitors || []).map(y => y.athlete?.displayName || '')).filter(Boolean);
          if (!fa || !fb) return null;
          return { ...base, comp: code.trim() || 'UFC', title: main || e.name, code: norm(code), a: { name: fa, keys: [norm(fa).split(' ').pop()] }, b: { name: fb, keys: [norm(fb).split(' ').pop()] },
            words: norm([e.name, ...names].join(' ')), last: Math.max(base.start, ...(e.competitions || []).map(x => Date.parse(x.date) / 1000 || 0)) };
        }
        const home = cs.find(x => x.homeAway === 'home') || cs[0], away = cs.find(x => x.homeAway === 'away') || cs[1];
        if (!home || !away) return null;
        const team = x => { const t = { name: x.team?.shortDisplayName || x.team?.displayName || '', full: x.team?.displayName || '', score: x.score }; t.keys = teamKeys(t); return t; };
        const a = team(home), b = team(away);
        return { ...base, title: `${a.name} v ${b.name}`, a, b, words: [norm(comp), norm(s.sport), ...a.keys, ...b.keys].join(' | ') };
      }).filter(Boolean);
    })))
    .then(all => { sched = all.flat(); schedAt = Date.now(); schedState = sched.length ? 'ok' : 'failed';
      window.native?.log?.(`schedules: ${sched.length} events from ESPN`); return sched; })
    .finally(() => { schedP = null; });
  return schedP;
}
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
const ALIAS = { 'manchester united': ['man utd', 'man united', 'man u'], 'manchester city': ['man city'], 'tottenham hotspur': ['spurs', 'tottenham'],
  'wolverhampton wanderers': ['wolves'], 'nottingham forest': ['nottm forest', 'nott m forest', 'forest'], 'brighton & hove albion': ['brighton'],
  'west ham united': ['west ham'], 'newcastle united': ['newcastle'], 'leeds united': ['leeds'], 'afc bournemouth': ['bournemouth'],
  'paris saint germain': ['psg', 'paris sg'], 'internazionale': ['inter milan', 'inter'], 'bayern munich': ['bayern'], 'borussia dortmund': ['dortmund', 'bvb'],
  'atletico madrid': ['atletico', 'atleti'], 'sheffield united': ['sheff utd', 'sheffield utd'], 'queens park rangers': ['qpr'], 'west bromwich albion': ['west brom'],
  'south africa': ['proteas', 'springboks', 'sa'], 'new zealand': ['all blacks', 'black caps', 'blackcaps', 'nz'], 'australia': ['wallabies', 'aus'],
  'west indies': ['windies', 'wi'], 'england': ['eng'], 'india': ['ind'], 'pakistan': ['pak'], 'sri lanka': ['sl'], 'argentina': ['pumas'] };
const ALIAS_BACK = Object.fromEntries(Object.entries(ALIAS).flatMap(([k, v]) => v.map(a => [a, k])));
function teamKeys(t) {
  const k = new Set([norm(t.name), norm(t.full)]);
  const f = ALIAS_BACK[norm(t.full)] || norm(t.full); k.add(f); (ALIAS[f] || []).forEach(a => a.length >= 3 && k.add(a));
  const trimmed = f.replace(/^(afc|fc) /, '').replace(/ (fc|afc|rfc|ccc)$/, '');
  k.add(trimmed);
  if (!/^(manchester|sheffield|west|bristol|real|athletic|inter|south|new|sri)\b/.test(trimmed)) k.add(trimmed.replace(/ (united|city|hotspur|wanderers|albion|rovers|athletic|town|county|rugby)$/, ''));
  return [...k].filter(x => x.length >= 3);
}
const mentionRx = new Map();
const mentions = (txt, keys) => keys.some(k => { if (!k) return false; let rx = mentionRx.get(k); if (!rx) { rx = new RegExp(`(^|[^a-z])${k.replace(/[&]/g, '\\$&')}([^a-z]|$)`); if (mentionRx.size > 2000) mentionRx.clear(); mentionRx.set(k, rx); } return rx.test(txt); });
const STOP = new Set(['v', 'vs', 'versus', 'fc', 'afc', 'and', 'the', 'live', 'match', 'game', 'tonight', 'today']);
const sportOf = txt => (SPORT_RX.find(([, rx]) => rx.test(txt)) || [''])[0];
const compOf = txt => { const t = ' ' + txt.toLowerCase() + ' '; return COMP_NAMES.find(c => new RegExp(`[^a-z]${c.toLowerCase().replace(/[-']/g, '.')}[^a-z]`).test(t)) || ''; };

// replays, highlights, classics etc. are never "the match"
const NOT_LIVE_RX = /\b(highlights?|replay|repeat|classic|classics|rewind|review|preview|build.?up|reaction|magazine|best of|greatest|archive|documentary|recap|delayed|encore|re.?run|from (?:earlier|yesterday))\b|\(r\)/i;
const isLiveProg = p => (p.live || /\blive\b/i.test(p.title)) && !NOT_LIVE_RX.test(p.title) && !(p.rerun && !/\blive\b/i.test(p.title));
// "Live: England v South Africa – 2nd Test" → ['England', 'South Africa']
function splitVs(s) {
  const m = /(^|.*?[:|•@\-–(\[]\s*|^live\s+)([^:|•@\-–(\[]{2,40}?)\s+(?:v|vs\.?|versus)\s+([^:|•@\-–()\[\],.]{2,40})/i.exec(String(s || ''));
  if (!m) return null;
  const clean = x => x.replace(/^(live|epl|nfl|ufc|mlb|nba|nhl|ppv|event|ko)\b[\s:]*/i, '').replace(/^\d+\s*/, '')
    .replace(/\s+(live|kick.?off|ko|at|in|on|from|day|first|\d+(st|nd|rd|th)|test|odi|t20i?|highlights|preview|replay|\d{1,2}[:.]\d{2}.*|\d{1,2}\s*(am|pm).*)$/i, '').trim();
  let a = clean(m[2]), b = clean(m[3]);
  b = b.split(/\s+(?=(?:live|kick|ko|at|day|first|test|odi|t20|in|from|\d))/i)[0].trim();
  if (a.length < 2 || b.length < 2 || /^(the|a)$/i.test(a)) return null;
  return [a, b];
}
// "(Kick-off 4.30pm)", "first ball 10.30am", "Main card from 3am" → unix time on the programme's day
function startFromText(txt, p) {
  const m = /\b(?:kick[\s-]?off|k\.?o\.?|first ball|play (?:starts|begins)|main card|prelims|starts? at)\b[^0-9]{0,14}(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?/i.exec(txt);
  if (!m) return 0;
  let h = +m[1]; const mi = +(m[2] || 0), ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
  if (!ap && h < 9) h += 12;                      // "kick-off 4.30" means the afternoon
  const d = new Date(p.st * 1000); let t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi).getTime() / 1000;
  if (t < p.st - 3600) t += 86400;
  return t >= p.st - 3600 && t <= p.en + 3600 ? t : 0;
}

const evSearchCache = new Map();
let evLast = { k: '', res: null };
const evStamp = q => q + '|' + xmltvAt + '|' + !!scanBusy + '|' + xmltvState + '|' + (sched?.length ?? -1) + '|' + S.items.live.length;
const evPeek = q => evLast.k === evStamp(q) ? evLast.res : null;
function eventSearch(q) {
  const ck = q + '|' + xmltvAt + '|' + (sched?.length ?? -1) + '|' + S.items.live.length + '|' + Math.floor(Date.now() / 60000);
  if (evSearchCache.has(ck)) return evSearchCache.get(ck);
  const res = eventSearchRun(q);
  evLast = { k: evStamp(q), res };
  if (evSearchCache.size > 20) evSearchCache.clear();
  if (!(xmltvState === 'loading' || scanBusy || (!sched && schedState !== 'failed'))) evSearchCache.set(ck, res);
  return res;
}
function eventSearchRun(q) {
  const want = q;
  const again = () => { if ($('#itemSearch').value.toLowerCase() === want) renderItems(); };
  if (!sched && schedState !== 'failed') loadSched().then(again);
  buildVocab();
  const sq = smartQuery(q); if (sq.empty) return [];
  const hit = txt => sq.test(txt);
  const now = Date.now() / 1000, hidden = S.settings.hideAdult ? new Set(S.cats.live.filter(c => adultRx.test(c.name)).map(c => c.id)) : null;
  const okCh = ch => !(hidden && hidden.has(ch.cat));
  const haveGuide = xmltv && xmltvFor === S.profile.id;
  const byEpg = haveGuide ? epgIndex() : new Map();

  // 1. official schedule
  const events = (sched || []).filter(e => e.state !== 'post' && (e.last || e.start) > now - 4 * 3600 && hit(e.words))
    .map(e => ({ ...e, where: [] }));
  // where to watch an official event: every channel named after it, and every live programme covering it
  const coversText = (e, txt) => (e.code && /\bufc\b/.test(txt) && txt.includes(e.code)) || (mentions(txt, e.a.keys) && mentions(txt, e.b.keys));
  events.sort((x, y) => x.start - y.start);
  for (const e of events.slice(0, 10)) {
    for (const ch of S.items.live) {
      if (!okCh(ch)) continue;
      const n = chNorm(ch); if (!coversText(e, n)) continue;
      const p = eventParts(ch.name);
      if (p?.dated && Math.abs(zoneTime(p.y, p.mo, p.d, 12, 0, '') - e.start) > 2 * 86400) continue;   // another meeting of the same sides
      e.where.push({ ch, from: eventTime(ch.name, e.start) || 0 });
    }
    if (!haveGuide) continue;
    const from = e.start - (e.sport === 'UFC' ? 3600 : -15 * 60), to = (e.last || e.start) + (e.sport === 'UFC' ? 3600 : 20 * 60);
    for (const p of xmltv) {
      if (p.st > from || p.en < to) continue;                 // must be on air across the start
      if (NOT_LIVE_RX.test(p.title) || (p.rerun && !p.live)) continue;
      const chs = byEpg.get(p.epg); if (!chs) continue;
      if (!coversText(e, p._nd ?? (p._nd = norm(p.title + ' ' + p.desc)))) continue;
      e.where.push({ ch: chs[0], alts: chs.length - 1, from: p.st, title: p.title });
    }
  }
  // 2. provider data: event channels + guide programmes that match the search and name two sides
  const cands = [];
  for (const ch of S.items.live) {
    if (!okCh(ch)) continue;
    const n = chNorm(ch); if (!hit(n)) continue;
    const vs = splitVs(ch.name); if (!vs) continue;
    cands.push({ kind: 'event', ch, vs, text: n + ' ' + n, raw: ch.name });
  }
  if (haveGuide) {
    let c = 0;
    for (const [p] of guideScan(q)) {
      const txt = p._nd ?? (p._nd = norm(p.title + ' ' + p.desc));
      const chs = byEpg.get(p.epg); if (!chs || NOT_LIVE_RX.test(p.title) || (p.rerun && !p.live)) continue;
      let vs = splitVs(p.title); if (!vs) for (const s of p.desc.split(/(?<=[.!?])\s/).slice(0, 3)) if ((vs = splitVs(s))) break;
      cands.push({ kind: 'guide', live: isLiveProg(p), p, ch: chs[0], alts: chs.length - 1, vs, text: txt + ' ' + chNorm(chs[0]), raw: p.title + ' ' + p.desc });
      if (++c > 600) break;
    }
  }
  // attach each candidate to an official event, or group it into a provider-built one
  const covers = (e, c) => {
    if (e.code && /\bufc\b/.test(c.text) && (c.text.includes(e.code) || (mentions(c.text, e.a.keys) && mentions(c.text, e.b.keys)))) return true;
    return mentions(c.text, e.a.keys) && mentions(c.text, e.b.keys);
  };
  const own = [];
  for (const c of cands) {
    const sport = sportOf(c.text + ' ' + chNorm(c.ch));
    let tv = c.kind === 'event' ? eventTime(c.ch.name) : c.p.st, until = c.kind === 'guide' ? c.p.en : 0;
    let e = events.find(e => covers(e, c) && (!tv || Math.abs(tv - e.start) < 8 * 3600) && (!until || until > e.start));
    if (e) {
      if (c.kind === 'event') tv = eventTime(c.ch.name, e.start) || tv;
      if (c.kind === 'guide' && !(c.p.st <= e.start + 15 * 60 && c.p.en >= e.start + 20 * 60) && e.sport !== 'UFC') { if (c.p.en < e.start || c.p.st > e.start + 3 * 3600) continue; }
      e.where.push({ ch: c.ch, alts: c.alts, from: tv, title: c.kind === 'guide' ? c.p.title : '' });
      continue;
    }
    if (!c.vs && c.kind === 'guide' && c.live && sport) {          // live sport without two sides: a marathon, a race, a golf round…
      const t = c.p.title.replace(/^\s*live\s*[:\-–]?\s*/i, '').trim() || c.p.title, k = nrm(t);
      let s1 = own.find(o => o.single && o.key === k && Math.abs(o.tvFirst - c.p.st) < 12 * 3600);
      if (!s1) { s1 = { src: 'tv', single: t, key: k, sport, comp: compOf(c.raw + ' ' + c.ch.name), a: { name: t, keys: [] }, b: { name: '', keys: [] }, title: t, start: 0, tvFirst: c.p.st, where: [] }; own.push(s1); }
      if (c.p.st < s1.tvFirst) s1.tvFirst = c.p.st;
      const st1 = startFromText(c.raw, c.p); if (st1 && !s1.start) s1.start = st1;
      s1.where.push({ ch: c.ch, alts: c.alts, from: c.p.st, to: c.p.en, title: c.p.title });
      continue;
    }
    if (!c.vs || !sport || (c.kind === 'guide' && !c.live)) continue;   // a card of its own needs live coverage, not a repeat
    const keysA = teamKeys({ name: c.vs[0], full: c.vs[0] }), keysB = teamKeys({ name: c.vs[1], full: c.vs[1] });
    const start = c.kind === 'guide' ? startFromText(c.raw, c.p) : 0;
    e = own.find(o => o.sport === sport && ((mentions(c.text, o.a.keys) && mentions(c.text, o.b.keys)) || (mentions(o._abn ?? (o._abn = norm(o.a.name + ' ' + o.b.name)), keysA) && mentions(o._abn, keysB)))
      && Math.abs((tv || 0) - (o.tvFirst || tv || 0)) < (sport === 'Cricket' ? 6 * 86400 : 12 * 3600));
    if (!e) { e = { src: 'tv', sport, comp: '', a: { name: c.vs[0], keys: keysA }, b: { name: c.vs[1], keys: keysB }, title: `${c.vs[0]} v ${c.vs[1]}`, start: 0, tvFirst: tv, where: [] }; own.push(e); }
    e.comp = e.comp || compOf(c.raw + ' ' + c.ch.name);
    if (start && (!e.start || (start < e.start && start > now - 8 * 3600))) e.start = start;
    if (tv && (!e.tvFirst || tv < e.tvFirst)) e.tvFirst = tv;
    e.where.push({ ch: c.ch, alts: c.alts, from: tv, to: until, title: c.kind === 'guide' ? c.p.title : '' });
  }
  for (const o of own) { o.state = o.start && o.start <= now ? 'in' : (!o.start && o.tvFirst && o.tvFirst <= now ? 'tvon' : 'pre'); }
  const all = [...events, ...own.filter(o => o.where.length)];
  for (const e of all) {                          // one row per channel, earliest TV start first
    const seen = new Set();
    e.where = e.where.sort((x, y) => (x.from || 9e12) - (y.from || 9e12)).filter(w => { const k = w.ch.epgId || w.ch.id; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
    e.when = e.start || e.tvFirst || 0;
  }
  // on now first, then soonest; events you can actually watch ahead of ones you can't
  return all.filter(e => e.when > now - 6 * 3600 && e.when < now + 8 * 86400)
    .sort((x, y) => (!x.where.length - !y.where.length) || ((x.state === 'in' || x.state === 'tvon' ? 0 : 1) - (y.state === 'in' || y.state === 'tvon' ? 0 : 1)) || x.when - y.when)
    .slice(0, 6);
}

function eventsHtml(evs) {
  S.fixView = evs;
  const now = Date.now() / 1000;
  return `<li class="ev-head">Matches &amp; events</li>` + evs.map((e, fi) => {
    const live = e.state === 'in', word = START_WORD[e.sport] || 'Starts';
    const badge = live ? `<span class="ev-badge live">LIVE${e.src === 'espn' && e.a.score != null && e.sport !== 'UFC' ? ` ${esc(e.a.score)}–${esc(e.b.score)}` : ''}</span>`
      : e.start ? `<span class="ev-badge cd" data-st="${e.start}">${countdown(e.start)}</span>` : '';
    const big = e.start
      ? `<div class="ev-ko"><span class="ev-kow">${word}</span><span class="ev-kot">${hhmm(e.start)}</span><span class="ev-kod">${esc(dayName(e.start))}${live && e.detail ? ' · ' + esc(e.detail) : ''}</span></div>`
      : `<div class="ev-ko"><span class="ev-kow">On TV from</span><span class="ev-kot">${e.tvFirst ? hhmm(e.tvFirst) : '–'}</span><span class="ev-kod">${e.tvFirst ? esc(dayName(e.tvFirst)) : ''} · ${e.sport === 'Football' || e.sport === 'Rugby' ? 'kick-off' : 'start'} time not listed</span></div>`;
    const rows = e.where.length ? e.where.map((w, wi) => `<div class="ev-row" data-fx="${fi}:${wi}" title="Watch ${esc(w.ch.name)}">
        <span class="ev-play">▶</span>
        <span class="ev-ch">${w.ch.icon ? `<img src="${esc(w.ch.icon)}" onerror="this.style.visibility='hidden'">` : '<i></i>'}<span class="ev-cn">${esc(w.ch.name)}${w.alts ? ` <em>+${w.alts} more</em>` : ''}${w.title ? `<small>${esc(w.title)}</small>` : ''}</span></span>
        <span class="ev-from">${w.from ? `<small>TV from</small><b>${hhmm(w.from)}</b>` : '<small>time not<br>listed</small>'}</span></div>`).join('')
      : `<div class="ev-none">Not on any of your channels yet – event channels usually appear on the day.</div>`;
    return `<li class="ev-card${live ? ' is-live' : ''}">
      <div class="ev-top"><span class="ev-sport">${esc(e.sport)}${e.comp && e.comp !== e.sport ? ' · ' + esc(e.comp) : ''}</span>${badge}</div>
      <div class="ev-title">${e.single ? esc(e.single) : `${esc(e.a.name)} <span>v</span> ${esc(e.b.name)}`}</div>${big}
      <div class="ev-where">${rows}</div></li>`;
  }).join('');
}

// a programme picked from search: on now → watch it; later → show when it starts
function openProg(p) {
  const now = Date.now() / 1000, ch = { ...p.ch, kind: 'live' };
  if (p.st <= now && now < p.en) { openItem(ch); return; }
  $('#detail').innerHTML = `<div class="progbox">
    <div class="pb-when"><b>${hhmm(p.st)}</b><span>${dayName(p.st)}</span></div>
    <div class="pb-main"><h3>${esc(p.title)}</h3>
      <div class="dim">${esc(p.ch.name)} · ${hhmm(p.st)}–${hhmm(p.en)} · <span class="cd" data-st="${p.st}" data-en="${p.en}">${countdown(p.st, p.en)}</span></div>
      ${p.desc ? `<p>${esc(p.desc)}</p>` : ''}
      <button class="ghost" id="pbWatch">Watch ${esc(p.ch.name)} now</button></div></div>`;
  $('#pbWatch').onclick = () => openItem(ch);
}

/* ---------- TV guide ---------- */
const PPM = PHONE ? 4 : 5, G_HOURS = 24;                     // px per minute, hours shown
const CH_KEY = PHONE ? 'guideChP' : 'guideCh';        // the phone keeps its own width
let CH = store.get(CH_KEY, PHONE ? 230 : 260);              // channel-name column width (drag its edge to change)
document.documentElement.style.setProperty('--gch', CH + 'px');
const epgCache = new Map();                      // stream id -> { at, list }
let gStart = 0, gObs = null, gClock = null, gQueue = [], gActive = 0;
const p2 = n => (n < 10 ? '0' : '') + n;
const hhmm = t => { const d = new Date(t * 1000); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };   // (toLocaleTimeString is very slow on a Fire Stick)
const gx = t => CH + (t - gStart) / 60 * PPM;
function stopGuideClock() { clearInterval(gClock); gClock = null; }

function renderGuide() {
  const box = $('#gInner'), scroller = $('#gScroll');
  if (S.profile.type !== 'xtream') { box.innerHTML = '<p class="loading">The TV guide needs an Xtream Codes login (M3U links don’t include programme data).</p>'; return; }
  const now = Date.now() / 1000;
  gStart = Math.floor(now / 1800) * 1800 - 3600;             // from an hour ago
  const W = CH + G_HOURS * 60 * PPM, rows = S.view.slice(0, S.shown);
  let head = `<div class="g-head" style="width:${W}px"><div class="g-corner">${new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}<div class="g-chresize" title="Drag to widen channel names · double-click to reset"></div></div>`;
  for (let t = gStart; t < gStart + G_HOURS * 3600; t += 1800) head += `<div class="g-tick" style="left:${gx(t)}px">${hhmm(t)}</div>`;
  head += '</div>';
  const body = rows.map((c, i) => `<div class="g-row${S.current?.kind === 'live' && S.current.id === c.id ? ' on' : ''}" data-i="${i}" style="width:${W}px">
      <div class="g-ch" data-play="${i}" title="Watch ${esc(c.name)}">${c.icon ? `<img src="${esc(c.icon)}" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="g-noimg"></span>'}<span class="g-num">${esc(c.num ?? '')}</span><span class="g-name">${esc(c.name)}</span></div>
      <div class="g-progs"><span class="g-empty" style="left:${CH + 8}px">Loading…</span></div></div>`).join('');
  const more = S.view.length > S.shown ? `<button class="ghost g-more" data-more="1">Show more channels (${(S.view.length - S.shown).toLocaleString('en-GB')} left)</button>` : '';
  box.style.width = W + 'px';
  box.innerHTML = head + body + `<div class="g-now" id="gNowLine"></div>` + more + (rows.length ? '' : '<p class="loading">No channels in this category.</p>');
  $('#gInfo').innerHTML = '<span class="dim">Click a programme for details · click a channel name (or anything on now) to watch</span>';
  placeNowLine();
  scroller.scrollLeft = Math.max(0, gx(now) - CH - 90 * PPM / 3);
  scroller.scrollTop = 0;
  // fetch listings only for rows that scroll into view
  gObs?.disconnect(); gQueue = [];
  gObs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { gObs.unobserve(e.target); queueRow(e.target); } }), { root: scroller, rootMargin: '300px 0px' });
  box.querySelectorAll('.g-row').forEach(r => gObs.observe(r));
  stopGuideClock(); gClock = setInterval(() => { placeNowLine(); markLive(); }, 30000);
}
// a programme that started off to the left keeps its title in view, just right of the channel column
let gTitleRaf = 0;
// Titles only depend on the horizontal position, so scrolling up/down costs nothing; new rows are fixed as they load.
// Programme positions come from their inline style (no layout reads), which keeps fast scrolling smooth on slow boxes.
let gTitleLeft = -1;
function fixRowTitles(row, edge) {
  for (const p of row.querySelectorAll('.g-prog')) {
    const l = parseFloat(p.style.left) || 0, w = parseFloat(p.style.width) || 0;
    const pad = l < edge && l + w > edge + 40 ? Math.min(edge - l + 8, w - 40) : 0;
    if ((p._pad || 0) !== pad) { p.style.paddingLeft = pad ? pad + 'px' : ''; p._pad = pad; }
  }
}
function fixGuideTitles(force) {
  gTitleRaf = 0;
  const sc = $('#gScroll'); if (!sc) return;
  if (!force && sc.scrollLeft === gTitleLeft) return;
  gTitleLeft = sc.scrollLeft;
  const edge = sc.scrollLeft + CH;
  for (const row of document.querySelectorAll('#gInner .g-row')) if (row._progs) fixRowTitles(row, edge);
}
const queueGuideTitles = () => { if (!gTitleRaf) gTitleRaf = requestAnimationFrame(() => fixGuideTitles(false)); };
$('#gScroll').addEventListener('scroll', queueGuideTitles, { passive: true });
function placeNowLine() { const l = $('#gNowLine'); if (l) l.style.left = gx(Date.now() / 1000) + 'px'; }
function markLive() {
  const now = Date.now() / 1000;
  document.querySelectorAll('#gInner .g-prog').forEach(p => {
    p.classList.toggle('live', +p.dataset.st <= now && now < +p.dataset.en);
    p.classList.toggle('past', +p.dataset.en <= now);
  });
}
function queueRow(row) { gQueue.push(row); pumpQueue(); }
function pumpQueue() {
  while (gActive < 5 && gQueue.length) {
    const row = gQueue.shift();
    if (!row.isConnected) continue;
    const sc = $('#gScroll'), r = row.getBoundingClientRect(), s = sc.getBoundingClientRect();
    if (r.bottom < s.top - 600 || r.top > s.bottom + 600) { gObs?.observe(row); continue; }   // flew past it: fetch when it comes back
    gActive++;
    loadRow(row).finally(() => { gActive--; pumpQueue(); });
  }
}
async function fetchEpg(id) {
  const c = epgCache.get(id);
  if (c && Date.now() - c.at < 30 * 60000) return c.list;
  let list = [];
  try { list = (await api('get_simple_data_table', `&stream_id=${id}`)).epg_listings || []; } catch {}
  if (!list.length) { try { list = (await api('get_short_epg', `&stream_id=${id}&limit=50`)).epg_listings || []; } catch {} }
  list = list.map(p => ({ st: +p.start_timestamp, en: +p.stop_timestamp, title: b64(p.title), desc: b64(p.description) }))
    .filter(p => p.st && p.en > p.st).sort((a, b) => a.st - b.st)
    .filter((p, i, a) => !i || p.st !== a[i - 1].st);           // drop duplicates
  epgCache.set(id, { at: Date.now(), list });
  return list;
}
async function loadRow(row) {
  const ch = S.view[row.dataset.i]; if (!ch) return;
  const list = await fetchEpg(ch.id);
  if (!row.isConnected) return;
  const gEnd = gStart + G_HOURS * 3600, now = Date.now() / 1000;
  const progs = list.filter(p => p.en > gStart && p.st < gEnd), gq = $('#itemSearch').value.toLowerCase();
  row.querySelector('.g-progs').innerHTML = progs.length ? progs.map((p, j) => {
    const a = Math.max(p.st, gStart), b = Math.min(p.en, gEnd);
    const cls = (p.st <= now && now < p.en ? ' live' : p.en <= now ? ' past' : '') + (gq.length >= 3 && (p.title + ' ' + p.desc).toLowerCase().includes(gq) ? ' hit' : '');
    return `<div class="g-prog${cls}" data-st="${p.st}" data-en="${p.en}" data-j="${j}" style="left:${gx(a)}px;width:${Math.max(4, (b - a) / 60 * PPM - 3)}px" title="${hhmm(p.st)}–${hhmm(p.en)}  ${esc(p.title)}"><b>${esc(p.title)}</b><span>${hhmm(p.st)}–${hhmm(p.en)}</span></div>`;
  }).join('') : `<span class="g-empty" style="left:${CH + 8}px">No guide data for this channel</span>`;
  row._progs = progs;
  fixRowTitles(row, $('#gScroll').scrollLeft + CH);
}
$('#gInner').onclick = e => {
  if (e.target.closest('[data-more]')) { S.shown += 200; renderGuide(); return; }
  const row = e.target.closest('.g-row'); if (!row) return;
  const ch = S.view[row.dataset.i]; if (!ch) return;
  const pe = e.target.closest('.g-prog');
  if (pe) {
    const p = row._progs[pe.dataset.j], now = Date.now() / 1000, live = p.st <= now && now < p.en;
    $('#gInfo').innerHTML = `<b>${esc(p.title)}</b> <span class="dim">${esc(ch.name)} · ${dayName(p.st)} ${hhmm(p.st)}–${hhmm(p.en)} · <span class="cd" data-st="${p.st}" data-en="${p.en}">${countdown(p.st, p.en)}</span></span>${p.desc ? `<p>${esc(p.desc)}</p>` : ''}` +
      (live ? '' : `<button class="ghost" id="gWatch">Watch ${esc(ch.name)} now</button>`);
    $('#gWatch')?.addEventListener('click', () => openItem(ch));
    if (live) openItem(ch);
    return;
  }
  if (e.target.closest('.g-ch')) openItem(ch);
};
// drag the edge of the channel column (in the guide header) to widen names
(() => {
  const set = w => { CH = Math.round(Math.min(600, Math.max(140, w))); document.documentElement.style.setProperty('--gch', CH + 'px'); };
  $('#gInner').addEventListener('pointerdown', e => {
    const h = e.target.closest('.g-chresize'); if (!h || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); h.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
    const x0 = e.clientX, w0 = CH, sl = $('#gScroll').scrollLeft, t0 = gStart + (sl / PPM) * 60;
    h.onpointermove = ev => set(w0 + ev.clientX - x0);
    h.onpointerup = h.onlostpointercapture = () => {
      h.onpointermove = h.onpointerup = h.onlostpointercapture = null; document.body.classList.remove('resizing');
      store.set(CH_KEY, CH); renderGuide(); $('#gScroll').scrollLeft = Math.max(0, (t0 - gStart) / 60 * PPM);
    };
  });
  $('#gInner').addEventListener('dblclick', e => { if (e.target.closest('.g-chresize')) { set(PHONE ? 230 : 260); store.set(CH_KEY, CH); renderGuide(); } });
})();
$('#gNow').onclick = () => { $('#gScroll').scrollTo({ left: Math.max(0, gx(Date.now() / 1000) - CH - 30 * PPM), behavior: 'smooth' }); };

/* ---------- Events ---------- */
document.querySelectorAll('.rail-btn[data-sec]').forEach(b => b.onclick = () => setSection(b.dataset.sec));
$('#catList').onclick = e => {
  const li = e.target.closest('li[data-id]'); if (!li) return;
  S.catId = li.dataset.id || null; S.shown = 200;
  document.querySelectorAll('#catList li').forEach(x => x.classList.toggle('on', x === li));
  renderItems();
};
$('#catSearch').oninput = () => { if (S.section !== 'fav' && S.section !== 'recent') renderCats(); };
let st; $('#itemSearch').oninput = () => {
  if (isSearch()) { const kind = S.searchScope || 'live'; clearTimeout(SG.t); SG.t = setTimeout(() => sgUpdate($('#itemSearch'), kind, () => { clearTimeout(st); S.shown = 200; S.allProgs = false; renderItems(); }), 60); }
  clearTimeout(st); st = setTimeout(() => {
    const sp = isSearch() && splitScope($('#itemSearch').value);
    if (sp && !(sp.bare && sp.scope === (S.searchScope || 'live'))) { applySpoken($('#itemSearch').value); return; }
    S.shown = 200; S.allProgs = false; renderItems();
  }, TV ? 600 : 250);
};
$('#itemList').onclick = e => {
  const pk = e.target.closest('[data-pick]'); if (pk) { pickScope(pk.dataset.pick); return; }
  const fr = e.target.closest('.ev-row');
  if (fr) { const [a, b] = fr.dataset.fx.split(':'); const w = S.fixView?.[a]?.where[b]; if (w) openItem({ ...w.ch, kind: 'live' }); return; }
  const li = e.target.closest('li'); if (!li || li.classList.contains('ev-card') || li.classList.contains('ev-head')) return;
  if (li.dataset.allprogs) { S.allProgs = true; keepScroll(renderItems); return; }
  if (li.dataset.more) { S.shown += 500; renderItems(); return; }
  if (li.dataset.allcats) { S.catId = null; renderCats(); renderItems(); return; }
  if (li.dataset.prog) { const p = S.progView?.[li.dataset.prog]; if (p) openProg(p); return; }
  if (li.dataset.ev) { const it = S.view[li.dataset.ev]; if (it) openItem(it); return; }
  const it = S.view[li.dataset.idx]; if (!it) return;
  // films / series from Search, Favourites or Recently watched: the details box (Resume from 45:37 / Start again, episodes)
  if ((isSearch() || S.section === 'fav' || S.section === 'recent') && (it.kind === 'movie' || it.kind === 'series') && !it.direct) { itemModal(it); return; }
  openItem(it);
};
document.querySelectorAll('#searchScope button[data-scope]').forEach(b => b.onclick = () => { setSearchScope(b.dataset.scope); if (!TV) $('#itemSearch').focus(); });
$('#btnVoice').onclick = () => startVoice();
$('#btnFav').onclick = () => { const c = S.current; if (c) toggleFav(favData(c)); };

/* right-click menu on channels / films / series */
const ctx = document.createElement('div'); ctx.className = 'ctx'; ctx.hidden = true; document.body.appendChild(ctx);
const hideCtx = () => { ctx.hidden = true; };
// pop-up menu (native on the PC, in-page on the TV); resolves with the chosen id
async function chooseMenu(e, items) {
  let a = null;
  if (window.native?.menu) { try { a = await window.native.menu(items); } catch (err) { window.native.log?.('menu: ' + err.message); } }
  else {
    ctx.innerHTML = items.map(i => `<button data-a="${i.id}">${esc(i.label)}</button>`).join('');
    ctx.hidden = false;
    ctx.style.left = Math.min(e.clientX, innerWidth - ctx.offsetWidth - 6) + 'px';
    ctx.style.top = Math.min(e.clientY, innerHeight - ctx.offsetHeight - 6) + 'px';
    a = await new Promise(res => { ctx.onclick = ev => res(ev.target.closest('button')?.dataset.a); });
    hideCtx();
  }
  return a;
}
async function catMenu(e, id) {
  e.preventDefault(); e.stopPropagation();
  const a = await chooseMenu(e, [{ id: 'favcat', label: isFavCat(id) ? 'Remove category from favourites' : '★ Add category to favourites' }, { id: 'open', label: 'Open category' }]);
  if (a === 'favcat') { toggleFavCat(id); window.AndroidBridge?.toast?.(isFavCat(id) ? '★ Category added to favourites' : 'Category removed from favourites'); }
  if (a === 'open') document.querySelector(`#catList li[data-id="${CSS.escape(id)}"]`)?.click();
}
async function itemMenu(e, it, inList) {
  e.preventDefault(); e.stopPropagation();
  const items = [];
  if (inList) items.push({ id: 'play', label: it.kind === 'live' ? 'Play' : 'Open' });
  items.push({ id: 'fav', label: isFav(it) ? 'Remove from favourites' : 'Add to favourites' });
  if (S.section === 'recent' && inList) items.push({ id: 'rec', label: 'Remove from recently watched' });
  const a = await chooseMenu(e, items);
  if (a === 'play') openItem(it);
  if (a === 'fav') toggleFav(favData(it));
  if (a === 'rec') { store.set(recKey(), store.get(recKey(), []).filter(x => !(x.kind === it.kind && x.id === it.id))); keepScroll(renderItems); }
}
// right-click a channel / film / series in the list
document.addEventListener('contextmenu', e => {
  if (!S.profile) return;
  const li = e.target.closest?.('#itemList li[data-idx]');
  if (li) { const it = S.view[+li.dataset.idx]; if (it) itemMenu(e, it, true); return; }
  const cl = e.target.closest?.('#catList li[data-id]');            // right-click a category: favourite it
  if (cl && cl.dataset.id && S.section !== 'fav' && S.section !== 'recent') { catMenu(e, cl.dataset.id); return; }
  // right-click the player or title for whatever is playing
  if (S.current && e.target.closest?.('#playerWrap, .np-head')) { const c = S.current; itemMenu(e, c.parent || c, false); }
});
document.addEventListener('pointerdown', e => { if (!ctx.contains(e.target)) hideCtx(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtx(); });
$('#itemList').addEventListener('scroll', hideCtx);
window.addEventListener('blur', hideCtx);
window.addEventListener('resize', hideCtx);
$('#btnLive').onclick = () => {
  if (hls && hls.liveSyncPosition) { video.currentTime = hls.liveSyncPosition; }
  else { const b = video.buffered; if (b.length) video.currentTime = Math.max(video.currentTime, b.end(b.length - 1) - 0.5); }
  video.playbackRate = 1; video.play().catch(() => {});
};
$('#btnFull').onclick = () => toggleFull();
$('#btnExt').onclick = async () => {
  if (!S.current?.url) return;
  const c = S.current;
  // hang up our own connection first, or the provider sees two and refuses VLC (469)
  stopPlayer(); soundWarn(''); msg('Opening in VLC…');
  await new Promise(r => setTimeout(r, c.kind === 'live' ? 1500 : 200));
  const r = await window.native.openExternal(c.url, c.title, S.settings.player);
  if (!r.ok) { msg(r.error, true); return; }
  msg(`${r.installed ? 'VLC installed. ' : ''}Playing in ${/vlc/i.test(r.player) ? 'VLC' : r.player} – pick a channel here to watch in StarkTV again.`);
};
window.native?.onPlayerStatus?.(t => msg(t));
document.addEventListener('keydown', e => {
  if (S.profile && ((e.ctrlKey && (e.key === 'f' || e.key === 'F')) || (e.key === '/' && !e.target.matches('input,select')))) {
    e.preventDefault(); if (!isSearch()) setSection('search'); else $('#itemSearch').select(); return;
  }
  if (e.target.matches('input,select')) return;
  if (e.key === 'f' || e.key === 'F') toggleFull();
  if (!TV && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'PageDown' || e.key === 'PageUp') && S.current?.kind === 'live') {
    const i = S.view.findIndex(v => v.id === S.current.id && v.kind === 'live'); if (i < 0) return;
    const n = S.view[i + (e.key === 'ArrowDown' || e.key === 'PageDown' ? 1 : -1)]; if (n) { e.preventDefault(); openItem(n); }
  }
});

/* ---------- TV remote hooks (called by the Android app) ---------- */
if (TV) {
  window.__tvZap = d => {                          // channel up/down while watching full screen
    if (S.current?.kind !== 'live') return;
    const i = S.view.findIndex(v => v.id === S.current.id && v.kind === 'live'); if (i < 0) return;
    const n = S.view[i + d]; if (n) openItem(n);
  };
  window.__tvAfterFull = () => {                   // back from full screen: put the focus on what's playing
    if (exitFilmPlay()) return;                    // a film: Back ends it and returns to Films
    const el = document.querySelector('#gInner .g-row.on .g-ch') || document.querySelector('#itemList li.on') || document.querySelector('.rail-btn.on');
    el?.focus(); el?.scrollIntoView({ block: 'center', inline: 'nearest' });
  };
  window.__tvBack = () => {
    if (window.__netKey?.('back')) return true;
    if (window.__newsKey?.('back')) return true;
    if (window.__updKey?.('back')) return true;
    const dlg = document.querySelector('dialog[open]'); if (dlg) { dlg.close(); return true; }
    if (!$('#nfModal').hidden) { closeFilmModal(); return true; }
    if (exitFilmPlay()) return true;
    if ((S.section === 'movie' || S.section === 'series') && !document.querySelector('#nf .nf-hero') && $('#nf .nf-top')) { renderBrowse(browseKind()); return true; }   // category page → back
    if (!ctx.hidden) { hideCtx(); return true; }
    const a = document.activeElement;
    if (a && a.matches('input, select')) { a.blur(); window.__tvFocusDefault?.(); return true; }
    if (!S.profile) return false;
    if (S.section === 'search' && S.scopePicked) { showScopePicker(); return true; }      // results → "What are you looking for?"
    if (S.section !== 'guide') { setSection('guide'); setTimeout(() => window.__tvFocusDefault?.(), 50); return true; }
    if (S.engineNow === 'vlc' && S.current) { stopPlayer(); msg('Pick a channel to start watching'); return true; }
    return false;
  };
  window.__tvMenu = () => {                        // Menu button / hold OK: favourites for the focused channel or category
    const a = document.activeElement; if (!a) return;
    if (a.matches('#catList li[data-id]') && a.dataset.id && S.section !== 'fav' && S.section !== 'recent') {
      const r = a.getBoundingClientRect();
      catMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left + 40, clientY: r.top + r.height / 2 }, a.dataset.id).then(() => {
        (document.querySelector(`#catList li[data-id="${CSS.escape(a.dataset.id)}"]`) || a).focus();
      });
      setTimeout(() => ctx.querySelector('button')?.focus(), 30);
      return;
    }
    let it = null;
    if (a.matches('#itemList li[data-idx]')) it = S.view[+a.dataset.idx];
    else if (a.closest('.g-row')) it = S.view[+a.closest('.g-row').dataset.i];
    else if (S.current) it = S.current.parent || S.current;
    if (!it) return;
    const r = a.getBoundingClientRect();
    itemMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left + 40, clientY: r.top + r.height / 2 }, it, true)
      .then(() => a.focus());
    setTimeout(() => (ctx.querySelector('[data-a="fav"]') || ctx.querySelector('button'))?.focus(), 30);   // lands on Add to favourites
  };
  window.__tvInfo = () => {};

  /* ---------- Info banner over full-screen live TV (OK button) ---------- */
  const OSD = { on: false, hideT: 0, poll: 0, epg: null, epgFor: null, sel: 1 };   // sel: 0 ⏪, 1 play/pause, 2 ⏩
  const nowS = () => Date.now() / 1000;
  const st = () => { try { return JSON.parse(window.AndroidBridge.refreshStatus ? window.AndroidBridge.refreshStatus() : window.AndroidBridge.status()); } catch { return {}; } };
  const behindTxt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const dur = s => { s = Math.max(0, Math.round(s / 60)); return s >= 60 ? `${Math.floor(s / 60)}h ${String(s % 60).padStart(2, '0')}m` : `${s}m`; };
  window.__tvFullMode = on => {
    document.documentElement.classList.toggle('tv-full', !!on);
    if (!on) osdHide();
  };
  window.__osdShow = () => osdShow();
  // phone: touch controls over the full-screen picture
  if (PHONE) {
    document.documentElement.classList.add('phone');
    document.addEventListener('focusin', e => { if (e.target.matches?.('input[type=text], input:not([type]), input[type=search]')) document.documentElement.classList.add('kb'); });
    document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement?.matches?.('input')) document.documentElement.classList.remove('kb'); }, 50));
    const pad = document.createElement('div'); pad.id = 'touchpad'; document.body.appendChild(pad);
    let t0 = null, lastTap = 0, tapTimer = 0;
    /* brightness (left) and volume (right) sliders, like Smarters: shown with the banner when you tap, or slide a
       finger up/down the left or right side of the picture */
    const B = window.AndroidBridge;
    const SL = { bright: 0.5, vol: 0.5, hideT: 0 };
    try { SL.bright = B.getBrightness ? +B.getBrightness() : 0.5; SL.vol = B.getVolume ? +B.getVolume() : 0.5; } catch {}
    const svgB = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>';
    const svgV = '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
    document.body.insertAdjacentHTML('beforeend', `<div id="slBright" class="vslider left" hidden><div class="vs-ico">${svgB}</div><div class="vs-track"><div class="vs-fill"></div></div><div class="vs-val"></div></div>
      <div id="slVol" class="vslider right" hidden><div class="vs-ico">${svgV}</div><div class="vs-track"><div class="vs-fill"></div></div><div class="vs-val"></div></div>`);
    const draw = () => {
      for (const [id, v] of [['#slBright', SL.bright], ['#slVol', SL.vol]]) {
        const el = $(id); el.querySelector('.vs-fill').style.height = Math.round(v * 100) + '%'; el.querySelector('.vs-val').textContent = Math.round(v * 100) + '%';
      }
    };
    const setBright = v => { SL.bright = Math.max(0.02, Math.min(1, v)); B.setBrightness?.(SL.bright); draw(); };
    const setVol = v => { SL.vol = Math.max(0, Math.min(1, v)); B.setVolume?.(SL.vol); draw(); };
    window.__slidersShow = on => {
      if (on) { try { SL.vol = B.getVolume ? +B.getVolume() : SL.vol; } catch {} draw(); }
      $('#slBright').hidden = $('#slVol').hidden = !(on && S.tvFull);
    };
    // drag the sliders themselves
    for (const [id, set, key] of [['#slBright', setBright, 'bright'], ['#slVol', setVol, 'vol']]) {
      const el = $(id), tr = el.querySelector('.vs-track');
      const at = y => { const r = tr.getBoundingClientRect(); return 1 - (y - r.top) / r.height; };
      el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); set(at(e.clientY)); osdArm(); });
      el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) { set(at(e.clientY)); osdArm(); } });
    }
    pad.addEventListener('touchstart', e => { const t = e.touches[0]; const zone = t.clientX < innerWidth * 0.3 ? 'bright' : t.clientX > innerWidth * 0.7 ? 'vol' : '';
      t0 = { x: t.clientX, y: t.clientY, at: Date.now(), zone, v0: zone ? SL[zone] : 0, adj: false }; }, { passive: true });
    // slide up/down on the left = brightness, on the right = volume
    pad.addEventListener('touchmove', e => {
      if (!t0 || !t0.zone) return;
      const t = e.touches[0], dy = t.clientY - t0.y;
      if (!t0.adj && Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(t.clientX - t0.x)) { t0.adj = true; if (!OSD.on) osdShow(); }
      if (t0.adj) { (t0.zone === 'bright' ? setBright : setVol)(t0.v0 - dy / (innerHeight * 0.7)); osdArm(); }
    }, { passive: true });
    pad.addEventListener('touchend', e => {
      if (!t0) return;
      if (t0.adj) { t0 = null; return; }
      const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y; const start = t0; t0 = null;
      if (Math.abs(dy) > 80 && Math.abs(dy) > Math.abs(dx) * 1.5) { window.__tvZap(dy < 0 ? 1 : -1); return; }   // swipe up/down = channel
      if (Math.abs(dx) > 30 || Math.abs(dy) > 30) return;
      const now = Date.now();
      if (now - lastTap < 300) {                     // double-tap left/right side = jump 10 s
        clearTimeout(tapTimer); lastTap = 0;
        window.AndroidBridge.jumpBy(start.x < innerWidth / 2 ? -10000 : 10000); setTimeout(osdShow, 150); return;
      }
      lastTap = now;
      tapTimer = setTimeout(() => { if (OSD.on) osdHide(); else osdShow(); }, 300);   // single tap = banner on/off
    }, { passive: true });
    $('#playerWrap').addEventListener('click', e => { if (e.target.closest('#pipBtn')) return; if (S.engineNow === 'vlc' && !S.tvFull) window.native.vlc.fullscreen(true); });   // tap the picture = full screen
    // picture in picture: a button on the small picture (and Home does it automatically while something plays)
    if (canPip()) {
      $('#playerWrap').insertAdjacentHTML('beforeend', `<button id="pipBtn" class="pip-btn" title="Picture in picture" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><rect x="12" y="11.5" width="7" height="5.5" rx="1" fill="currentColor" stroke="none"/></svg><span>Mini player</span></button>`);
      $('#pipBtn').addEventListener('click', e => { e.stopPropagation(); window.AndroidBridge.enterPip(); });
      setInterval(() => { $('#pipBtn').hidden = !(S.engineNow === 'vlc' && S.current && !S.tvFull); }, 1000);
    }
    $('#osd').addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const B = window.AndroidBridge;
      ({ rew: () => B.trick(false), ff: () => B.trick(true), pp: () => B.togglePause(), exit: () => B.exitFull(), pip: () => B.enterPip(),
         back10: () => B.jumpBy(-10000), fwd10: () => B.jumpBy(10000), live: () => B.goLive?.(),
         cc: () => { OSD.cc = !OSD.cc; },
         trk: () => { B.chooseTrack?.(b.dataset.k, +b.dataset.g, +b.dataset.t); OSD.cc = false; window.AndroidBridge.toast?.(b.dataset.g === '-1' ? 'Subtitles off' : b.textContent.trim()); } })[b.dataset.act]?.();
      osdArm();
      setTimeout(osdShow, 150);
    });
  }
  window.__osdBack = () => { if (window.__netKey?.('back')) return true; if (OSD.on) { osdHide(); return true; } return false; };
  // remote while watching: OK shows the banner (OK again = pause/play), ◀ ▶ jump 10 s; ⏪ ⏩ ▶❚❚ are handled by the app
  window.__osdKey = k => {
    const B = window.AndroidBridge;
    if (k === 'left' || k === 'right') { B.jumpBy(k === 'left' ? -10000 : 10000); setTimeout(osdShow, 150); return; }
    if (k !== 'ok') return;
    if (window.__netKey?.('ok')) return;
    if (!OSD.on) osdShow(); else { B.togglePause(); setTimeout(osdShow, 150); }
  };
  async function osdEpg() {
    const ch = S.current; if (!ch || ch.kind !== 'live') return [];
    if (OSD.epgFor === ch.id && OSD.epg) return OSD.epg;
    OSD.epgFor = ch.id; OSD.epg = [];
    try { OSD.epg = await fetchEpg(ch.id); } catch {}
    return OSD.epg;
  }
  function osdShow() {
    OSD.on = true; $('#osd').hidden = false; window.__slidersShow?.(true);
    osdRender();
    clearInterval(OSD.poll); OSD.poll = setInterval(osdRender, 500);
    osdArm();
  }
  function osdArm() {
    clearTimeout(OSD.hideT);
    const t = +S.settings.osdTime;
    if (t > 0) OSD.hideT = setTimeout(() => { const s = st(); if (s.paused || s.trick || OSD.cc) { osdArm(); return; } osdHide(); }, t * 1000);
  }
  function osdHide() { window.__slidersShow?.(false); OSD.on = false; OSD.cc = false; clearInterval(OSD.poll); clearTimeout(OSD.hideT); const o = $('#osd'); if (o) o.hidden = true; }
  async function osdRender() {
    if (!OSD.on) return;
    const s = st(), ch = S.current; if (!ch) return;
    if (PHONE) return phoneOsd(s, ch);
    const list = await osdEpg();
    const behind = s.behind > 0 ? s.behind : 0;
    const watching = nowS() - behind / 1000;                    // the moment on screen
    const prog = list.find(p => p.st <= watching && watching < p.en) || null;
    const next = prog ? list.find(p => p.st >= prog.en) : list.find(p => p.st > watching);
    const pct = t => prog ? Math.max(0, Math.min(100, (t - prog.st) / (prog.en - prog.st) * 100)) : 0;
    const head = pct(watching), live = pct(nowS());
    const atLive = behind <= (s.delay || 0) + 2500 && !s.paused && !s.trick;
    const tag = !s.timeshift ? 'LIVE' : atLive ? `${behindTxt(behind)} behind live` : `${behindTxt(behind)} behind live`;
    $('#osd').innerHTML =
      (s.trick ? `<div class="osd-trick">${s.trick < 0 ? '⏪' : '⏩'} <span class="sp">×${Math.abs(s.trick)}</span><span class="ts">−${behindTxt(behind)} behind live</span></div>`
        : s.paused ? `<div class="osd-trick">❚❚ <span class="ts">Paused · ${behindTxt(behind)} behind live</span></div>` : '') +
      `<div class="osd-banner"><div class="osd-in">
        <div class="osd-chname">${esc((ch.parent || ch).name || ch.name)}${qualityOf(ch.name) ? `<em class="q q${qualityOf(ch.name)}">${QUAL_NAME[qualityOf(ch.name)]}</em>` : ''}</div>
        <div class="osd-r1"><div class="osd-chan"><span class="no">${esc(ch.num ?? '')}</span>${ch.icon ? `<img src="${esc(ch.icon)}" onerror="this.style.visibility='hidden'">` : ''}</div>
          <div class="osd-np"><span class="tag">NOW</span><span class="time">${prog ? `${hhmm(prog.st)} – ${hhmm(prog.en)}` : ''}</span>
            <div class="t">${prog ? esc(prog.title) : '<span class="dimt">No programme info for this channel</span>'}</div></div>
          <div class="osd-clock">${hhmm(nowS())}</div></div>
        ${prog ? `<div class="osd-prog"><span>${hhmm(prog.st)}</span><div class="bar"><div class="w" style="width:${head}%"></div><div class="gap" style="left:${head}%;width:${Math.max(0, live - head)}%"></div><div class="live" style="left:${live}%"></div><div class="head" style="left:${head}%"></div></div><span>${hhmm(prog.en)}</span></div>
          <div class="osd-sub">${dur(watching - prog.st)} in · ${dur(prog.en - watching)} left</div>` : ''}
        <div class="osd-r3"><span class="next">${next ? `NEXT<b>${hhmm(next.st)}</b>${esc(next.title)}` : ''}</span>
          <div class="right">${PHONE ? `<div class="pkeys"><button data-act="rew">⏪</button><button data-act="pp">${s.paused || s.trick ? '▶' : '❚❚'}</button><button data-act="ff">⏩</button>${canPip() ? `<button data-act="pip" title="Picture in picture"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><rect x="12" y="11.5" width="7" height="5.5" rx="1" fill="currentColor" stroke="none"/></svg></button>` : ''}<button data-act="exit">✕</button></div>` : ''}<span class="pill ${!s.timeshift ? 'live' : 'delay'}">${tag}</span></div></div>
        ${window.__netLine ? `<div class="osd-r4">${window.__netLine()}</div>` : ''}
      </div></div>`;
  }
  /* ---------- Connection light + "switching to a lower-quality channel in 5…" ---------- */
  const NET = { lvl: null, n: null, bad: 0, poll: 0, cd: null, dismissed: new Map(), slowToldAt: 0 };
  function netLevel(n) {
    if (!n) return null;
    if (n.stalls1 >= 1 || (n.factor != null && n.factor < 0.9)) return 'bad';
    if (n.stalls10 >= 1 || (n.factor != null && n.factor < 0.98)) return 'mid';
    if (n.factor == null && n.down && n.need && n.down < n.need * 1.1) return 'mid';
    return 'good';
  }
  const NET_TXT = { good: 'Internet good', mid: 'Internet struggling', bad: 'Internet too slow' };
  window.__netLine = () => {                     // one line for the info banner
    const n = NET.n, l = NET.lvl; if (!n || !l) return '';
    const parts = [];
    if (n.down) parts.push(`${mbps(n.down)} Mbps coming in`);
    if (n.need) parts.push(`channel needs ${mbps(n.need)}`);
    return `<span class="osd-net ${l}"><i></i>${NET_TXT[l]}${parts.length ? ' · ' + parts.join(' · ') : ''}</span>`;
  };
  function netDot() {
    const d = $('#netDot'), mode = S.settings.netDot || 'problem', l = NET.lvl;
    const show = l && S.engineNow === 'vlc' && S.current && mode !== 'off' && (mode === 'always' || l !== 'good') && !NET.cd;
    if (!show) { d.hidden = true; return; }
    d.className = 'net-dot ' + l + (S.tvFull ? ' full' : '');
    d.innerHTML = `<i></i>${l === 'good' ? '' : `<span>${NET_TXT[l]}</span>`}`;
    if (!S.tvFull) { const r = $('#playerWrap').getBoundingClientRect(); d.style.top = (r.top + 8) + 'px'; d.style.left = ''; d.style.right = (innerWidth - r.right + 8) + 'px'; }
    else { d.style.top = ''; d.style.right = ''; }
    d.hidden = false;
  }
  function netCheck() {
    if (S.engineNow !== 'vlc' || !S.current) { NET.lvl = null; NET.n = null; netDot(); return; }
    const s = st(); if (!s || s.state === 'idle') return;
    const n = s.net; NET.n = n || null;
    const live = S.current.kind === 'live';
    NET.lvl = s.paused || s.trick ? NET.lvl : netLevel(n);
    netDot();
    if (!n || !live || s.paused || s.trick) return;
    // kept stalling: Automatic mode keeps a bigger buffer from now on
    if ((S.settings.netMode || 'auto') === 'auto' && n.stalls10 >= 2 && !store.get('slowAuto', false)) {
      store.set('slowAuto', true);
      window.AndroidBridge.setOptions?.(JSON.stringify({ delay: liveDelayNow(), keepMin: +S.settings.rewindMin || 30, subs: S.settings.subs || 'off' }));
      window.AndroidBridge.toast?.(`Your internet keeps dropping – StarkTV will now keep a ${SLOW_DELAY}-second buffer`);
    }
    // too slow for this channel for a while → offer the lower-quality version
    const bad = n.stalls10 >= 2 || (n.factor != null && n.factor < 0.9);
    NET.bad = bad ? NET.bad + 1 : 0;
    if (NET.bad >= 3) { const t = store.get('netTest', null);
      netOffer(n.need ? `It needs about ${mbps(n.need)} Mbps but only ${mbps(n.down || 0)} Mbps is getting through.` : 'It keeps stopping to buffer.', Math.max(n.down || 0, t && Date.now() - t.at < 7 * 86400000 ? t.kbps : 0) || 0); }
  }
  function netOffer(reason, kbps) {
    const ch = S.current; if (!ch || ch.kind !== 'live' || NET.cd || (S.settings.netSwitch || 'ask') === 'never') return;
    const d = NET.dismissed.get(ch.id); if (d && Date.now() - d < 15 * 60000) return;
    const alts = lowerVersions(ch); if (!alts.length) return;
    // the best version the internet can actually carry (if we know its speed), else the next one down
    const alt = kbps ? (alts.find(c => QUAL_NEED[qualityOf(c.name)] <= kbps * 0.9) || alts[alts.length - 1]) : alts[0];
    NET.bad = 0;
    netCountdown(ch, alt, reason);
  }
  window.__netOnStart = ch => {                  // before you settle in: a 4K/Full HD channel on internet that tested too slow
    NET.bad = 0; NET.lvl = null; NET.n = null; netDot();
    if (!ch || ch.kind !== 'live') return;
    const q = qualityOf(ch.name), t = store.get('netTest', null);
    if (q >= 3 && t && Date.now() - t.at < 30 * 86400000 && t.kbps < QUAL_NEED[q] * 1.1)
      setTimeout(() => netOffer(`${QUAL_NAME[q]} needs about ${mbps(QUAL_NEED[q])} Mbps – your internet tested at ${mbps(t.kbps)} Mbps.`, t.kbps), 1200);
  };
  function netCountdown(from, alt, reason) {
    NET.cd = { from, alt, n: 5, t: 0 };
    const box = $('#netSwitch');
    const draw = () => {
      const c = NET.cd; if (!c) return;
      box.className = 'net-switch' + (S.tvFull ? ' full' : '');
      box.innerHTML = `<div class="ns-card"><div class="ns-h"><i></i>Your internet is too slow for this channel</div>
        <div class="ns-why">${esc(reason)}</div>
        <div class="ns-to">Switching to <b>${esc(alt.name)}</b> in</div>
        <div class="ns-n">${c.n}</div>
        <div class="ns-btns"><button class="primary" data-ns="go">Switch now${TV && !PHONE ? ' (OK)' : ''}</button><button class="ghost" data-ns="stay">Stay on this channel${TV && !PHONE ? ' (Back)' : ''}</button></div></div>`;
      box.hidden = false;
    };
    draw(); netDot(); osdHide();
    if (!S.tvFull) setTimeout(() => box.querySelector('[data-ns="go"]')?.focus(), 30);
    NET.cd.t = setInterval(() => { const c = NET.cd; if (!c) return; c.n--; if (c.n <= 0) netGo(); else draw(); }, 1000);
  }
  function netEnd() { const c = NET.cd; if (c) clearInterval(c.t); NET.cd = null; $('#netSwitch').hidden = true; }
  function netGo() {
    const c = NET.cd; if (!c) return; netEnd();
    if (S.current?.id !== c.from.id) return;                // already changed channel
    openItem({ ...c.alt, kind: 'live' });
    window.AndroidBridge.toast?.(`Switched to ${c.alt.name}`);
  }
  function netStay() { const c = NET.cd; if (!c) return; NET.dismissed.set(c.from.id, Date.now()); netEnd(); netDot(); }
  $('#netSwitch').addEventListener('click', e => { const b = e.target.closest('[data-ns]'); if (!b) return; b.dataset.ns === 'go' ? netGo() : netStay(); });
  window.__netKey = k => { if (!NET.cd) return false; if (k === 'ok') netGo(); else if (k === 'back') netStay(); return true; };
  NET.poll = setInterval(netCheck, 2000);

  // clock overlay (Settings): the real time, the moment on screen and how far behind live – small, top left
  const p2s = n => String(n).padStart(2, '0');
  const hms = ms => { const d = new Date(ms); return `${p2s(d.getHours())}:${p2s(d.getMinutes())}:${p2s(d.getSeconds())}`; };
  setInterval(() => {
    const o = $('#clockOv');
    const on = !PHONE && S.settings.clock === 'on' && S.engineNow === 'vlc' && S.current?.kind === 'live' && !NET.cd;
    if (!on) { o.hidden = true; return; }
    const s = st(); if (!s || s.state === 'idle' || s.state === 'error') { o.hidden = true; return; }
    const now = Date.now(), behind = s.behind > 0 ? s.behind : 0;
    o.innerHTML = `<span><b>${hms(now)}</b> real time</span><span><b>${hms(now - behind)}</b> on screen</span><span><b>${behind >= 60000 ? behindTxt(behind) : Math.round(behind / 1000) + ' s'}</b> behind live</span>`;
    o.className = 'clock-ov' + (S.tvFull ? ' full' : '');
    if (!S.tvFull) { const r = $('#playerWrap').getBoundingClientRect(); o.style.left = (r.left + 8) + 'px'; o.style.top = (r.top + 8) + 'px'; }
    else { o.style.left = ''; o.style.top = ''; }
    o.hidden = false;
  }, 1000);
  window.addEventListener('resize', netDot);

  /* ---------- Phone: touch controls over full-screen video (live and films) ----------
     Tap the picture: title at the top, big ⟲10 / play-pause / 10⟳ in the middle, a seek bar along the bottom
     (films: the whole film; live: the rewind buffer up to LIVE), brightness left / volume right. */
  const ICO = {
    back: '<svg viewBox="0 0 24 24"><path d="M11.5 5.5A7 7 0 1 1 5 12"/><path d="M11.5 2.5v6l-4-3z" fill="currentColor"/><text x="12" y="15.6" text-anchor="middle" font-size="6.5" font-weight="800" fill="currentColor" stroke="none">10</text></svg>',
    fwd: '<svg viewBox="0 0 24 24"><path d="M12.5 5.5A7 7 0 1 0 19 12"/><path d="M12.5 2.5v6l4-3z" fill="currentColor"/><text x="12" y="15.6" text-anchor="middle" font-size="6.5" font-weight="800" fill="currentColor" stroke="none">10</text></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><rect x="6.5" y="5.5" width="4" height="13" rx="1" fill="currentColor"/><rect x="13.5" y="5.5" width="4" height="13" rx="1" fill="currentColor"/></svg>',
    pip: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><rect x="12" y="11.5" width="7" height="5.5" rx="1" fill="currentColor" stroke="none"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };
  const mmss = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  // where the seek bar is: films 0…length; live: the kept buffer, right-hand end = live
  function seekInfo(s, ch) {
    if (ch.kind !== 'live') { const len = +s.length || 0; return len > 0 ? { frac: Math.min(1, (+s.time || 0) / len), left: mmss(+s.time || 0), right: '−' + mmss(len - (+s.time || 0)), total: len * 1000, live: false } : null; }
    if (!s.timeshift || !(s.window > 0)) return null;
    const win = +s.window, pos = Math.min(win, +s.pos || 0), behind = s.behind > 0 ? s.behind : 0;
    return { frac: pos / win, left: '−' + behindTxt(behind), right: 'LIVE', total: win, live: true, atLive: behind <= (s.delay || 0) + 2500 };
  }
  // subtitles / sound picker (phone)
  function ccMenuHtml() {
    let t = { text: [], audio: [] }; try { t = JSON.parse(window.AndroidBridge.tracks?.() || '{}'); } catch {}
    const txt = t.text || [], aud = t.audio || [];
    const offOn = t.textOff || !txt.some(x => x.sel);
    return `<div class="cc-menu"><div class="cc-h">Subtitles</div>
      <button class="cc-o${offOn ? ' on' : ''}" data-act="trk" data-k="text" data-g="-1" data-t="-1">Off</button>
      ${txt.map(x => `<button class="cc-o${!t.textOff && x.sel ? ' on' : ''}" data-act="trk" data-k="text" data-g="${x.g}" data-t="${x.t}">${esc(x.name)}</button>`).join('') || '<div class="cc-none">None on this programme</div>'}
      ${aud.length > 1 ? `<div class="cc-h">Sound</div>${aud.map(x => `<button class="cc-o${x.sel ? ' on' : ''}" data-act="trk" data-k="audio" data-g="${x.g}" data-t="${x.t}">${esc(x.name)}</button>`).join('')}` : ''}</div>`;
  }
  async function phoneOsd(s, ch) {
    if (OSD.drag) return;                                     // don't redraw under your finger
    const live = ch.kind === 'live';
    let title = esc((ch.parent || ch).name || ch.name), sub = '';
    if (live) {
      const list = await osdEpg(), watching = nowS() - (s.behind > 0 ? s.behind : 0) / 1000;
      const prog = list.find(p => p.st <= watching && watching < p.en);
      sub = prog ? `${hhmm(prog.st)} – ${hhmm(prog.en)} · ${esc(prog.title)}` : '';
      if (qualityOf(ch.name)) title += ` <em class="q q${qualityOf(ch.name)}">${QUAL_NAME[qualityOf(ch.name)]}</em>`;
    } else {
      title = esc(cleanTitle((ch.show || ch).name || ''));
      if (ch.ep) sub = `Season ${esc(ch.ep.season)} · Episode ${esc(ch.ep.num)}${ch.ep.title ? ' · ' + esc(ch.ep.title) : ''}`;
    }
    const si = seekInfo(s, ch), paused = s.paused || s.trick;
    $('#osd').innerHTML = `<div class="posd">
      <div class="posd-top"><div class="posd-tt"><div class="posd-title">${title}</div>${sub ? `<div class="posd-sub">${sub}</div>` : ''}</div>
        <button class="posd-ic cc" data-act="cc" title="Subtitles and sound">CC</button>${canPip() ? `<button class="posd-ic" data-act="pip" title="Mini player">${ICO.pip}</button>` : ''}<button class="posd-ic" data-act="exit" title="Close">${ICO.close}</button></div>
      ${OSD.cc ? ccMenuHtml() : ''}
      <div class="posd-mid"><button class="posd-b" data-act="back10">${ICO.back}</button><button class="posd-b big" data-act="pp">${paused ? ICO.play : ICO.pause}</button><button class="posd-b" data-act="fwd10">${ICO.fwd}</button></div>
      ${si ? `<div class="posd-bot"><span class="posd-t">${si.left}</span><div class="posd-bar" data-live="${si.live ? 1 : 0}"><div class="posd-fill" style="width:${(si.frac * 100).toFixed(2)}%"></div><div class="posd-knob" style="left:${(si.frac * 100).toFixed(2)}%"></div></div>
        ${si.live ? `<button class="posd-live${si.atLive ? ' on' : ''}" data-act="live">LIVE</button>` : `<span class="posd-t">${si.right}</span>`}</div>` : ''}
      ${live && window.__netLine ? `<div class="posd-net">${window.__netLine()}</div>` : ''}
    </div>`;
    OSD.seek = si;
  }
  if (PHONE) {
    // seek bar: drag to anywhere in the film / the rewind buffer
    const osd = $('#osd');
    const fracAt = (bar, x) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); };
    let dragBar = null;
    osd.addEventListener('pointerdown', e => {
      const bar = e.target.closest('.posd-bar'); if (!bar || !OSD.seek) return;
      e.preventDefault(); dragBar = bar; OSD.drag = true; bar.setPointerCapture(e.pointerId);
      const f = fracAt(bar, e.clientX); bar.querySelector('.posd-fill').style.width = f * 100 + '%'; bar.querySelector('.posd-knob').style.left = f * 100 + '%';
      osdArm();
    });
    osd.addEventListener('pointermove', e => {
      if (!dragBar) return; const f = fracAt(dragBar, e.clientX);
      dragBar.querySelector('.posd-fill').style.width = f * 100 + '%'; dragBar.querySelector('.posd-knob').style.left = f * 100 + '%';
      const t = osd.querySelector('.posd-t'); if (t && OSD.seek && !OSD.seek.live) t.textContent = mmss(f * OSD.seek.total / 1000);
      osdArm();
    });
    const endDrag = e => {
      if (!dragBar) return; const f = fracAt(dragBar, e.clientX); dragBar = null;
      if (OSD.seek) { const ms = Math.round(f * OSD.seek.total); if (OSD.seek.live && f > 0.985) window.AndroidBridge.goLive?.(); else window.AndroidBridge.seekTo(ms); }
      setTimeout(() => { OSD.drag = false; osdRender(); }, 400);
    };
    osd.addEventListener('pointerup', endDrag); osd.addEventListener('pointercancel', endDrag);
  }

  window.__tvFavCurrent = () => {                  // Menu while watching full screen: star / unstar this channel
    const c = S.current; if (!c) return;
    const it = c.parent || c, was = isFav(it);
    toggleFav(favData(it));
    window.AndroidBridge.toast?.(was ? `Removed ${it.name} from favourites` : `★ Added ${it.name} to favourites`);
  };
}

/* ---------- Internet connection: speed test, slow-internet buffer, channel quality ---------- */
const SLOW_DELAY = 45;
// the live delay actually used: bigger on slow internet (chosen in Settings, or switched on automatically)
const liveDelayNow = () => { const d = +S.settings.liveDelay || 0, m = S.settings.netMode || 'auto';
  return m === 'slow' || (m === 'auto' && store.get('slowAuto', false)) ? Math.max(d, SLOW_DELAY) : d; };
// picture quality from a channel name: 4 = 4K/UHD, 3 = Full HD, 2 = HD, 1 = SD, 0 = not stated
const QUAL_RX = [[4, /\b(uhd|4k|2160p?)\b/], [3, /\b(fhd|full hd|1080p?)\b/], [2, /\b(hd|720p?)\b/], [1, /\b(sd|480p?|576p?|lq|low)\b/]];
const QUAL_NAME = { 4: '4K', 3: 'Full HD', 2: 'HD', 1: 'SD' };
const QUAL_NEED = { 4: 20000, 3: 8000, 2: 5000, 1: 2500 };           // kbps a channel of that quality typically needs
const qualityOf = name => { const n = norm(name); for (const [q, rx] of QUAL_RX) if (rx.test(n)) return q; return 0; };
const QWORDS = /\b(uhd|4k|2160p?|fhd|full hd|1080p?|hd|720p?|sd|480p?|576p?|lq|low|hevc|h265|h 265|hdr|50fps|60fps|backup|raw|vip|multi audio|multiaudio)\b/g;
const baseOf = name => norm(name).replace(/^(uk|gb|us|usa|ie|ca|au|en)\s+/, '').replace(QWORDS, ' ').replace(/\s+/g, ' ').trim();
// the same channel at a lower quality (same name without the quality, or the same guide id), best first
function lowerVersions(ch) {
  const q = qualityOf(ch.name) || 2, b = baseOf(ch.name), epg = ch.epgId ? String(ch.epgId).toLowerCase() : '';
  const hidden = S.settings.hideAdult ? new Set(S.cats.live.filter(c => adultRx.test(c.name)).map(c => c.id)) : null;
  return S.items.live.filter(c => c.id !== ch.id && !(hidden && hidden.has(c.cat)))
    .map(c => ({ c, q: qualityOf(c.name) }))
    .filter(x => x.q > 0 && x.q < q && (baseOf(x.c.name) === b || (epg && String(x.c.epgId || '').toLowerCase() === epg)))
    .sort((x, y) => (y.q - x.q) || ((y.c.cat === ch.cat) - (x.c.cat === ch.cat)))
    .map(x => x.c);
}
const mbps = kbps => (kbps / 1000).toFixed(kbps < 10000 ? 1 : 0);
// download for ~6 s and measure; Cloudflare's speed-test file first, the provider's guide file if that's blocked
async function speedTest(progress) {
  const p = S.profile;
  const urls = ['https://speed.cloudflare.com/__down?bytes=100000000'];
  if (p?.type === 'xtream') urls.push(`${base(p)}/xmltv.php?username=${encodeURIComponent(p.user)}&password=${encodeURIComponent(p.pass)}`);
  for (const url of urls) {
    const ctrl = new AbortController();
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
      if (!r.ok || !r.body) continue;
      const rd = r.body.getReader(), t0 = performance.now();
      let bytes = 0, mark = null, mb = 0, lastUi = 0;
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        bytes += value.length; const t = performance.now() - t0;
        if (mark === null && t > 800) { mark = t; mb = bytes; }          // skip the first moment while it gets going
        if (mark !== null && t - lastUi > 400) { lastUi = t; progress?.((bytes - mb) * 8 / (t - mark)); }
        if (t > 6500) break;
      }
      ctrl.abort();
      const t = performance.now() - t0;
      if (mark === null || t - mark < 1500) { if (bytes > 2e6) return { kbps: bytes * 8 / t, at: Date.now() }; continue; }
      return { kbps: (bytes - mb) * 8 / (t - mark), at: Date.now() };     // bits per ms = kbps
    } catch { try { ctrl.abort(); } catch {} }
  }
  return null;
}
function speedVerdict(kbps) {
  const ok = q => kbps >= QUAL_NEED[q] * 1.25;
  const can = [1, 2, 3, 4].filter(ok).map(q => QUAL_NAME[q]);
  const word = kbps >= 25000 ? 'Great' : kbps >= 10000 ? 'Good' : kbps >= 6000 ? 'OK' : kbps >= 3000 ? 'Slow' : 'Very slow';
  return `<b class="sp-${word.replace(' ', '').toLowerCase()}">${word} – ${mbps(kbps)} Mbps</b><br>` +
    (can.length ? `Fine for: ${can.join(', ')}` : 'Too slow for most channels – expect buffering') +
    (kbps < QUAL_NEED[4] * 1.25 ? `<br>Too slow for: ${[4, 3, 2].filter(q => !ok(q)).map(q => QUAL_NAME[q]).join(', ')}` : '');
}
function speedShow() {
  const t = store.get('netTest', null), o = $('#speedOut');
  if (!o) return;
  o.innerHTML = t ? speedVerdict(t.kbps) + `<br><small>Tested ${whenLong(t.at / 1000)}</small>` : 'Checks how fast your internet is and what it can play.';
}
$('#btnSpeed').onclick = async () => {
  const b = $('#btnSpeed'), o = $('#speedOut'); b.disabled = true; b.textContent = 'Testing…';
  const playing = S.engineNow === 'vlc' && S.current;
  o.textContent = 'Measuring… (about 7 seconds)';
  const r = await speedTest(k => { o.textContent = `Measuring… ${mbps(k)} Mbps`; });
  b.disabled = false; b.textContent = 'Test again';
  if (!r) { o.textContent = 'Couldn’t run the test – check the internet is connected.'; return; }
  store.set('netTest', r); speedShow();
  if (playing) o.insertAdjacentHTML('beforeend', '<br><small>Something was playing, so your real speed is a little higher.</small>');
};

$('#btnLog').onclick = () => {
  let t = ''; try { t = window.AndroidBridge?.getLog?.() || ''; } catch {}
  $('#logText').textContent = t ? t.split('\n').reverse().slice(0, 60).join('\n') : 'Nothing logged yet.';
  $('#logDlg').showModal(); setTimeout(() => $('#logClose').focus(), 30);
};
$('#logClose').onclick = () => $('#logDlg').close();

/* ---------- Updates: checks GitHub for a newer build and offers it (Fire Stick / phone install it themselves) ---------- */
const UPD_REPO = 'dstark0011/starktv';
function myBuild() {
  if (TV) { try { return +window.AndroidBridge.versionCode?.() || 0; } catch { return 0; } }
  const v = String(window.native?.version?.() || '').split('.');
  return v.length >= 3 ? +v[2] || 0 : 0;                        // 4.17.31 → build 31 (a hand-made copy counts as 0)
}
async function updLatest() {
  const r = await fetch(`https://api.github.com/repos/${UPD_REPO}/releases/latest`, { cache: 'no-store' });
  if (!r.ok) throw new Error('GitHub replied ' + r.status);
  const rel = await r.json();
  const want = PHONE ? ['StarkTV-Phone.apk', 'StarkTV.apk'] : TV ? ['StarkTV.apk'] : ['StarkTV-Windows.zip'];   // phones get the build without the install permission
  const asset = want.map(n => (rel.assets || []).find(a => a.name === n)).find(Boolean);
  const notes = String(rel.body || '').split('\n').filter(l => /^- /.test(l)).map(l => l.replace(/^- /, '').replace(/\*\*/g, '').trim()).slice(0, 3);
  return { build: +String(rel.tag_name || '').replace(/\D/g, '') || 0, name: String(rel.name || '').replace(/^StarkTV\s*/, ''), asset, notes };
}
async function updCheck(manual) {
  if (!TV && !window.native?.openLink) return manual ? 'Updates work in the StarkTV app.' : '';
  let u; try { u = await updLatest(); } catch (e) { return manual ? 'Couldn’t check: ' + e.message : ''; }
  if (!u.asset || u.build <= myBuild()) return manual ? `You're up to date (${TV ? 'v' + (window.AndroidBridge.version?.() || '') : 'v' + (window.native?.version?.() || '')}).` : '';
  // Fire Stick: install new builds by itself, no pop-up, no "Update now" tap – straight to Android's one confirm
  if (!manual && S.settings.autoUpdate !== false && canSelfInstall()) { autoInstall(u); return `Updating to ${u.name.split(' ')[0]}…`; }
  const later = store.get('updLater', null);
  if (!manual && later && later.build === u.build && Date.now() - later.at < 24 * 3600000) return '';
  updShow(u);
  return `StarkTV ${u.name.split(' ')[0]} is available.`;
}
// the Fire Stick build can install its own updates; phones (no install permission) and the PC can't
const canSelfInstall = () => TV && !PHONE && !!window.AndroidBridge?.selfInstall?.();
function autoInstall(u) {
  if (S.autoUpdating) return;                                            // already going
  if (S.tvFull) { setTimeout(() => autoInstall(u), 120000); return; }    // not while they're watching – try again in 2 min
  S.autoUpdating = u;
  window.AndroidBridge.toast?.('Updating StarkTV to ' + u.name.split(' ')[0] + '…');
  window.AndroidBridge.installUpdate(u.asset.browser_download_url);
}
function updShow(u) {
  if (S.tvFull) { setTimeout(() => updShow(u), 60000); return; }      // not over full-screen TV
  const box = $('#updPop');
  box.innerHTML = `<div class="np-in"><div class="np-k up">UPDATE AVAILABLE</div><div class="np-t">StarkTV ${esc(u.name)}</div>
    ${u.notes.length ? `<ul class="up-notes">${u.notes.map(n => `<li>${esc(n.length > 120 ? n.slice(0, 117) + '…' : n)}</li>`).join('')}</ul>` : ''}
    <div class="np-s" id="updMsg">${PHONE ? 'Downloads in your browser – then tap the download to install it.' : TV ? 'Downloads and installs in about a minute – StarkTV restarts afterwards.' : 'Downloads the new version in your browser.'}</div>
    <div class="np-b"><button class="primary" data-up="go">Update now</button><button class="ghost" data-up="later">Later</button></div></div>`;
  box.hidden = false;
  if (TV && !PHONE) setTimeout(() => box.querySelector('[data-up="go"]')?.focus(), 50);
  box.onclick = e => {
    const b = e.target.closest('[data-up]'); if (!b) return;
    if (b.dataset.up === 'later') { store.set('updLater', { build: u.build, at: Date.now() }); box.hidden = true; return; }
    b.disabled = true; box.querySelector('[data-up="later"]').textContent = 'Close';
    if (TV) { $('#updMsg').textContent = 'Downloading…'; window.AndroidBridge.installUpdate(u.asset.browser_download_url); }
    else { window.native.openLink(u.asset.browser_download_url); $('#updMsg').textContent = 'Downloading in your browser – when it’s done, close StarkTV, unzip it over your StarkTV folder and run the new StarkTV exe.'; }
  };
}
window.__updProgress = pct => { const m = $('#updMsg'); if (m) m.textContent = pct >= 100 ? 'Installing… confirm with “Install” / “Update” if asked.' : `Downloading… ${pct}%`; };
window.__updBrowser = () => { const m = $('#updMsg'); if (m) m.textContent = 'Downloading in your browser – when it finishes, tap it (or open it from Downloads) and choose Update.'; };
window.__updNeedPermission = () => { const m = $('#updMsg'); if (m) m.textContent = 'One-time step: switch on “Allow from this source” for StarkTV, then press Back – the update carries on.'; if (S.autoUpdating) window.AndroidBridge.toast?.('One-time: allow StarkTV to install updates, then press Back'); };
window.__updError = msg2 => { const m = $('#updMsg'); if (m) m.textContent = 'Update didn’t finish: ' + msg2; const b = document.querySelector('#updPop [data-up="go"]'); if (b) { b.disabled = false; b.textContent = 'Try again'; } if (S.autoUpdating) { window.AndroidBridge.toast?.('Update didn’t finish – StarkTV will try again later'); S.autoUpdating = null; } };
window.__updKey = k => { const b = $('#updPop'); if (!b || b.hidden || k !== 'back') return false; b.hidden = true; return true; };
$('#btnUpd').onclick = async () => { const o = $('#updOut'); o.textContent = 'Checking…'; o.textContent = await updCheck(true) || ''; };

/* settings */
$('#btnSettings').onclick = () => {
  $('#setFormat').value = S.settings.format; $('#setBuffer').value = S.settings.buffer; $('#setPlayer').value = S.settings.player; $('#setAdult').checked = S.settings.hideAdult; $('#setResume').checked = S.settings.resume;
  $('#setEngine').value = S.settings.engine || 'auto';
  $('#setClock').value = S.settings.clock || 'off'; $('#setSubs').value = S.settings.subs || 'off';
  if ($('#setAutoRow')) { $('#setAuto').checked = S.settings.autoUpdate !== false; $('#setAutoRow').hidden = !canSelfInstall(); }   // auto-install is Fire Stick only (no such row on the PC page)
  $('#setNet').value = S.settings.netMode || 'auto'; $('#setNetSwitch').value = S.settings.netSwitch || 'ask'; $('#setNetDot').value = S.settings.netDot || 'problem';
  speedShow();
  $('#setDelay').value = String(S.settings.liveDelay ?? 15); $('#setRewind').value = String(S.settings.rewindMin ?? 30); $('#setOsd').value = String(S.settings.osdTime ?? 5);
  window.native?.vlc?.visible(false);              // the VLC picture is a separate window – keep it out of the dialog's way
  $('#settings').showModal();
};
$('#setSave').onclick = () => {
  S.settings = { format: $('#setFormat').value, buffer: $('#setBuffer').value, player: $('#setPlayer').value.trim(), hideAdult: $('#setAdult').checked, resume: $('#setResume').checked, engine: $('#setEngine').value,
    liveDelay: +$('#setDelay').value, rewindMin: +$('#setRewind').value, osdTime: +$('#setOsd').value,
    netMode: $('#setNet').value, netSwitch: $('#setNetSwitch').value, netDot: $('#setNetDot').value, clock: $('#setClock').value, subs: $('#setSubs').value, autoUpdate: $('#setAuto') ? $('#setAuto').checked : S.settings.autoUpdate !== false };
  if (S.settings.netMode !== 'auto') store.set('slowAuto', false);
  store.set('settings', S.settings);
  if (!TV) window.native?.liveOptions?.({ delay: liveDelayNow() });
  if (TV) window.AndroidBridge.setOptions?.(JSON.stringify({ delay: liveDelayNow(), keepMin: +S.settings.rewindMin || 30, subs: S.settings.subs || 'off' }));
  if (S.section !== 'fav' && S.section !== 'recent') { renderCats(); renderItems(); }
};

$('#settings').addEventListener('close', () => { if (S.engineNow === 'vlc') window.native?.vlc?.visible(true); });

/* ---------- Resizable columns ---------- */
const COLS = { rail: [190, 120, 360], cats: [230, 140, 700], items: [320, 200, 1000] };
const colW = store.get('cols', {});
function applyCols() { for (const k in COLS) document.documentElement.style.setProperty('--w-' + k, (colW[k] || COLS[k][0]) + 'px'); }
applyCols();
document.querySelectorAll('.resizer').forEach(h => {
  const k = h.dataset.col, col = h.parentElement;
  h.onpointerdown = e => {
    if (e.button !== 0) return;
    e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add('drag'); document.body.classList.add('resizing');
    const x0 = e.clientX, w0 = col.getBoundingClientRect().width;
    const others = Object.keys(COLS).filter(x => x !== k).reduce((t, x) => t + (colW[x] || COLS[x][0]), 0);
    const [, min, maxW] = COLS[k], max = Math.max(min, Math.min(maxW, window.innerWidth - others - 380)); // keep the player usable
    h.onpointermove = ev => { colW[k] = Math.round(Math.min(max, Math.max(min, w0 + ev.clientX - x0))); applyCols(); };
    h.onpointerup = h.onlostpointercapture = () => {
      h.onpointermove = h.onpointerup = h.onlostpointercapture = null;
      h.classList.remove('drag'); document.body.classList.remove('resizing'); store.set('cols', colW);
    };
  };
  h.ondblclick = () => { delete colW[k]; applyCols(); store.set('cols', colW); };
});

/* ---------- Login screen ---------- */
let mode = 'xtream', editId = null;
function setMode(m) {
  mode = m;
  document.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('on', x.dataset.mode === m));
  document.querySelector('.xt').hidden = m !== 'xtream'; document.querySelector('.m3').hidden = m !== 'm3u';
}
document.querySelectorAll('.seg-btn').forEach(b => b.onclick = () => setMode(b.dataset.mode));
function renderSaved() {
  const d = prof.load();
  $('#saved').innerHTML = d.profiles.map((p, i) => `<div class="saved-row"><b>${esc(p.name)}</b><span>${p.type === 'xtream' ? 'Xtream' : 'M3U'}${p.id === d.last ? ' · last used' : ''}</span><button class="primary" data-go="${i}">Open</button><button class="ghost" data-edit="${i}">Edit</button><button class="ghost" data-del="${i}">Remove</button></div>`).join('');
  $('#autoWrap').hidden = !d.profiles.length;
  $('#autoConn').checked = d.autoConnect !== false;
}
$('#autoConn').onchange = e => { const d = prof.load(); d.autoConnect = e.target.checked; prof.save(d); };
function resetForm() {
  editId = null; $('#addForm').reset(); $('#btnAdd').textContent = 'Add and connect'; $('#btnCancelEdit').hidden = true;
}
$('#btnCancelEdit').onclick = resetForm;
async function openProfile(p, btn) {
  const d = prof.load(); d.last = p.id; prof.save(d);
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
  $('#loginErr').hidden = true;
  try { await connect(p); }
  catch (err) { showLogin(); showErr(err); renderSaved(); }
}
$('#saved').onclick = async e => {
  const d = prof.load(), t = e.target.dataset;
  if (t.del) {
    const [gone] = d.profiles.splice(+t.del, 1);
    if (gone && d.last === gone.id) d.last = null;
    prof.save(d); renderSaved(); return;
  }
  if (t.edit) {
    const p = d.profiles[+t.edit], f = $('#addForm');
    editId = p.id; setMode(p.type);
    const el = n => f.elements.namedItem(n);
    el('name').value = p.name || ''; el('server').value = p.server || ''; el('user').value = p.user || ''; el('pass').value = p.pass || ''; el('m3u').value = p.m3u || '';
    $('#btnAdd').textContent = 'Save and connect'; $('#btnCancelEdit').hidden = false; f.name.focus(); return;
  }
  if (t.go) openProfile(d.profiles[+t.go], e.target);
};
function showErr(err) { const el = $('#loginErr'); el.textContent = err.message.includes('Failed to fetch') ? 'Couldn’t reach the server. Check the URL (include http:// and the port).' : err.message; el.hidden = false; }
const sameLogin = (a, b) => a.type === b.type && (a.type === 'xtream' ? base(a).toLowerCase() === base(b).toLowerCase() && a.user === b.user : a.m3u === b.m3u);
$('#addForm').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target), btn = $('#btnAdd');
  const p = { id: editId || Date.now().toString(36), name: f.get('name').trim(), type: mode };
  if (mode === 'xtream') { p.server = f.get('server').trim(); p.user = f.get('user').trim(); p.pass = f.get('pass');
    if (!p.server || !p.user) return showErr(new Error('Fill in the server URL and username.'));
    if (!/^https?:\/\//i.test(p.server)) p.server = 'http://' + p.server; }
  else { p.m3u = f.get('m3u').trim(); if (!p.m3u) return showErr(new Error('Paste the playlist URL.')); }
  // save straight away so the details are kept even if the server is down right now
  const d = prof.load();
  const i = d.profiles.findIndex(x => x.id === p.id || sameLogin(x, p));
  if (i >= 0) { p.id = d.profiles[i].id; d.profiles[i] = p; } else d.profiles.push(p);   // keep id so favourites survive
  d.last = p.id; prof.save(d); renderSaved();
  btn.disabled = true; btn.textContent = 'Connecting…'; $('#loginErr').hidden = true;
  try { await connect(p); resetForm(); }
  catch (err) { showErr(err); btn.textContent = editId ? 'Save and connect' : 'Add and connect'; editId = p.id; $('#btnCancelEdit').hidden = false; }
  finally { btn.disabled = false; }
};
$('#btnSwitch').onclick = () => { stopPlayer(); S.current = null; msg('Pick a channel to start watching'); showLogin(); renderSaved(); };


/* ---------- Films & Series: Netflix-style browser with recommendations ----------
   Hero (top recommendation) + rows of posters: Continue watching, Recommended for you, Because you watched…,
   New additions, Top rated, your favourite categories, then the rest. Recommendations score things you haven't
   watched by the categories you watch and star, their rating and how new they are. Progress is saved so you can resume
   (films: the position; series: the episode and position). */
const browseKind = () => S.section === 'series' ? 'series' : 'movie';
const watchKey = (kind = 'movie') => (kind === 'series' ? 'watchS:' : 'watch:') + S.profile.id;
const watchAll = (kind = 'movie') => store.get(watchKey(kind), {});
function watchSave(it, pos, dur, kind = 'movie', ep = null) {
  if (!it || !(dur > 60)) return;
  const all = watchAll(kind), old = all[it.id] || {};
  const done = pos > dur * 0.9;
  all[it.id] = { id: it.id, name: it.name, icon: it.icon, cat: it.cat, ext: it.ext, at: Date.now(), pos: Math.round(pos), dur: Math.round(dur),
    done: kind === 'movie' ? (old.done || done) : false, ...(ep ? { ep, epDone: done } : {}) };
  const ids = Object.keys(all);
  if (ids.length > 400) ids.sort((a, b) => all[a].at - all[b].at).slice(0, ids.length - 400).forEach(k => delete all[k]);
  store.set(watchKey(kind), all);
}
const yearOf = n => (String(n || '').match(/\b(19[3-9]\d|20[0-4]\d)\b/) || [])[1] || '';
const cleanTitle = n => String(n || '').replace(/^\s*[A-Z]{2,3}\s*[|:-]\s*/, '').replace(/\s*[([]?\b(19[3-9]\d|20[0-4]\d)\b[)\]]?\s*$/, '').trim() || n;
const hhmmss = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };

// track how far through a film / episode you are (every 5 s while it plays, and when you stop or leave the app)
async function saveProgress() {
  const c = S.current; if (!c || (c.kind !== 'movie' && c.kind !== 'series') || !c.url) return;
  let pos = 0, dur = 0;
  if (S.engineNow === 'vlc') {
    // Android: read the player's position straight away (no waiting), so it's right even as the film is being closed
    let s = null; if (TV) { try { s = JSON.parse(window.AndroidBridge.status()); } catch {} } else s = await window.native?.vlc?.cmd('');
    if (!s) return; pos = +s.time || 0; dur = +s.length || 0;
  }
  else { pos = video.currentTime || 0; dur = isFinite(video.duration) ? video.duration : 0; }
  if (!(dur > 60 && pos > 5)) return;
  if (c.kind === 'movie') watchSave(c, pos, dur, 'movie');
  else if (c.ep) watchSave(c.show || c, pos, dur, 'series', c.ep);
}
setInterval(saveProgress, 5000);
window.__saveProgress = saveProgress;
window.addEventListener('pagehide', saveProgress);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(); });

// pick up where you left off
function resumeAt(id, pos) {
  if (!(pos > 30)) return;
  if (TV) window.AndroidBridge.setStart?.(Math.round(pos * 1000));       // Android: the player opens the film right there
  const seek = () => {
    if (TV) window.AndroidBridge.seekTo?.(Math.round(pos * 1000));
    else if (S.engineNow === 'vlc') window.native.vlc.cmd('command=seek&val=' + Math.round(pos));
    else video.currentTime = pos;
  };
  // then make sure: once it's actually playing, if it's near the start, jump to the spot (a few tries)
  let tries = 0;
  const check = async () => {
    if (S.current?.playId !== id || ++tries > 6) return;
    let t = null;
    if (S.engineNow === 'vlc') {
      let s = null;
      try { s = TV ? JSON.parse(window.AndroidBridge.status()) : await window.native.vlc.cmd(''); } catch {}
      if (s && +s.length > 0) t = +s.time || 0;
    } else if (video.readyState >= 1) t = video.currentTime;
    if (t === null) { setTimeout(check, 1500); return; }                // not started yet
    if (t < pos - 15) { seek(); setTimeout(check, 2500); }
  };
  setTimeout(check, TV ? 2500 : 1500);
}

function browseData(kind) {
  const hidden = S.settings.hideAdult ? new Set(S.cats[kind].filter(c => adultRx.test(c.name)).map(c => c.id)) : null;
  const all = S.items[kind].filter(m => !(hidden && hidden.has(m.cat))).map(m => ({ ...m, kind }));
  const catName = Object.fromEntries(S.cats[kind].map(c => [c.id, c.name]));
  const w = watchAll(kind);
  const watched = new Set(Object.values(w).filter(x => kind === 'series' || x.done || x.pos > 600).map(x => x.id));
  const recent = store.get(recKey(), []).filter(r => r.kind === kind);
  recent.forEach(r => watched.add(r.id));
  // how much you like each category: things you watched (recent ones count more) + starred categories
  const like = {}, now = Date.now();
  for (const x of Object.values(w)) like[x.cat] = (like[x.cat] || 0) + (x.done ? 3 : 1.5) * Math.exp(-(now - x.at) / (60 * 86400000));
  recent.forEach((r, i) => { like[r.cat] = (like[r.cat] || 0) + 1 / (1 + i * 0.2); });
  favCats(kind).forEach(id => { like[id] = (like[id] || 0) + 4; });
  const maxLike = Math.max(1, ...Object.values(like));
  const daySeed = Math.floor(now / 86400000);
  const jitter = id => ((Number(String(id).replace(/\D/g, '').slice(-6)) || 7) * 9301 + daySeed * 49297) % 233280 / 233280;   // changes daily
  const newest = Math.max(1, ...all.map(m => m.added || 0));
  const score = m => {
    const r = Math.min(10, Math.max(0, +m.rating || 0));
    const fresh = m.added ? Math.max(0, 1 - (newest - m.added) / (120 * 86400)) : 0;      // added in the last ~4 months
    return (like[m.cat] || 0) / maxLike * 5 + r * 0.45 + fresh * 1.5 + jitter(m.id) * 0.8;
  };
  const unseen = all.filter(m => !watched.has(m.id));
  const rec = unseen.map(m => [m, score(m)]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  return { all, unseen, rec, w, watched, catName, like };
}

function browseRows(kind) {
  const d = browseData(kind), rows = [], used = new Set();
  const take = (list, n = 40, avoid = true) => { const out = []; for (const m of list) { if (out.length >= n) break; if (avoid && used.has(m.id)) continue; out.push(m); } out.forEach(m => used.add(m.id)); return out; };
  const byId = new Map(d.all.map(m => [m.id, m]));
  const cont = Object.values(d.w)
    .filter(x => kind === 'series' ? true : !x.done && x.pos > 60 && x.pos < x.dur - 120)
    .sort((a, b) => b.at - a.at)
    .map(x => byId.get(x.id) && { ...byId.get(x.id), prog: x.dur ? x.pos / x.dur : 0, pos: x.pos, epLabel: x.ep ? `S${x.ep.season} E${x.ep.num}` : '' }).filter(Boolean).slice(0, 20);
  // series you watch that have a new season / new episodes out
  const news = kind === 'series' ? Object.values(newsAll()).sort((a, b) => b.at - a.at).map(n => byId.get(n.id) && { ...byId.get(n.id), news: n }).filter(Boolean) : [];
  const hero = news[0] || d.rec[0] || d.all[0] || null;
  if (hero) used.add(hero.id);
  if (news.length) rows.push({ title: 'New for you', items: news, note: 'New seasons and episodes of shows you watch' });
  if (cont.length) rows.push({ title: 'Continue watching', items: cont });
  const rec = take(d.rec, 30); if (rec.length) rows.push({ title: 'Recommended for you', items: rec, note: 'Based on what you watch and the categories you’ve starred' });
  const last = Object.values(d.w).sort((a, b) => b.at - a.at)[0] || store.get(recKey(), []).find(r => r.kind === kind);
  if (last) {
    const more = take(d.unseen.filter(m => m.cat === last.cat).sort((a, b) => (+b.rating || 0) - (+a.rating || 0)), 30);
    if (more.length > 3) rows.push({ title: `Because you watched ${cleanTitle(last.name)}`, items: more });
  }
  const fresh = take([...d.unseen].sort((a, b) => (b.added || 0) - (a.added || 0)), 30); if (fresh.length) rows.push({ title: 'New additions', items: fresh });
  const top = take(d.unseen.filter(m => +m.rating >= 7).sort((a, b) => (+b.rating || 0) - (+a.rating || 0)), 30, false); if (top.length > 3) rows.push({ title: 'Top rated', items: top });
  const favs = favCats(kind);
  const cats = [...favs, ...Object.keys(d.like).filter(c => !favs.includes(c)).sort((a, b) => d.like[b] - d.like[a]),
    ...S.cats[kind].map(c => c.id).filter(c => !favs.includes(c) && !(c in d.like))];
  const seenCat = new Set();
  for (const c of cats) {
    if (seenCat.has(c) || !d.catName[c]) continue; seenCat.add(c);
    const inCat = d.all.filter(m => m.cat === c);
    if (inCat.length < 2) continue;
    rows.push({ title: (favs.includes(c) ? '★ ' : '') + d.catName[c], items: [...inCat].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 40), cat: c, count: inCat.length });
    if (rows.length > 40) break;
  }
  return { hero, rows, d };
}

const NF = { rows: [], hero: null, list: [], heroInfo: {} };
function cardHtml(m, k) {
  const w = watchAll(m.kind || 'movie')[m.id];
  const prog = m.prog ?? (w && !w.done && w.dur ? w.pos / w.dur : 0);
  const sub = m.epLabel || (w && w.ep ? `S${w.ep.season} E${w.ep.num}` : '');
  return `<div class="nf-card" tabindex="-1" data-k="${k}" title="${esc(m.name)}">
    ${m.icon ? `<img loading="lazy" src="${esc(m.icon)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'nf-noimg',textContent:this.closest('.nf-card').title}))">` : `<div class="nf-noimg">${esc(cleanTitle(m.name))}</div>`}
    ${prog > 0.02 ? `<i class="nf-prog"><b style="width:${Math.round(prog * 100)}%"></b></i>` : ''}
    ${m.news ? `<span class="nf-new">${esc(newsLabel(m.news))}</span>` : sub ? `<span class="nf-ep">${esc(sub)}</span>` : ''}
    <span class="nf-t">${esc(cleanTitle(m.name))}</span>${m.rating && +m.rating > 0 ? `<span class="nf-r">★ ${(+m.rating).toFixed(1)}</span>` : ''}</div>`;
}
function renderFilms() { renderBrowse(browseKind()); }
function renderBrowse(kind) {
  const box = $('#nf');
  const q = ($('#nfSearch')?.value || '').trim();
  const word = kind === 'series' ? 'Series' : 'Films';
  NF.list = []; NF.kind = kind;
  const add = m => { NF.list.push(m); return NF.list.length - 1; };
  let html = `<div class="nf-top"><h2>${word}</h2><input id="nfSearch" class="search nf-search" placeholder="Search ${word.toLowerCase()}" value="${esc(q)}"></div>`;
  if (q.length >= 2) {
    const sq = smartQuery(q);
    const hits = browseData(kind).all.filter(m => sq.empty ? m.name.toLowerCase().includes(q.toLowerCase()) : sq.test(nrm(m.name))).slice(0, 300);
    html += `<div class="nf-grid-title">${hits.length} ${kind === 'series' ? (hits.length === 1 ? 'series' : 'series') : (hits.length === 1 ? 'film' : 'films')}</div><div class="nf-grid">${hits.map(m => cardHtml(m, add(m))).join('') || '<p class="loading">Nothing matches.</p>'}</div>`;
  } else {
    const { hero, rows } = browseRows(kind);
    NF.hero = hero; NF.rows = rows;
    if (hero) {
      const hk = add(hero), info = NF.heroInfo[kind + hero.id];
      const bg = info?.backdrop || info?.image || hero.backdrop || hero.icon || '';
      html += `<div class="nf-hero" style="${bg ? `--bg:url('${esc(bg)}')` : ''}"><div class="nf-hero-in">
        <div class="nf-badge${hero.news ? ' new' : ''}">${hero.news ? esc(newsLabel(hero.news)) : 'Recommended for you'}</div><h1>${esc(cleanTitle(hero.name))}</h1>
        <div class="nf-meta">${heroMeta(hero, info)}</div>
        <p>${esc(info?.plot || hero.plot || '')}</p>
        <div class="nf-btns"><button class="nf-btn play" data-play="${hk}">▶ ${kind === 'series' ? 'Watch' : 'Play'}</button><button class="nf-btn" data-info="${hk}">ⓘ More info</button></div></div></div>`;
      if (!info) itemInfo(hero).then(i => { NF.heroInfo[kind + hero.id] = i; if (browseKind() === kind && NF.hero === hero && !($('#nfSearch')?.value)) renderHero(hero, i); });
    }
    html += rows.map(r => `<section class="nf-row"><h3>${esc(r.title)}${r.count ? ` <span>${r.count}</span>` : ''}${r.note ? `<small>${esc(r.note)}</small>` : ''}</h3>
      <div class="nf-scroll">${r.items.map(m => cardHtml(m, add(m))).join('')}${r.cat && r.count > r.items.length ? `<div class="nf-card nf-more" tabindex="-1" data-cat="${esc(r.cat)}">See all ${r.count} →</div>` : ''}</div></section>`).join('')
      || `<p class="loading">No ${word.toLowerCase()} in this playlist.</p>`;
  }
  box.innerHTML = html;
  const s = $('#nfSearch');
  const run = () => { const pos = $('#nfSearch').selectionStart; renderBrowse(kind); const n = $('#nfSearch'); n.focus(); n.setSelectionRange(pos, pos); };
  let t; s.oninput = () => {
    clearTimeout(SG.t); SG.t = setTimeout(() => sgUpdate(s, kind, () => { clearTimeout(t); run(); }), 60);
    clearTimeout(t); t = setTimeout(run, TV ? 450 : 250);
  };
}
const heroMeta = (m, i) => esc([yearOf(m.name) || i?.year, i?.duration, i?.genre || m.genre, m.rating && +m.rating > 0 ? '★ ' + (+m.rating).toFixed(1) : ''].filter(Boolean).join('  ·  '));
function renderHero(hero, info) {
  const h = $('#nf .nf-hero'); if (!h) return;
  const bg = info.backdrop || info.image || hero.icon;
  if (bg) h.style.setProperty('--bg', `url('${bg.replace(/'/g, "%27")}')`);
  h.querySelector('.nf-meta').innerHTML = heroMeta(hero, info);
  h.querySelector('p').textContent = info.plot || hero.plot || '';
}
const infoCache = new Map();
async function itemInfo(m) {
  const key = (m.kind || 'movie') + m.id;
  if (infoCache.has(key)) return infoCache.get(key);
  let i = {}, eps = null;
  try {
    if (m.kind === 'series') { const r = await api('get_series_info', `&series_id=${m.id}`); i = r.info || {}; eps = r.episodes || {}; }
    else i = (await api('get_vod_info', `&vod_id=${m.id}`)).info || {};
  } catch {}
  const bd = Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : i.backdrop_path;
  const out = { plot: i.plot || i.description || '', genre: i.genre || '', cast: i.cast || i.actors || '', director: i.director || '',
    duration: i.duration || (i.duration_secs ? hhmmss(i.duration_secs) : '') || (i.episode_run_time ? i.episode_run_time + ' min episodes' : ''),
    year: (i.releasedate || i.release_date || i.releaseDate || '').slice(0, 4), backdrop: bd || '', image: i.movie_image || i.cover_big || i.cover || '', rating: i.rating || '', eps };
  infoCache.set(key, out);
  return out;
}
// details pop-up (films: play/resume; series: seasons and episodes)
async function itemModal(m) {
  const kind = m.kind || 'movie', box = $('#nfModal');
  const w = watchAll(kind)[m.id];
  const canResume = kind === 'movie' ? (w && !w.done && w.pos > 60 && w.pos < w.dur - 120) : !!(w && w.ep);
  box.hidden = false;
  box.innerHTML = `<div class="nf-dlg"><div class="nf-dlg-hero" style="${m.icon ? `--bg:url('${esc(m.icon)}')` : ''}"></div><div class="nf-dlg-in">
    <h2>${esc(cleanTitle(m.name))}</h2><div class="nf-meta">Loading…</div><p></p>
    <div class="nf-btns">${kind === 'movie'
      ? (canResume ? `<button class="nf-btn play" data-go="resume">▶ Resume from ${hhmmss(w.pos)}</button><button class="nf-btn" data-go="start">↺ Start again</button>` : `<button class="nf-btn play" data-go="start">▶ Play</button>`)
      : (canResume ? `<button class="nf-btn play" data-go="resume">▶ ${w.epDone ? 'Next episode' : 'Resume'} · S${w.ep.season} E${w.ep.num}</button>` : `<button class="nf-btn play" data-go="first">▶ Play S1 E1</button>`)}
      <button class="nf-btn" data-go="fav">${isFav(m) ? '★ In my list' : '+ My list'}</button><button class="nf-btn" data-go="close">✕</button></div>
    <div class="nf-eps"></div><div class="nf-cast"></div></div></div>`;
  setTimeout(() => box.querySelector('.nf-btn.play')?.focus(), 30);
  let info = null;
  box.onclick = e => {
    const b = e.target.closest('[data-go], [data-ep], [data-season]');
    if (!b) { if (e.target === box) closeFilmModal(); return; }
    if (b.dataset.season) { drawEps(b.dataset.season); box.querySelector(`.nf-seasons [data-season="${b.dataset.season}"]`)?.focus(); return; }   // keep the highlight on the season you picked
    if (b.dataset.ep) { const [s, k] = b.dataset.ep.split(':'); closeFilmModal(); playEpisode(m, info.eps[s][+k], s, 0); return; }
    const go = b.dataset.go;
    if (go === 'close') closeFilmModal();
    if (go === 'fav') { toggleFav(favData(m)); b.textContent = isFav(m) ? '★ In my list' : '+ My list'; }
    if (kind === 'movie' && (go === 'start' || go === 'resume')) { closeFilmModal(); playFilm(m, go === 'resume' ? w.pos : 0); }
    if (kind === 'series' && (go === 'first' || go === 'resume')) {
      if (!info?.eps) return;
      const target = go === 'resume' ? nextEpisode(info.eps, w) : firstEpisode(info.eps);
      if (target) { closeFilmModal(); playEpisode(m, target.ep, target.season, target.from); }
    }
  };
  const drawEps = season => {
    const list = info?.eps?.[season] || [];
    const seasons = Object.keys(info?.eps || {}).sort((a, b) => a - b);
    box.querySelector('.nf-eps').innerHTML = seasons.length ? `<div class="nf-seasons">${seasons.map(s => `<button class="nf-btn small${s === season ? ' on' : ''}" data-season="${s}">Season ${s}${newsAll()[m.id]?.season === +s ? ' <em class="nf-newtag">NEW</em>' : ''}</button>`).join('')}</div>
      <div class="nf-eplist">${list.map((e, k) => { const cur = w?.ep && String(w.ep.season) === String(season) && String(w.ep.num) === String(e.episode_num);
        return `<button class="nf-epi${cur ? ' cur' : ''}" data-ep="${season}:${k}"><b>E${esc(e.episode_num)}</b><span>${esc(e.title || '')}</span>${cur && !w.epDone && w.pos > 30 ? `<i>${hhmmss(w.pos)}</i>` : ''}</button>`; }).join('')}</div>` : '';
  };
  info = await itemInfo(m);
  if (box.hidden) return;
  const bg = info.backdrop || info.image; if (bg) box.querySelector('.nf-dlg-hero').style.setProperty('--bg', `url('${bg.replace(/'/g, "%27")}')`);
  box.querySelector('.nf-meta').innerHTML = heroMeta({ ...m, rating: info.rating || m.rating }, info);
  box.querySelector('p').textContent = info.plot || m.plot || 'No description.';
  box.querySelector('.nf-cast').innerHTML = [info.cast && `<b>Cast</b> ${esc(info.cast)}`, info.director && `<b>Director</b> ${esc(info.director)}`].filter(Boolean).join('<br>');
  const nw = kind === 'series' ? newsAll()[m.id] : null;
  if (kind === 'series' && info.eps) drawEps(String(nw && info.eps[nw.season] ? nw.season : w?.ep?.season || Object.keys(info.eps).sort((a, b) => a - b)[0] || '1'));
}
const filmModal = itemModal;
/* ---------- New seasons / new episodes of series you watch (remembered on this device) ----------
   When you watch an episode, the app notes how many seasons (and episodes in the latest) the show has. Once a day it
   checks those shows again; a new season – or new episodes once you've caught up – goes to the top of Series
   ("New for you"), puts a number on the Series menu and pops up a short note. Watching it clears it. */
const trackKey = () => 'seasons:' + S.profile.id, newsKey = () => 'seriesNews:' + S.profile.id;
const newsAll = () => { const n = store.get(newsKey(), {}); for (const k in n) if (Date.now() - n[k].at > 60 * 86400000) delete n[k]; return n; };
const newsLabel = n => n.type === 'season' ? `New season ${n.season}` : `${n.count} new episode${n.count === 1 ? '' : 's'}`;
function seasonsOf(eps) {
  const ss = Object.keys(eps || {}).filter(k => (eps[k] || []).length).map(Number).filter(n => n > 0);
  const max = ss.length ? Math.max(...ss) : 0;
  return { max, maxEps: max ? (eps[String(max)] || []).length : 0 };
}
async function seasonTrack(show, ep) {
  let info = infoCache.get('series' + show.id);
  if (!info?.eps) info = await itemInfo({ ...show, kind: 'series' });
  if (!info?.eps) return;
  const { max, maxEps } = seasonsOf(info.eps);
  const all = store.get(trackKey(), {}), o = all[show.id] || {};
  const known = Math.max(o.max || 0, max);
  all[show.id] = { id: show.id, name: show.name, icon: show.icon, cat: show.cat, max: known, maxEps: max >= (o.max || 0) ? maxEps : o.maxEps,
    last: ep ? { s: +ep.season, n: +ep.num } : o.last, checked: Date.now(), at: Date.now() };
  store.set(trackKey(), all);
  const news = store.get(newsKey(), {});
  if (news[show.id] && ep && +ep.season >= news[show.id].season) { delete news[show.id]; store.set(newsKey(), news); newsBadge(); }   // you're watching it
}
let newsBusy = false;
async function newsCheck() {
  if (newsBusy || S.profile?.type !== 'xtream') return; newsBusy = true;
  const pid = S.profile.id;
  try {
    const all = store.get(trackKey(), {});
    // shows watched before this feature existed: note where they are now (no alert the first time)
    for (const x of Object.values(watchAll('series'))) if (!all[x.id]) all[x.id] = { id: x.id, name: x.name, icon: x.icon, cat: x.cat, max: 0, maxEps: 0, last: x.ep ? { s: +x.ep.season, n: +x.ep.num } : null, checked: 0, at: x.at, seed: true };
    const due = Object.values(all).filter(t => Date.now() - (t.at || 0) < 540 * 86400000 && Date.now() - (t.checked || 0) > 20 * 3600000)
      .sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 40);
    const found = [];
    for (const t of due) {
      if (S.profile?.id !== pid) return;
      let r; try { r = await api('get_series_info', `&series_id=${t.id}`); } catch { continue; }
      const { max, maxEps } = seasonsOf(r?.episodes);
      if (!max) { t.checked = Date.now(); continue; }
      const news = store.get(newsKey(), {});
      if (!t.seed && max > (t.max || 0)) {
        news[t.id] = { id: t.id, name: t.name, icon: t.icon, type: 'season', season: max, at: Date.now() }; found.push(news[t.id]);
      } else if (!t.seed && max === t.max && maxEps > (t.maxEps || 0) && t.last && t.last.s === max && t.last.n >= (t.maxEps || 0)) {
        const was = news[t.id]?.type === 'eps' ? news[t.id].count : 0;
        news[t.id] = { id: t.id, name: t.name, icon: t.icon, type: 'eps', season: max, count: was + maxEps - (t.maxEps || 0), at: Date.now() }; found.push(news[t.id]);
      }
      store.set(newsKey(), news);
      Object.assign(t, { max: Math.max(t.max || 0, max), maxEps: max >= (t.max || 0) ? maxEps : t.maxEps, checked: Date.now(), seed: false });
      all[t.id] = t; store.set(trackKey(), all);
      await new Promise(r => setTimeout(r, 1200));                 // gently – one show at a time
    }
    if (found.length) { newsBadge(); newsNotify(); if (S.section === 'series') renderBrowse('series'); }
  } finally { newsBusy = false; setTimeout(() => newsCheck(), 6 * 3600000); }
}
function newsBadge() {
  const b = document.querySelector('.rail-btn[data-sec="series"]'); if (!b || !S.profile) return;
  const n = Object.keys(newsAll()).length;
  b.querySelector('.rail-badge')?.remove();
  if (n) b.insertAdjacentHTML('beforeend', `<span class="rail-badge" title="New seasons / episodes">${n}</span>`);
}
// a short note, once per new season / batch of episodes (on this device)
function newsNotify() {
  if (!S.profile) return;
  const news = store.get(newsKey(), {}), onShow = $('#newsPop').hidden ? [] : ($('#newsPop')._ids || []);
  const fresh = Object.values(news).filter(n => !n.told || onShow.includes(n.id)).sort((a, b) => b.at - a.at);
  if (!fresh.some(n => !n.told)) return;
  if (S.tvFull || $('#settings').open) { setTimeout(newsNotify, 60000); return; }       // not over the top of what you're watching
  fresh.forEach(n => { news[n.id].told = true; }); store.set(newsKey(), news);
  const one = fresh[0], box = $('#newsPop');
  box._ids = fresh.map(n => n.id);
  const title = fresh.length === 1 ? `${cleanTitle(one.name)}` : `${fresh.length} of your shows have something new`;
  const sub = fresh.length === 1 ? (one.type === 'season' ? `Season ${one.season} is out` : `${one.count} new episode${one.count === 1 ? '' : 's'} of season ${one.season}`) : fresh.slice(0, 3).map(n => `${cleanTitle(n.name)} – ${newsLabel(n).toLowerCase()}`).join(' · ');
  box.innerHTML = `${one.icon && fresh.length === 1 ? `<img src="${esc(one.icon)}" onerror="this.remove()">` : ''}<div class="np-in"><div class="np-k">NEW FOR YOU</div><div class="np-t">${esc(title)}</div><div class="np-s">${esc(sub)}</div>
    <div class="np-b"><button class="primary" data-np="go">${fresh.length === 1 ? 'Take a look' : 'Show me'}</button><button class="ghost" data-np="later">Later</button></div></div>`;
  box.hidden = false;
  const close = () => { box.hidden = true; clearTimeout(box._t); };
  box.onclick = e => { const b = e.target.closest('[data-np]'); if (!b) return; close();
    if (b.dataset.np === 'go') setSection('series').then(() => { if (fresh.length === 1) { const m = S.items.series.find(x => x.id === one.id); if (m) itemModal({ ...m, kind: 'series' }); } }); };
  clearTimeout(box._t); box._t = setTimeout(close, 15000);
}
window.__newsKey = k => { const b = $('#newsPop'); if (b.hidden) return false; if (k === 'back') { b.hidden = true; return true; } return false; };

function firstEpisode(eps) {
  const s = Object.keys(eps).sort((a, b) => a - b)[0]; if (!s || !eps[s].length) return null;
  return { ep: eps[s][0], season: s, from: 0 };
}
function nextEpisode(eps, w) {
  const seasons = Object.keys(eps).sort((a, b) => a - b);
  const si = seasons.indexOf(String(w.ep.season)); if (si < 0) return firstEpisode(eps);
  const list = eps[seasons[si]], k = list.findIndex(e => String(e.episode_num) === String(w.ep.num));
  if (!w.epDone && k >= 0) return { ep: list[k], season: seasons[si], from: w.pos };          // carry on with this one
  if (k >= 0 && list[k + 1]) return { ep: list[k + 1], season: seasons[si], from: 0 };       // next in the season
  if (seasons[si + 1] && eps[seasons[si + 1]].length) return { ep: eps[seasons[si + 1]][0], season: seasons[si + 1], from: 0 };
  return { ep: list[k] || list[0], season: seasons[si], from: 0 };
}
function closeFilmModal() { const b = $('#nfModal'); if (!b.hidden) { b.hidden = true; b.innerHTML = ''; document.querySelector('#nf .nf-card:focus, #nf .nf-card, #itemList li.on, #itemList li')?.focus?.(); } }
function playFilm(m, from) {
  $('#main').classList.add('film-play');          // the player takes over the window; Back / Esc returns
  if (TV) S.startFull = true;                      // TV: opens full screen as soon as it starts
  startItem({ ...m, kind: 'movie' }, streamUrl('movie', m.id, m.ext));
  S.current.playId = m.id;
  if (from > 0) resumeAt(m.id, from);
}
function playEpisode(show, e, season, from) {
  $('#main').classList.add('film-play');
  if (TV) S.startFull = true;
  const epInfo = { id: e.id, season: String(season), num: String(e.episode_num), title: e.title || '' };
  startItem({ kind: 'series', id: show.id, name: show.name, icon: show.icon, cat: show.cat }, streamUrl('series', e.id, e.container_extension), `${cleanTitle(show.name)} – S${season} E${e.episode_num}`);
  S.current.ep = epInfo; S.current.show = { id: show.id, name: show.name, icon: show.icon, cat: show.cat };
  S.current.playId = e.id;
  watchSave(S.current.show, Math.max(1, from || 1), 1e9, 'series', epInfo);       // so Continue watching shows it straight away
  seasonTrack(S.current.show, epInfo);
  if (from > 0) resumeAt(e.id, from);
}
function exitFilmPlay() {
  if (!$('#main').classList.contains('film-play')) return false;
  saveProgress();                                  // remember exactly where you stopped
  stopPlayer(); S.current = null; $('#main').classList.remove('film-play');
  msg('Pick a channel to start watching');
  if (S.section === 'movie' || S.section === 'series') renderBrowse(browseKind());     // refresh Continue watching
  else if (isSearch()) renderItems();
  setTimeout(() => document.querySelector('#nf .nf-card, #itemList li.on, #itemList li')?.focus(), 50);
  return true;
}
$('#nf').addEventListener('click', e => {
  const p = e.target.closest('[data-play]');
  if (p) {
    const m = NF.list[+p.dataset.play];
    if (m.kind === 'series') { itemModal(m); return; }
    const w = watchAll('movie')[m.id]; playFilm(m, w && !w.done && w.pos > 60 ? w.pos : 0); return;
  }
  const i = e.target.closest('[data-info]'); if (i) { itemModal(NF.list[+i.dataset.info]); return; }
  const more = e.target.closest('[data-cat]'); if (more) { $('#nfSearch').value = ''; showCategory(more.dataset.cat); return; }
  const c = e.target.closest('.nf-card[data-k]'); if (c) itemModal(NF.list[+c.dataset.k]);
});
function showCategory(cat) {
  const kind = browseKind(), d = browseData(kind), list = d.all.filter(m => m.cat === cat).sort((a, b) => (b.added || 0) - (a.added || 0));
  NF.list = list;
  $('#nf').innerHTML = `<div class="nf-top"><button class="nf-btn" id="nfBack">← ${kind === 'series' ? 'Series' : 'Films'}</button><h2>${esc(d.catName[cat] || '')}</h2></div>
    <div class="nf-grid">${list.map((m, k) => cardHtml(m, k)).join('')}</div>`;
  $('#nfBack').onclick = () => renderBrowse(kind);
  setTimeout(() => $('#nf .nf-card')?.focus(), 30);
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#nfModal').hidden) { closeFilmModal(); e.preventDefault(); return; }
  if (exitFilmPlay()) e.preventDefault();
});

$('#filmBack').onclick = () => exitFilmPlay();

/* ---------- Start-up: reconnect to the last playlist ---------- */
(function boot() {
  const d = prof.load(); renderSaved();
  const i = d.profiles.findIndex(x => x.id === d.last);
  if (d.autoConnect !== false && i >= 0) openProfile(d.profiles[i], $(`#saved [data-go="${i}"]`));   // splash stays up while it connects
  else showLogin();
})();
// phone turned / window resized: redraw the guide so its rows fit the new size
{ let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (S.section === 'guide' && S.profile && !document.documentElement.classList.contains('tv-full')) { const y = $('#gScroll').scrollTop; renderItems(); $('#gScroll').scrollTop = y; } }, 250); }); }
