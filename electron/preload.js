const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Window controls ──────────────────────────────────────────────
  minimize: ()         => ipcRenderer.send('win-minimize'),
  maximize: ()         => ipcRenderer.send('win-maximize'),
  close:    ()         => ipcRenderer.send('win-close'),
  quit:     ()         => ipcRenderer.send('win-quit'),
  onWindowState: (cb)  => ipcRenderer.on('window-state', (_, state) => cb(state)),

  // ── System settings ──────────────────────────────────────────────
  getAutoLaunch: ()        => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),

  // ── Mini call widget IPC ─────────────────────────────────────────
  callStart: (info) => ipcRenderer.send('call-start', info),
  callEnd:   ()     => ipcRenderer.send('call-end'),
  onCallAction: (cb) => {
    const handler = (_, data) => cb(data)
    ipcRenderer.on('call-action', handler)
    return () => ipcRenderer.removeListener('call-action', handler)
  },

  // ── Updates ──────────────────────────────────────────────────────
  getAppVersion:    ()  => ipcRenderer.invoke('get-app-version'),
  checkForUpdates:  ()  => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate:   ()  => ipcRenderer.invoke('download-update'),
  installUpdate:    ()  => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, info) => cb(info)),
  onUpdateProgress:  (cb) => ipcRenderer.on('update-progress',  (_, info) => cb(info)),
  onUpdateDownloaded:(cb) => ipcRenderer.on('update-downloaded', () => cb()),
})
