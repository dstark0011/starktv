'use strict';
/* StarkTV on Android TV / Fire TV: gives the shared StarkTV page the same window.native API the PC app has,
   backed by the Android app (window.AndroidBridge) and its native video player. Loaded before app.js. */
(() => {
  const B = window.AndroidBridge; if (!B) return;
  document.documentElement.classList.add('tv');
  // phones / tablets: real phone-sized layout (portrait or landscape) instead of the TV's fixed 1280-wide screen
  let phone = /[?&]phone=1/.test(location.search);
  try { if (!phone && B.isTv) phone = !B.isTv(); } catch {}
  if (phone) {
    document.documentElement.classList.add('phone');
    const vp = document.querySelector('meta[name=viewport]');
    if (vp) vp.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover');
  }
  let stateCb = null, evCb = null;
  window.__nativeState = s => { try { stateCb && stateCb(s); } catch (e) { B.log('state cb: ' + e.message); } };
  window.__nativeEvent = e => { evCb && evCb(e); };
  const status = () => { try { return JSON.parse(B.status()); } catch { return null; } };
  window.native = {
    loadProfiles: () => { const s = B.loadProfiles(); try { return s ? JSON.parse(s) : null; } catch { return null; } },
    saveProfiles: d => B.saveProfiles(JSON.stringify(d)),
    log: line => B.log(String(line)),
    openExternal: async () => ({ ok: false, error: 'Not available on the TV.' }),
    vlc: {                                         // the "VLC" engine of the PC app = the TV's own player here
      play: async url => { B.play(url); return { ok: true }; },
      stop: async () => { B.stop(); return true; },
      cmd: async q => { if (/pl_pause/.test(q || '')) B.togglePause(); return status(); },
      bounds: r => B.setBounds(JSON.stringify({ x: r.x, y: r.y, w: r.w, h: r.h, vw: window.innerWidth })),
      visible: v => B.setVisible(!!v),
      // going full screen: hide the guide first and only stretch the picture once that's been drawn,
      // so the old screen never flashes over the full-screen video
      fullscreen: on => {
        if (!on) { B.setFullscreen(false); return; }
        document.documentElement.classList.add('tv-full');
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => B.setFullscreen(true), 16)));
      },
      onState: cb => { stateCb = cb; },
      onEvent: cb => { evCb = cb; }
    }
  };
  // show the full build number (e.g. v2.6.5) instead of just v2.6
  document.addEventListener('DOMContentLoaded', () => {
    let v = ''; try { v = B.version ? B.version() : ''; } catch {}
    if (v) document.querySelectorAll('.ver').forEach(el => { el.textContent = 'v' + v; });
    const sub = document.querySelector('#login .sub, .sub');
    if (sub && v) sub.insertAdjacentHTML('beforeend', ` <small style="opacity:.6">(v${v} · ${document.documentElement.classList.contains('phone') ? 'phone' : 'TV'} layout)</small>`);
  });
  window.addEventListener('error', e => B.log(`error: ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
})();
