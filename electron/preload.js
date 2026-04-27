const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Platform detection ───────────────────────────────────────────
  // 'darwin' = macOS, 'win32' = Windows, 'linux' = Linux
  platform: process.platform,

  // ── Window controls ──────────────────────────────────────────────
  minimize: ()         => ipcRenderer.send('win-minimize'),
  maximize: ()         => ipcRenderer.send('win-maximize'),
  close:    ()         => ipcRenderer.send('win-close'),
  quit:     ()         => ipcRenderer.send('win-quit'),
  onWindowState: (cb)  => ipcRenderer.on('window-state', (_, state) => cb(state)),

  // ── System settings ──────────────────────────────────────────────
  getAutoLaunch: ()        => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),

  // ── UI density / zoom ────────────────────────────────────────────
  setZoom: (factor, width, height) => ipcRenderer.send('set-zoom', { factor, width, height }),

  // ── Mini call widget IPC ─────────────────────────────────────────
  callStart: (info) => ipcRenderer.send('call-start', info),
  callEnd:   ()     => ipcRenderer.send('call-end'),

  // Fired when Twilio reports an incoming call. The main process responds
  // by bouncing the dock icon (Mac) / flashing the taskbar (Windows) and
  // popping a custom floating banner with Accept/Decline buttons.
  notifyIncomingCall: (info) => ipcRenderer.send('incoming-call', info),

  // Tell main to hide the floating banner — used when the caller hangs up
  // before the agent answers, or when the agent answers/declines via the
  // in-app overlay instead of the banner.
  dismissIncomingCall: () => ipcRenderer.send('incoming-call-dismiss'),

  // NOTE: Banner Accept/Decline button forwarding is intentionally NOT done
  // via IPC. Main process uses webContents.executeJavaScript(..., true) to
  // invoke window.__btiOnIncomingCallAction directly — this preserves the
  // user-gesture context Twilio Voice needs to unblock WebRTC audio setup.

  onCallAction: (cb) => {
    const handler = (_, data) => cb(data)
    ipcRenderer.on('call-action', handler)
    return () => ipcRenderer.removeListener('call-action', handler)
  },

  // ── Mac dock badge / menu integration ────────────────────────────
  // Tells the main process the current total unread count. On macOS this
  // is shown as a red badge on the dock icon (Mail-style). No-op on Windows.
  setUnreadCount: (count) => ipcRenderer.send('set-unread-count', count),

  // Fired when the user picks "Settings…" from the macOS app menu (Cmd+,)
  // or the menu-bar status icon. The React app should switch to the
  // settings tab in response. Returns a cleanup function to remove the listener.
  onOpenSettings: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('open-settings', handler)
    return () => ipcRenderer.removeListener('open-settings', handler)
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
