import { app, shell, BrowserWindow, clipboard, globalShortcut } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

import { openDatabase } from './memory/db'
import { SettingsStore } from './memory/settings'
import { HistoryStore } from './memory/history'
import { MemoryStore } from './memory/store'
import { ToolRegistry } from './tools/registry'
import { openAppTool } from './tools/openApp'
import { BrowserController, createBrowserTools } from './tools/browser'
import { morningBriefingTool } from './tools/briefing'
import { SpeechOutput } from './tools/speak'
import { WhisperCppProvider, TranscriptionProvider } from './tools/transcribe'
import { CommandRouter } from './agent/router'
import { OllamaProvider } from './agent/llmProvider'
import { AgentLoop } from './agent/loop'
import { registerIpcHandlers } from './ipc/handlers'
import { getPermissionStatus } from './permissions/macPermissions'
import { IPC_CHANNELS } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let browserController: BrowserController | null = null
let agentLoop: AgentLoop | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 980,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function bootstrapAgent(): void {
  const dbPath = join(app.getPath('userData'), 'friday.db')
  const db = openDatabase(dbPath)
  const settings = new SettingsStore(db)
  const history = new HistoryStore(db)
  new MemoryStore(db) // reserved for future named-project / workflow recall features

  const currentSettings = settings.getAll()

  browserController = new BrowserController({
    headless: false,
    channel: 'chrome',
    userDataDir: join(app.getPath('userData'), 'browser-profile'),
    clipboardWriter: (text) => clipboard.writeText(text),
    clipboardReader: () => clipboard.readText()
  })

  const tools = new ToolRegistry()
  tools.register(openAppTool)
  tools.register(morningBriefingTool)
  for (const tool of createBrowserTools(browserController)) tools.register(tool)

  const llm = new OllamaProvider({ baseUrl: currentSettings.baseUrl, model: currentSettings.model })
  const router = new CommandRouter(llm, tools.catalog())
  const speech = new SpeechOutput()

  agentLoop = new AgentLoop(router, tools, history, speech, (event) => {
    mainWindow?.webContents.send(IPC_CHANNELS.event, event)
  })
  agentLoop.setConfirmBeforeSensitive(currentSettings.confirmBeforeSensitiveActions)

  const getTranscriptionProvider = (): TranscriptionProvider | null => {
    const s = settings.getAll()
    if (!s.whisperBinaryPath || !s.whisperModelPath) return null
    return new WhisperCppProvider(s.whisperBinaryPath, s.whisperModelPath)
  }

  registerIpcHandlers({
    loop: agentLoop,
    history,
    settings,
    getTranscriptionProvider,
    getPermissions: getPermissionStatus
  })

  globalShortcut.register(currentSettings.globalShortcut, () => {
    mainWindow?.webContents.send(IPC_CHANNELS.event, { type: 'status', status: 'listening' })
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.friday.agent')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  bootstrapAgent()
  mainWindow = createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('before-quit', async (event) => {
  if (browserController) {
    event.preventDefault()
    await browserController.close()
    browserController = null
    app.exit(0)
  }
})
