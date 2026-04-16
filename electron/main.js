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

// ── Main window ───────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:     420,
    height:    720,
    minWidth:  380,
    minHeight: 580,
    frame: false,
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
      mainWindow.hide()
      if (Notification.isSupported()) {
        new Notification({
          title: 'BTI Voice',
          body:  'Running in the background. Click the tray icon to reopen.',
          icon:  ICON_PATH,
        }).show()
      }
    }
  })

  mainWindow.on('maximize',   () => mainWindow.webContents.send('window-state', { maximized: true  }))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state', { maximized: false }))
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

  callWidget.on('closed', () => { callWidget = null })
}

// ── Tray ──────────────────────────────────────────────────────────
function createTray() {
  const img  = nativeImage.createFromPath(TRAY_PATH)
  const icon = img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 })

  tray = new Tray(icon)
  tray.setToolTip('BTI Voice')

  const menu = Menu.buildFromTemplate([
    { label: 'Open BTI Voice', click: () => { mainWindow.show(); mainWindow.focus() } },
    { type: 'separator' },
    { label: 'Quit',           click: () => { app.isQuitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)

  tray.on('click',        () => { mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show() })
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus() })
}

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
