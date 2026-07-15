import { FridaySettings } from './types'

export const DEFAULT_SETTINGS: FridaySettings = {
  localModelProvider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'llama3.1',
  voice: 'default',
  speechRate: 175,
  defaultBrowser: 'chrome',
  globalShortcut: 'CommandOrControl+Shift+Space',
  wakeWordEnabled: false,
  historyEnabled: true,
  startOnLogin: false,
  whisperBinaryPath: '',
  whisperModelPath: '',
  confirmBeforeSensitiveActions: true
}
