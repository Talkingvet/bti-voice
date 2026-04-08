const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, Notification } = require('electron')
const path = require('path')

let mainWindow = null
let tray = null

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png')
const TRAY_PATH = path.join(__dirname, 'assets', 'tray.png')

// ── Your Railway URL ──────────────────────────────────────────────
const APP_URL = 'https://bti-voice-production.up.railway.app'

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

  // Load directly from Railway — simplest and most reliable approach
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

// ── IPC: custom title bar controls ───────────────────────────────
ipcMain.on('win-minimize', () => mainWindow?.minimize())
ipcMain.on('win-maximize', () => {
  if (!mainWindow) return
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.on('win-close', () => mainWindow?.hide())
ipcMain.on('win-quit',  () => { app.isQuitting = true; app.quit() })

// ── App lifecycle ─────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow()
  createTray()
})

app.on('window-all-closed', () => { /* stay in tray */ })
app.on('activate',          () => { mainWindow?.show(); mainWindow?.focus() })
app.on('before-quit',       () => { app.isQuitting = true })
