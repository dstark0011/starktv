const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('native', {
  openExternal: (url, title, custom) => ipcRenderer.invoke('open-external-player', url, title, custom),
  loadProfiles: () => ipcRenderer.sendSync('profiles-load'),
  saveProfiles: data => ipcRenderer.sendSync('profiles-save', data),
  menu: items => ipcRenderer.invoke('ctx-menu', items),
  log: line => ipcRenderer.send('log', String(line)),
  onPlayerStatus: cb => ipcRenderer.on('player-status', (_e, t) => cb(t)),
  version: () => ipcRenderer.sendSync('app-version'),
  openLink: url => ipcRenderer.invoke('open-link', url),
  liveOptions: o => ipcRenderer.send('live-opts', o),
  liveOpen: url => ipcRenderer.invoke('live-open', url),
  liveClose: () => ipcRenderer.send('live-close'),
  vlc: {
    play: url => ipcRenderer.invoke('vlc-play', url),
    stop: () => ipcRenderer.invoke('vlc-stop'),
    cmd: q => ipcRenderer.invoke('vlc-cmd', q),
    bounds: r => ipcRenderer.send('vlc-bounds', r),
    visible: v => ipcRenderer.send('vlc-visible', v),
    onState: cb => ipcRenderer.on('vlc-state', (_e, s) => cb(s)),
    onEvent: cb => ipcRenderer.on('vlc-event', (_e, s) => cb(s))
  }
});
