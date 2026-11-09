'use strict';
/* Remote-control navigation: the arrow keys move focus to the nearest item in that direction, OK clicks it. */
(() => {
  if (!window.AndroidBridge) return;
  const SEL = [
    'button:not([disabled])', 'input', 'select', '.saved-row',
    '#catList li[data-id]', '#itemList li[data-idx]', '#itemList li[data-prog]', '#itemList li[data-more]',
    '#itemList li[data-allcats]', '#itemList li[data-allprogs]', '.ev-row', '.g-ch', '.g-prog', '.eps li', '.ctx button', '.nf-card', '.nf-btn', '.nf-epi', '.sg-item'
  ].join(',');
  const NATIVE = /^(BUTTON|INPUT|SELECT|A|TEXTAREA)$/;

  function visible(el) {
    if (el.closest('[hidden]') || el.closest('dialog:not([open])')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    // inside a scroller: must be at least partly within it (the guide grid, lists)
    const sc = el.closest('.list, .g-scroll, .np, .eps, .nf-scroll, .nf-eplist');
    if (sc) { const s = sc.getBoundingClientRect(); if (r.bottom < s.top - 1 || r.top > s.bottom + 1 || r.right < s.left || r.left > s.right) return false; }
    return getComputedStyle(el).visibility !== 'hidden';
  }
  function scope() {
    const dlg = document.querySelector('dialog[open]'); if (dlg) return dlg;
    const ctx = document.querySelector('.ctx:not([hidden])'); if (ctx) return ctx;
    const nfm = document.querySelector('.nf-modal:not([hidden])'); if (nfm) return nfm;
    return document;
  }
  function candidates() { return [...scope().querySelectorAll(SEL)].filter(visible); }
  function focusEl(el) {
    if (!el) return;
    if (!NATIVE.test(el.tagName) && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }
  window.__tvFocusDefault = () => {
    // a pop-up (series page, dialog, menu) is open: stay inside it – never fall back to the menu behind it
    const sc = scope();
    if (sc !== document) { const first = sc.querySelector('.nf-btn.play, .nf-seasons .on, .nf-epi.cur') || candidates()[0]; if (first) { focusEl(first); return; } }
    const pick = document.querySelector('#gInner .g-row.on .g-ch') || document.querySelector('#itemList li.on')
      || document.querySelector('.main:not([hidden]) .rail-btn.on') || candidates()[0];
    focusEl(pick);
  };

  const usable = el => !el.closest('[hidden]') && el.offsetParent !== null;
  // TV guide: up/down go to the next channel row (loading more rows if needed), never out of the grid
  function guideStep(cur, dir) {
    const row = cur.closest('.g-row'); if (!row) return false;
    let next = dir === 'down' ? row.nextElementSibling : row.previousElementSibling;
    while (next && !next.classList.contains('g-row')) next = dir === 'down' ? next.nextElementSibling : next.previousElementSibling;
    if (!next) {
      const more = dir === 'down' && document.querySelector('#gInner .g-more');
      if (more) focusEl(more);
      return true;                                  // top/bottom of the guide: stay put
    }
    let target = next.querySelector('.g-ch');
    if (cur.classList.contains('g-prog')) {         // keep roughly the same time column
      const x = cur.offsetLeft + Math.min(cur.offsetWidth / 2, 120);
      let best = null, bd = Infinity;
      for (const p of next.querySelectorAll('.g-prog')) {
        const d = x < p.offsetLeft ? p.offsetLeft - x : x > p.offsetLeft + p.offsetWidth ? x - (p.offsetLeft + p.offsetWidth) : 0;
        if (d < bd) { bd = d; best = p; }
      }
      if (best) target = best;
    }
    focusEl(target);
    return true;
  }
  // TV guide: left/right move along the same channel's programmes; left from the first one goes to the channel name
  function guideSide(cur, dir) {
    const row = cur.closest('.g-row'); if (!row) return false;
    const progs = [...row.querySelectorAll('.g-prog')];
    if (cur.classList.contains('g-ch')) {
      if (dir === 'left') return false;             // channel name → left goes to the categories as normal
      const edge = (document.getElementById('gScroll')?.scrollLeft || 0);
      const first = progs.find(p => (parseFloat(p.style.left) || 0) + (parseFloat(p.style.width) || 0) > edge + 270) || progs[0];
      if (first) focusEl(first);
      return true;                                  // programmes not loaded yet: stay on the channel
    }
    const i = progs.indexOf(cur); if (i < 0) return false;
    const next = progs[i + (dir === 'right' ? 1 : -1)];
    focusEl(next || (dir === 'left' ? row.querySelector('.g-ch') : null));
    return true;
  }
  // Films rows: left/right walk along the row; the end of a row stays put, the start goes left to the menu
  function rowSide(cur, dir) {
    const row = cur.closest('.nf-scroll'); if (!row) return false;
    const cards = [...row.querySelectorAll('.nf-card')];
    const i = cards.indexOf(cur); if (i < 0) return false;
    const next = cards[i + (dir === 'right' ? 1 : -1)];
    if (next) { focusEl(next); return true; }
    if (dir === 'left') { focusEl(document.querySelector('.rail-btn.on') || document.querySelector('.rail-btn')); return true; }
    return true;                                    // end of the row: stay put
  }
  // lists (categories, channels, search results): up/down stay inside the list, even past what's on screen
  function listStep(cur, dir) {
    const box = cur.closest('#catList, #itemList, .eps'); if (!box) return false;
    // lists run top to bottom, so the next/previous item in page order is the one below/above – no measuring needed
    const items = box.querySelectorAll(SEL);
    let i = Array.prototype.indexOf.call(items, cur); if (i < 0) return false;
    const step = dir === 'down' ? 1 : -1;
    for (i += step; i >= 0 && i < items.length; i += step) {
      if (usable(items[i])) { focusEl(items[i]); break; }
    }
    return true;                                    // end of the list: stay put instead of jumping elsewhere
  }

  function move(dir) {
    const cur = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    if (cur && cur.classList.contains('nf-loading')) return;          // Films / Series still loading: wait
    if (cur && (dir === 'up' || dir === 'down') && !document.querySelector('dialog[open], .ctx:not([hidden])')) {
      if (guideStep(cur, dir) || listStep(cur, dir)) return;
    }
    if (cur && (dir === 'left' || dir === 'right') && !document.querySelector('dialog[open], .ctx:not([hidden])')) {
      if (guideSide(cur, dir) || rowSide(cur, dir)) return;
    }
    // Films: up/down go to the nearest poster/button in the next row, even if that row is below the screen
    if (cur && (dir === 'up' || dir === 'down') && cur.closest('#nf') && !document.querySelector('.nf-modal:not([hidden]), dialog[open], .ctx:not([hidden])')) {
      const all = [...document.querySelectorAll('#nf .nf-card, #nf .nf-btn, #nf input')].filter(usable);
      const best = pick(cur, dir, all);
      if (best) focusEl(best);
      return;                                        // top / bottom of Films: stay put
    }
    const list = candidates();
    if (!cur || !list.includes(cur)) { window.__tvFocusDefault(); return; }
    const best = pick(cur, dir, list);
    if (best) focusEl(best);
    else {                                          // nothing visible that way: scroll the list/grid and try again
      const sc = cur.closest('.list, .g-scroll, .nf-scroll') || cur.closest('.nf');
      if (sc) {
        const dy = dir === 'down' ? 200 : dir === 'up' ? -200 : 0, dx = dir === 'right' ? 300 : dir === 'left' ? -300 : 0;
        const before = sc.scrollTop + sc.scrollLeft; sc.scrollBy(dx, dy);
        if (sc.scrollTop + sc.scrollLeft !== before) setTimeout(() => move(dir), 60);
      }
    }
  }

  function pick(cur, dir, list) {
    const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
      let main, cross, overlap;
      if (dir === 'left' || dir === 'right') {
        main = dir === 'right' ? b.left - a.right : a.left - b.right;
        if ((dir === 'right' ? bx <= ax + 1 : bx >= ax - 1)) continue;
        overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        cross = overlap > 0 ? 0 : Math.abs(by - ay);
      } else {
        main = dir === 'down' ? b.top - a.bottom : a.top - b.bottom;
        if ((dir === 'down' ? by <= ay + 1 : by >= ay - 1)) continue;
        overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        cross = overlap > 0 ? Math.abs(Math.max(a.left, b.left) - a.left) * 0.1 : Math.abs(bx - ax);
      }
      const score = Math.max(main, -8) + cross * 3;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  let lastMove = 0;
  document.addEventListener('keydown', e => {
    const dir = DIRS[e.key];
    const t = e.target;
    if (dir && e.repeat) {
      const now = performance.now();
      if (now - lastMove < 90) { e.preventDefault(); e.stopPropagation(); return; }
      lastMove = now;
    } else if (dir) lastMove = performance.now();
    if (dir) {
      // typing in a text box: left/right move the cursor until it reaches the end
      if (t.matches && t.matches('input[type=text], input:not([type]), input[type=password], input[type=search]')) {
        const v = t.value || '', s = t.selectionStart, en = t.selectionEnd;
        if ((dir === 'left' && s > 0) || (dir === 'right' && en < v.length)) return;
      }
      if (t.matches && t.matches('select')) return;
      e.preventDefault(); e.stopPropagation();
      move(dir);
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && t && t !== document.body && !NATIVE.test(t.tagName)) {
      e.preventDefault(); e.stopPropagation();
      if (e.repeat || holdT) return;
      held = false; holdEl = t;
      holdT = setTimeout(() => { held = true; window.__tvMenu && window.__tvMenu(); }, 650);
    }
  }, true);
  // a quick press of OK clicks; holding it opens the menu (Add to favourites…)
  let holdT = null, held = false, holdEl = null;
  document.addEventListener('keyup', e => {
    if ((e.key !== 'Enter' && e.key !== ' ') || !holdT) return;
    e.preventDefault(); clearTimeout(holdT); holdT = null;
    if (!held && holdEl && holdEl === document.activeElement) holdEl.click();
  }, true);

  // first focus once something is on screen
  const start = () => {
    if (document.documentElement.classList.contains('phone')) return;      // touch screens: no remote-control highlight
    if (!document.activeElement || document.activeElement === document.body) window.__tvFocusDefault();
  };
  window.addEventListener('load', () => setTimeout(start, 400));
  new MutationObserver(() => { if (!document.activeElement || document.activeElement === document.body) setTimeout(start, 50); })
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
})();
