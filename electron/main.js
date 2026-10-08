const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, Notification, screen, shell } = require('electron')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

let mainWindow      = null
let callWidget      = null
let incomingBanner  = null   // Floating Accept/Decline banner shown on inbound call
let tray            = null
let pendingUpdateInfo = null   // Stores { version, downloadUrl } when an update is found

// ── Single instance lock ──────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png')
const TRAY_PATH = path.join(__dirname, 'assets', 'tray.png')

// ── Your Railway URL ──────────────────────────────────────────────
const APP_URL = 'https://bti-voice-production.up.railway.app'

// Windows shows toast notifications under an "Application User Model ID".
// It must match the appId electron-builder stamps on the Start-menu shortcut
// (package.json → build.appId) or Windows drops the toast / shows it nameless.
if (process.platform === 'win32') app.setAppUserModelId('com.businesstechnologyinsight.bti-voice')

// Crash safety: the app lives in the tray all day taking calls — a stray
// error in the main process shouldn't kill it with a raw dialog.
process.on('uncaughtException',  (err)    => console.error('[uncaughtException]', err))
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason))

// ── Window-state persistence ──────────────────────────────────────
// Remember the window position and size between launches (Mac convention,
// also nice to have on Windows). We store a small JSON file in the user's
// app-data directory and apply it on createWindow if the saved bounds
// still fit on the user's currently-attached displays.
const WINDOW_STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json')
const DEFAULT_BOUNDS = { width: 470, height: 805 } // Danny's preferred default (2026-08-18)

// ── App preferences (small JSON next to window-state.json) ────────
// keepOnTop (Danny, 2026-10-08): the main window stays above other apps
// unless you minimize it — like a softphone. Default ON; Settings → Startup
// & window has the switch for anyone who doesn't want that.
const PREFS_FILE = () => path.join(app.getPath('userData'), 'prefs.json')
const DEFAULT_PREFS = { keepOnTop: true }
function loadPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(fs.readFileSync(PREFS_FILE(), 'utf8')) } }
  catch { return { ...DEFAULT_PREFS } }
}
function savePrefs(p) {
  try { fs.writeFileSync(PREFS_FILE(), JSON.stringify(p)) } catch (_) { /* not worth crashing */ }
}
function applyKeepOnTop(on) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  // Plain 'floating' level: above normal app windows, but the incoming-call
  // banner and call widget (screen-saver level on Mac) still sit above us.
  mainWindow.setAlwaysOnTop(!!on, 'floating')
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(WINDOW_STATE_FILE(), 'utf8')
    const saved = JSON.parse(raw)
    // Sanity-check that the saved position is on a currently-attached display,
    // otherwise the window could open offscreen if the user unplugged a monitor.
    const onScreen = screen.getAllDisplays().some(d => {
      const b = d.bounds
      return saved.x >= b.x && saved.y >= b.y &&
             saved.x + saved.width  <= b.x + b.width &&
             saved.y + saved.height <= b.y + b.height
    })
    if (!onScreen) return DEFAULT_BOUNDS
    return saved
  } catch {
    return DEFAULT_BOUNDS
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    // getNormalBounds gives the un-maximized, un-fullscreen bounds — we
    // don't want to restore as fullscreen if user closed in fullscreen.
    const bounds = mainWindow.getNormalBounds
      ? mainWindow.getNormalBounds()
      : mainWindow.getBounds()
    fs.writeFileSync(WINDOW_STATE_FILE(), JSON.stringify(bounds))
  } catch (_) { /* swallow — disk full / permission, not worth crashing */ }
}

// ── Main window ───────────────────────────────────────────────────
function createWindow() {
  // Platform-specific window chrome:
  // - macOS: hide the title bar but keep native traffic lights (close/min/max in top-left)
  // - Windows/Linux: fully frameless; the React app draws its own title bar + controls
  const chrome = process.platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 12 } }
    : { frame: false }

  // Restore previous window position/size if we have one on disk
  const savedBounds = loadWindowState()

  mainWindow = new BrowserWindow({
    width:     savedBounds.width  || DEFAULT_BOUNDS.width,
    height:    savedBounds.height || DEFAULT_BOUNDS.height,
    x:         savedBounds.x,   // undefined falls back to OS default centering
    y:         savedBounds.y,
    minWidth:  330,
    minHeight: 560,
    ...chrome,
    backgroundColor: '#0f172a',
    icon: ICON_PATH,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.loadURL(APP_URL)
  mainWindow.once('ready-to-show', () => { mainWindow.show(); applyKeepOnTop(loadPrefs().keepOnTop) })

  // Security: never let a link inside the remote page open a new Electron
  // window (which would inherit the preload + full electronAPI) or navigate
  // the main window off our own origin. External links open in the real browser.
  const APP_ORIGIN = new URL(APP_URL).origin
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try { shell.openExternal(url) } catch { /* ignore */ }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    let origin = ''
    try { origin = new URL(url).origin } catch { /* ignore */ }
    if (origin !== APP_ORIGIN) {
      e.preventDefault()
      try { shell.openExternal(url) } catch { /* ignore */ }
    }
  })

  // Offline / failed-load recovery: the UI is remote, so a launch with no
  // network otherwise leaves a dead Chromium error page with no way back.
  mainWindow.webContents.on('did-fail-load', (e, code, desc, validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted */) return
    console.error('[load] failed:', code, desc)
    // NOTE: the data: URL MUST declare charset=utf-8 (and the page a <meta
    // charset>) — without it Chromium decodes the percent-encoded UTF-8 as
    // Latin-1 and the apostrophe renders as "â€™".
    const isMac = process.platform === 'darwin'
    const retryHtml = 'data:text/html;charset=utf-8,' + encodeURIComponent(
      '<!doctype html><html><head><meta charset="utf-8"><title>BTI Voice</title></head>' +
      '<body style="background:#161b24;color:#e6eaf1;font-family:-apple-system,Segoe UI,sans-serif;' +
      'display:flex;flex-direction:column;height:100vh;margin:0;border:1px solid rgba(255,255,255,0.08);border-radius:8px;box-sizing:border-box;overflow:hidden">' +
      // Title strip: drag handle + window controls, matching the React TitleBar.
      // On macOS the OS draws the traffic lights, so only reserve space there.
      '<div style="height:38px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;' +
      'padding:0 4px 0 10px;background:#1d2330;border-bottom:1px solid rgba(255,255,255,0.07);-webkit-app-region:drag;user-select:none">' +
      (isMac
        ? '<div style="width:78px"></div>'
        : '<span style="font-size:11px;font-weight:700;letter-spacing:.5px;color:rgba(255,255,255,0.85)">BTI Voice</span>') +
      (isMac ? '<div></div>' :
        '<div style="display:flex;gap:1px;-webkit-app-region:no-drag">' +
        '<button title="Minimize" onclick="window.electronAPI&&electronAPI.minimize()" style="width:30px;height:28px;border:none;background:transparent;color:rgba(255,255,255,0.45);cursor:pointer;border-radius:4px;font-size:14px">&#8211;</button>' +
        '<button title="Minimize to tray" onclick="window.electronAPI&&electronAPI.close()" style="width:30px;height:28px;border:none;background:transparent;color:rgba(255,255,255,0.45);cursor:pointer;border-radius:4px;font-size:16px">&#215;</button>' +
        '</div>') +
      '</div>' +
      '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 24px">' +
      '<h2 style="margin:0 0 6px">Can\u2019t reach BTI Voice</h2>' +
      '<p style="margin:0 0 18px;color:rgba(255,255,255,0.6)">Check your internet connection.<br>' +
      '<span style="font-size:12px">We\u2019ll reconnect automatically as soon as it\u2019s back.</span></p>' +
      '<button onclick="retry()" ' +
      'style="padding:10px 22px;border:none;border-radius:8px;background:#4f9cf9;color:#fff;font-size:14px;font-weight:600;cursor:pointer">Retry</button>' +
      '<p style="margin:22px 0 0;font-size:12px;color:rgba(255,255,255,0.35)">To quit completely, right-click the BTI Voice icon in the system tray and choose Quit.</p>' +
      '</div>' +
      '<script>' +
      'var URL_=' + JSON.stringify(APP_URL) + ';' +
      'function retry(){location.href=URL_}' +
      // Auto-retry: probe the server first so we only navigate once it is
      // actually reachable (navigating blindly would flash the error page
      // every few seconds). Probe on the OS "online" event and every 5s.
      'var probing=false;' +
      'function probe(){if(probing)return;probing=true;' +
      'fetch(URL_+"/api/health?"+Date.now(),{mode:"no-cors",cache:"no-store"}).then(retry).catch(function(){}).finally(function(){probing=false})}' +
      'window.addEventListener("online",probe);' +
      'setInterval(probe,5000);' +
      '</script></body></html>')
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(retryHtml) }, 800)
  })

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      saveWindowState()   // persist position before hiding
      mainWindow.hide()
      // On macOS, hiding the window when its close button is clicked is the
      // expected behavior (Mail, Messages, Slack all do this). The notification
      // would just be noise. Show it on Windows where users expect close-to-X
      // to actually close the app.
      if (process.platform !== 'darwin' && Notification.isSupported()) {
        new Notification({
          title: 'BTI Voice',
          body:  'Running in the background. Click the tray icon to reopen.',
          icon:  ICON_PATH,
        }).show()
      }
    }
  })

  // Persist position/size as the user moves or resizes (debounced via resize-end on most OSes)
  mainWindow.on('resize', saveWindowState)
  mainWindow.on('move',   saveWindowState)

  mainWindow.on('maximize',   () => mainWindow.webContents.send('window-state', { maximized: true  }))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state', { maximized: false }))

  // Native right-click context menu on text selections + editable fields
  // so Mac users get Cut/Copy/Paste/Select All in input boxes.
  mainWindow.webContents.on('context-menu', (_, params) => {
    const items = []
    if (params.selectionText) {
      items.push({ role: 'copy' })
    }
    if (params.isEditable) {
      if (params.selectionText) items.push({ role: 'cut' })
      items.push({ role: 'paste' })
      items.push({ type: 'separator' })
      items.push({ role: 'selectAll' })
    }
    if (items.length) {
      Menu.buildFromTemplate(items).popup({ window: mainWindow })
    }
  })
}

// ── Mini call widget ──────────────────────────────────────────────
// A small always-on-top floating window shown during active calls.
// Positioned in the top-right corner of the primary display.
function createCallWidget() {
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize

  callWidget = new BrowserWindow({
    width:       315,
    height:      115,
    x:           sw - 330,   // 15px from right edge
    y:           14,
    frame:       false,
    alwaysOnTop: true,
    resizable:   false,
    movable:     true,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: '#0f1e35',
    hasShadow:   true,
    show:        false,
    webPreferences: {
      preload:          path.join(__dirname, 'widget-preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
    },
  })

  callWidget.loadFile(path.join(__dirname, 'call-widget.html'))

  // ── macOS: keep the widget visible over fullscreen apps and all Spaces ──
  // On Mac, the default "alwaysOnTop" level only beats other normal app
  // windows. To stay visible while the user is in a fullscreen app
  // (e.g. Zoom, Keynote, full-screen Safari) or on a different Space, we
  // need to bump the level and explicitly opt into all-workspaces visibility.
  if (process.platform === 'darwin') {
    callWidget.setAlwaysOnTop(true, 'screen-saver')
    callWidget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  callWidget.on('closed', () => { callWidget = null })
}

// ── Incoming-call banner ──────────────────────────────────────────
// A floating, always-on-top window with Accept/Decline buttons that pops
// up in the top-right when an inbound call arrives. Mirrors the call-widget
// pattern but for the *pre-answer* phase. Stays visible across Spaces and
// over fullscreen apps on macOS so the user can answer no matter what
// they're doing.
function createIncomingBanner() {
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize

  incomingBanner = new BrowserWindow({
    width:       340,
    height:      145,
    x:           sw - 355,   // 15px from right edge
    y:           14,
    frame:       false,
    alwaysOnTop: true,
    resizable:   false,
    movable:     true,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: '#0f1e35',
    hasShadow:   true,
    show:        false,
    focusable:   true,    // need to be focusable so button clicks register reliably on Mac
    webPreferences: {
      preload:          path.join(__dirname, 'banner-preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
    },
  })

  incomingBanner.loadFile(path.join(__dirname, 'incoming-banner.html'))

  // Same Mac visibility tricks as the call widget — the banner is useless
  // if it's hidden behind a fullscreen Zoom call.
  if (process.platform === 'darwin') {
    incomingBanner.setAlwaysOnTop(true, 'screen-saver')
    incomingBanner.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  incomingBanner.on('closed', () => { incomingBanner = null })
}

// ── Tray (Mac: menu-bar status icon. Windows: system tray icon) ───
function createTray() {
  const img  = nativeImage.createFromPath(TRAY_PATH)
  const icon = img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 })

  tray = new Tray(icon)
  tray.setToolTip('BTI Voice')

  // "Settings…" reuses the same IPC the app menu uses, so picking it from
  // any entry point (menu, status icon, Cmd+,) drops the user on the
  // Settings tab.
  const openSettings = () => {
    if (!mainWindow) return
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('open-settings')
  }

  const menu = Menu.buildFromTemplate([
    { label: 'Open BTI Voice', click: () => { mainWindow.show(); mainWindow.focus() } },
    { label: 'Settings…',      click: openSettings,
      accelerator: process.platform === 'darwin' ? 'Cmd+,' : undefined },
    { type: 'separator' },
    { label: 'Quit',           click: () => { app.isQuitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)

  tray.on('click',        () => { mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show() })
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus() })
}

// ── Application menu (top-of-screen on macOS) ─────────────────────
// On Windows, our custom React title bar replaces the menu — set it to null.
// On macOS, build the standard set Mac users expect: app/File/Edit/View/Window.
// Without an Edit menu, Cmd+C / Cmd+V / Cmd+A in text fields stop working in
// Electron because there's no global accelerator wired to them.
function buildAppMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  const openSettings = () => {
    if (!mainWindow) return
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('open-settings')
  }

  const template = [
    {
      label: app.name,                            // "BTI Voice"
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: openSettings },
        { type: 'separator' },
        { role: 'hide' },                         // Cmd+H
        { role: 'hideOthers' },                   // Opt+Cmd+H
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: `Quit ${app.name}`,
          accelerator: 'Cmd+Q',
          click: () => { app.isQuitting = true; app.quit() },
        },
      ],
    },
    {
      label: 'File',
      submenu: [
        // Mac convention: Cmd+W closes the active window. We still hide-to-tray.
        { label: 'Close Window', accelerator: 'Cmd+W', click: () => mainWindow?.hide() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'Cmd+R', click: () => mainWindow?.reload() },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },                     // Cmd+M
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── IPC: incoming-call alert ──────────────────────────────────────
// The React app fires this when Twilio reports an inbound call. We pop a
// custom always-on-top floating banner with Accept/Decline buttons (like
// FaceTime / Slack calls) so the user can answer without bringing the
// whole app to the front. We also bounce the dock / flash the taskbar
// for peripheral attention.
ipcMain.on('incoming-call', (_, info) => {
  // Bounce the dock icon (Mac) or flash the taskbar (Windows) for
  // peripheral attention without stealing focus.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.bounce('critical')   // bounces until user looks at the app
  } else if (process.platform === 'win32' && mainWindow) {
    mainWindow.flashFrame(true)
  }

  // Lazy-create the banner the first time we need it. Reuse on subsequent
  // calls so we don't pay the BrowserWindow startup cost on every ring.
  if (!incomingBanner || incomingBanner.isDestroyed()) {
    createIncomingBanner()
  }

  const sendShow = () => {
    if (!incomingBanner || incomingBanner.isDestroyed()) return
    incomingBanner.webContents.send('incoming-banner-show', info || {})
    // showInactive() pops the window forward without stealing keyboard focus
    // from whatever app the user is in — same trick FaceTime uses.
    incomingBanner.showInactive()
  }

  if (incomingBanner.webContents.isLoading()) {
    incomingBanner.webContents.once('did-finish-load', sendShow)
  } else {
    sendShow()
  }
})

// Banner button (Accept / Decline) was clicked → forward the action to
// the React app, which knows how to call incomingCall.accept() / .reject().
//
// IMPORTANT: We use webContents.executeJavaScript with `userGesture: true`
// rather than webContents.send. Twilio Voice's call.accept() needs to run
// inside a user-gesture context to unblock WebRTC audio (autoplay policy).
// IPC events (webContents.send) don't carry user-gesture context, so the
// audio setup silently fails and the call appears to "do nothing" even
// though .accept() was called. executeJavaScript with userGesture=true
// makes the dispatched call equivalent to a real button click in the
// renderer.
ipcMain.on('incoming-banner-action', (_, data) => {
  // Hide the banner immediately so it doesn't linger after the click
  if (incomingBanner && !incomingBanner.isDestroyed()) {
    incomingBanner.hide()
  }
  // Stop the dock bounce / taskbar flash now that the user has responded
  if (process.platform === 'win32' && mainWindow) mainWindow.flashFrame(false)

  if (mainWindow && !mainWindow.isDestroyed()) {
    const payload = JSON.stringify(data)
    const code = `window.__btiOnIncomingCallAction && window.__btiOnIncomingCallAction(${payload})`
    mainWindow.webContents
      .executeJavaScript(code, true /* userGesture */)
      .catch(err => console.error('[banner] forward action failed:', err))
  }
})

// React app fires this when the call is gone for any reason (caller
// cancelled, agent answered/declined via the in-app overlay instead, etc.)
// so we can hide the floating banner.
ipcMain.on('incoming-call-dismiss', () => {
  if (incomingBanner && !incomingBanner.isDestroyed()) {
    incomingBanner.hide()
  }
  if (process.platform === 'win32' && mainWindow) mainWindow.flashFrame(false)
})

// ── IPC: desktop notifications (1.6.0) ────────────────────────────
// The React app decides WHETHER to notify (who it's for, is that thread already
// open, user's Settings → Sound toggles); we just show it natively and, on
// click, bring the window back and tell the app where to go.
function showWindowFromNotification() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}
ipcMain.on('desktop-notify', (_, info) => {
  if (!Notification.isSupported()) return
  const i = info || {}
  const title = String(i.title || 'BTI Voice').slice(0, 120)
  const body  = String(i.body  || '').slice(0, 300)
  try {
    const n = new Notification({ title, body, icon: ICON_PATH, silent: !!i.silent })
    n.on('click', () => {
      showWindowFromNotification()
      mainWindow?.webContents.send('notification-click', i.nav || null)
    })
    n.show()
  } catch (e) {
    console.error('[notify]', e.message)
  }
})

// ── IPC: dock badge (Mac only — no-op elsewhere) ──────────────────
// React app calls electronAPI.setUnreadCount(n) whenever the total unread
// count (SMS + voicemails + notifications) changes. We surface that as a
// red badge on the dock icon, matching how Mail and Messages work.
ipcMain.on('set-unread-count', (_, count) => {
  if (process.platform !== 'darwin' || !app.dock) return
  const n = Number(count) || 0
  app.dock.setBadge(n > 0 ? String(n) : '')
})

// ── IPC: window controls ──────────────────────────────────────────
ipcMain.on('win-minimize', () => mainWindow?.minimize())
ipcMain.on('win-maximize', () => {
  if (!mainWindow) return
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.on('win-close', () => mainWindow?.hide())
ipcMain.on('win-quit',  () => { app.isQuitting = true; app.quit() })

// ── IPC: UI density / zoom ────────────────────────────────────────
ipcMain.on('set-zoom', (_, { factor, width, height }) => {
  if (!mainWindow) return
  mainWindow.webContents.setZoomFactor(factor)
  mainWindow.setSize(width, height)
  mainWindow.setMinimumSize(Math.round(width * 0.85), Math.round(height * 0.85))
})

// ── IPC: keep on top ──────────────────────────────────────────────
ipcMain.handle('get-keep-on-top', () => loadPrefs().keepOnTop)
ipcMain.handle('set-keep-on-top', (_, enabled) => {
  const prefs = loadPrefs()
  prefs.keepOnTop = !!enabled
  savePrefs(prefs)
  applyKeepOnTop(prefs.keepOnTop)
  return prefs.keepOnTop
})

// ── IPC: auto-launch ──────────────────────────────────────────────
ipcMain.handle('get-auto-launch', () => app.getLoginItemSettings().openAtLogin)
ipcMain.handle('set-auto-launch', (_, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled })
  return !!enabled
})

// ── IPC: updates (Railway proxy — no GitHub token needed in installer) ────────
ipcMain.handle('check-for-updates', async () => {
  // Updates are Windows-only: the update feed serves a Windows .exe. On macOS
  // this would download an installer that can't run, so report up-to-date.
  if (process.platform !== 'win32') return { status: 'up-to-date' }
  try {
    const res = await fetch(`${APP_URL}/api/updates/latest`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (data.error) throw new Error(data.error)

    const current = app.getVersion()
    const latest  = data.version
    if (!latest) throw new Error('No version in response')

    // Simple semver compare (major.minor.patch)
    const toNum = v => v.split('.').map(Number)
    const [ma, mi, pa] = toNum(latest)
    const [ca, ci, cp] = toNum(current)
    const isNewer = ma > ca || (ma === ca && mi > ci) || (ma === ca && mi === ci && pa > cp)
    if (!isNewer) return { status: 'up-to-date' }

    pendingUpdateInfo = data   // Save { version, downloadUrl }
    return { status: 'available', version: latest }
  } catch (e) {
    console.error('[updater] check error:', e.message)
    return { status: 'error', message: e.message }
  }
})

ipcMain.handle('download-update', async () => {
  if (process.platform !== 'win32') return { status: 'error', message: 'Updates are Windows-only' }
  const tempPath = path.join(os.tmpdir(), 'BTI-Voice-Setup.exe')

  try {
    // Step 1: Ask the server to resolve the signed S3 download URL.
    // The GitHub token stays server-side; we only get back a time-limited S3 URL.
    const urlRes = await fetch(`${APP_URL}/api/updates/download-url`)
    if (!urlRes.ok) throw new Error(`Could not resolve download URL: ${urlRes.status}`)
    const { url: s3Url, size } = await urlRes.json()
    if (!s3Url) throw new Error('Server returned no download URL')

    // Step 2: Download directly from S3 — no auth header needed (credentials
    // are embedded in the signed URL query string). This avoids Railway timeouts.
    const res = await fetch(s3Url)
    if (!res.ok) throw new Error(`S3 download failed: ${res.status}`)

    const total      = size || parseInt(res.headers.get('content-length') || '0', 10)
    let   downloaded = 0
    const chunks     = []
    const reader     = res.body.getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      downloaded += value.length
      if (total > 0) {
        mainWindow?.webContents.send('update-progress', {
          percent: Math.round((downloaded / total) * 100),
        })
      }
    }

    fs.writeFileSync(tempPath, Buffer.concat(chunks.map(c => Buffer.from(c))))
    mainWindow?.webContents.send('update-downloaded')
    return true
  } catch (e) {
    console.error('[updater] download error:', e.message)
    mainWindow?.webContents.send('update-error', { message: e.message })
    return false
  }
})

ipcMain.handle('install-update', () => {
  if (process.platform !== 'win32') return false
  const tempPath = path.join(os.tmpdir(), 'BTI-Voice-Setup.exe')
  if (!fs.existsSync(tempPath)) return false
  const { exec } = require('child_process')
  app.isQuitting = true
  exec(`"${tempPath}"`)   // Launch installer, let it handle the upgrade
  setTimeout(() => app.quit(), 1500)
  return true
})

ipcMain.handle('get-app-version', () => app.getVersion())

// ── IPC: call widget control ──────────────────────────────────────

// React app signals a call has started → show/create the mini widget
ipcMain.on('call-start', (_, info) => {
  if (!callWidget || callWidget.isDestroyed()) {
    createCallWidget()
  }
  // Wait for widget to finish loading before sending the event
  const sendInfo = () => {
    callWidget.webContents.send('call-started', info || {})
    callWidget.show()
  }
  if (callWidget.webContents.isLoading()) {
    callWidget.webContents.once('did-finish-load', sendInfo)
  } else {
    sendInfo()
  }
})

// React app signals call ended → hide the widget
ipcMain.on('call-end', () => {
  if (callWidget && !callWidget.isDestroyed()) {
    callWidget.webContents.send('call-ended')
    setTimeout(() => {
      if (callWidget && !callWidget.isDestroyed()) callWidget.hide()
    }, 600)
  }
})

// Mini widget button was clicked → forward the action to the main React window
ipcMain.on('call-widget-action', (_, data) => {
  const { action } = data

  if (action === 'open') {
    // Bring main window to front
    mainWindow?.show()
    mainWindow?.focus()
    return
  }

  // Forward all other actions (mute, hold, hangup) to the React app
  mainWindow?.webContents.send('call-action', data)
})

// ── App lifecycle ─────────────────────────────────────────────────
app.whenReady().then(() => {
  // Grant microphone + camera permissions automatically so Twilio Voice
  // (WebRTC) can register and receive/make calls without a browser prompt.
  const { session } = require('electron')
  const APP_ORIGIN = new URL(APP_URL).origin
  const isAppOrigin = (wc) => {
    try { return wc && new URL(wc.getURL()).origin === APP_ORIGIN } catch { return false }
  }
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'audioCapture', 'notifications']
    // Only our own remote origin may use the mic — a phished/injected page can't.
    callback(allowed.includes(permission) && isAppOrigin(webContents))
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const allowed = ['media', 'microphone', 'audioCapture', 'notifications']
    return allowed.includes(permission) && requestingOrigin === APP_ORIGIN
  })

  createWindow()
  createTray()
  buildAppMenu()

  // Block native Ctrl+/- keyboard zoom — app uses its own density setting
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && (input.key === '=' || input.key === '+' || input.key === '-' || input.key === '0')) {
      event.preventDefault()
    }
  })

  // Auto-check for updates 10 seconds after launch (gives the app time to load)
  setTimeout(async () => {
    try {
      const res  = await fetch(`${APP_URL}/api/updates/latest`)
      if (!res.ok) return
      const data = await res.json()
      if (!data.version) return
      const toNum  = v => v.split('.').map(Number)
      const [ma, mi, pa] = toNum(data.version)
      const [ca, ci, cp] = toNum(app.getVersion())
      const isNewer = ma > ca || (ma === ca && mi > ci) || (ma === ca && mi === ci && pa > cp)
      if (isNewer) {
        pendingUpdateInfo = data
        mainWindow?.webContents.send('update-available', { version: data.version })
      }
    } catch (_) { /* silent on startup */ }
  }, 10000)
})

app.on('window-all-closed', () => { /* stay in tray */ })
app.on('activate',          () => { mainWindow?.show(); mainWindow?.focus() })
app.on('before-quit',       () => { app.isQuitting = true })
