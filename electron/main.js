const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, Notification, screen } = require('electron')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

let mainWindow      = null
let callWidget      = null
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

// ── Window-state persistence ──────────────────────────────────────
// Remember the window position and size between launches (Mac convention,
// also nice to have on Windows). We store a small JSON file in the user's
// app-data directory and apply it on createWindow if the saved bounds
// still fit on the user's currently-attached displays.
const WINDOW_STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json')
const DEFAULT_BOUNDS = { width: 420, height: 720 }

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
    width:     savedBounds.width  || 420,
    height:    savedBounds.height || 720,
    x:         savedBounds.x,   // undefined falls back to OS default centering
    y:         savedBounds.y,
    minWidth:  380,
    minHeight: 580,
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
  mainWindow.once('ready-to-show', () => mainWindow.show())

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
// The React app fires this when Twilio reports an inbound call. We need to
// make sure the user notices even if BTI Voice is hidden / minimized to
// tray / on a different macOS Space.
ipcMain.on('incoming-call', (_, info) => {
  const fromNumber = info?.from || 'Unknown number'

  // 1. Bring BTI Voice to the front so the in-app Accept/Decline overlay is
  //    visible immediately. Without this, the user would have to manually
  //    open the app to answer.
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible())  mainWindow.show()
    mainWindow.focus()
  }

  // 2. Bounce the dock icon (Mac) or flash the taskbar (Windows) for
  //    extra attention if the user is in another app.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.bounce('critical')   // 'critical' bounces until user looks at the app
  } else if (process.platform === 'win32' && mainWindow) {
    mainWindow.flashFrame(true)
  }

  // 3. Native OS notification — appears top-right on Mac, bottom-right on
  //    Windows — visible regardless of which app is in focus.
  if (Notification.isSupported()) {
    const notif = new Notification({
      title: 'Incoming call',
      body:  fromNumber,
      icon:  ICON_PATH,
      silent: false,   // play default notification sound
    })
    notif.on('click', () => {
      mainWindow?.show()
      mainWindow?.focus()
    })
    notif.show()
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

// ── IPC: auto-launch ──────────────────────────────────────────────
ipcMain.handle('get-auto-launch', () => app.getLoginItemSettings().openAtLogin)
ipcMain.handle('set-auto-launch', (_, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled })
  return !!enabled
})

// ── IPC: updates (Railway proxy — no GitHub token needed in installer) ────────
ipcMain.handle('check-for-updates', async () => {
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
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'audioCapture', 'notifications']
    callback(allowed.includes(permission))
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowed = ['media', 'microphone', 'audioCapture', 'notifications']
    return allowed.includes(permission)
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
