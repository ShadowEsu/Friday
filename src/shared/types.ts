// Types shared between the main (agent runtime) and renderer (UI) processes.
// Kept dependency-free (no electron/node imports) so the renderer bundle can use them directly.

export type AgentStatus =
  'idle' | 'listening' | 'thinking' | 'acting' | 'speaking' | 'paused' | 'error'

export interface ToolCall {
  tool: string
  args: Record<string, unknown>
  label: string
}

export interface Plan {
  goal: string
  steps: ToolCall[]
}

export interface AgentContext {
  currentApp?: string
  currentSite?: string
  currentUrl?: string
  lastEntity?: string
  /** Pending items left to read one-at-a-time (e.g. remaining news stories after "next"). */
  queue?: string[]
  history: { role: 'user' | 'friday'; text: string }[]
}

export interface ToolResult {
  ok: boolean
  message: string
  data?: unknown
  verified: boolean
}

export interface ActivityEntry {
  id: number
  timestamp: string
  type: 'command' | 'tool' | 'response' | 'error' | 'confirm' | 'system'
  message: string
  data?: string
}

export interface FridaySettings {
  localModelProvider: 'ollama'
  baseUrl: string
  model: string
  voice: string
  speechRate: number
  defaultBrowser: 'chrome'
  globalShortcut: string
  wakeWordEnabled: boolean
  historyEnabled: boolean
  startOnLogin: boolean
  whisperBinaryPath: string
  whisperModelPath: string
  confirmBeforeSensitiveActions: boolean
}

export type PermissionState =
  'granted' | 'denied' | 'not-determined' | 'restricted' | 'unsupported-platform' | 'unknown'

export interface PermissionStatus {
  microphone: PermissionState
  accessibility: PermissionState
  screenRecording: PermissionState
  notifications: PermissionState
  calendar: PermissionState
}

export type AgentEvent =
  | { type: 'status'; status: AgentStatus }
  | { type: 'conversation'; role: 'user' | 'friday'; text: string }
  | { type: 'task'; plan: Plan; stepIndex: number; stepResult?: ToolResult }
  | {
      type: 'confirm-request'
      id: string
      toolName: string
      label: string
      args: Record<string, unknown>
    }
  | { type: 'confirm-resolved'; id: string; approved: boolean }

export const IPC_CHANNELS = {
  command: 'friday:command',
  transcribeAndSend: 'friday:transcribe-and-send',
  stop: 'friday:stop',
  pause: 'friday:pause',
  continue: 'friday:continue',
  resolveConfirm: 'friday:confirm-resolve',
  getHistory: 'friday:get-history',
  clearHistory: 'friday:clear-history',
  getSettings: 'friday:get-settings',
  setSettings: 'friday:set-settings',
  getPermissions: 'friday:get-permissions',
  getStatus: 'friday:get-status',
  event: 'friday:event'
} as const
