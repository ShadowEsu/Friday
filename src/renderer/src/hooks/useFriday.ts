import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityEntry,
  AgentEvent,
  AgentStatus,
  FridaySettings,
  PermissionStatus,
  Plan,
  ToolResult
} from '../../../shared/types'

export interface ConversationTurn {
  role: 'user' | 'friday'
  text: string
}

export interface TaskState {
  plan: Plan
  stepIndex: number
  stepResults: (ToolResult | undefined)[]
}

export interface ConfirmRequest {
  id: string
  toolName: string
  label: string
  args: Record<string, unknown>
}

export interface UseFridayResult {
  status: AgentStatus
  conversation: ConversationTurn[]
  task: TaskState | null
  history: ActivityEntry[]
  settings: FridaySettings | null
  permissions: PermissionStatus | null
  confirmRequest: ConfirmRequest | null
  sendText: (text: string) => Promise<void>
  stop: () => Promise<void>
  pause: () => Promise<void>
  continueTask: () => Promise<void>
  resolveConfirm: (id: string, approved: boolean) => Promise<void>
  clearHistory: () => Promise<void>
  updateSettings: (partial: Partial<FridaySettings>) => Promise<void>
  refreshPermissions: () => Promise<void>
}

export function useFriday(): UseFridayResult {
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [conversation, setConversation] = useState<ConversationTurn[]>([])
  const [task, setTask] = useState<TaskState | null>(null)
  const [history, setHistory] = useState<ActivityEntry[]>([])
  const [settings, setSettingsState] = useState<FridaySettings | null>(null)
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const taskRef = useRef<TaskState | null>(null)

  const refreshHistory = useCallback(async () => {
    setHistory(await window.friday.getHistory(200))
  }, [])

  const refreshSettings = useCallback(async () => {
    setSettingsState(await window.friday.getSettings())
  }, [])

  const refreshPermissions = useCallback(async () => {
    setPermissions(await window.friday.getPermissions())
  }, [])

  useEffect(() => {
    // Initial data load on mount - the experimental set-state-in-effect rule flags this as a
    // false positive; there's no external system to synchronize with here, just an initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshHistory()

    refreshSettings()

    refreshPermissions()

    const unsubscribe = window.friday.onEvent((event: AgentEvent) => {
      switch (event.type) {
        case 'status':
          setStatus(event.status)
          break
        case 'conversation':
          setConversation((prev) => [...prev, { role: event.role, text: event.text }])
          refreshHistory()
          break
        case 'task': {
          const next: TaskState =
            taskRef.current && taskRef.current.plan === event.plan
              ? { ...taskRef.current }
              : { plan: event.plan, stepIndex: 0, stepResults: [] }
          next.stepIndex = event.stepIndex
          if (event.stepResult) next.stepResults[event.stepIndex] = event.stepResult
          taskRef.current = next
          setTask(next)
          refreshHistory()
          break
        }
        case 'confirm-request':
          setConfirmRequest({
            id: event.id,
            toolName: event.toolName,
            label: event.label,
            args: event.args
          })
          break
        case 'confirm-resolved':
          setConfirmRequest((prev) => (prev?.id === event.id ? null : prev))
          break
      }
    })

    return unsubscribe
  }, [refreshHistory, refreshPermissions, refreshSettings])

  const sendText = useCallback(async (text: string) => {
    if (!text.trim()) return
    await window.friday.sendCommand(text)
  }, [])

  const stop = useCallback(async () => {
    await window.friday.stop()
    taskRef.current = null
    setTask(null)
  }, [])

  const pause = useCallback(() => window.friday.pause(), [])
  const continueTask = useCallback(() => window.friday.continueTask(), [])

  const resolveConfirm = useCallback(async (id: string, approved: boolean) => {
    await window.friday.resolveConfirm(id, approved)
    setConfirmRequest(null)
  }, [])

  const clearHistory = useCallback(async () => {
    await window.friday.clearHistory()
    await refreshHistory()
  }, [refreshHistory])

  const updateSettings = useCallback(async (partial: Partial<FridaySettings>) => {
    const updated = await window.friday.setSettings(partial)
    setSettingsState(updated)
  }, [])

  return {
    status,
    conversation,
    task,
    history,
    settings,
    permissions,
    confirmRequest,
    sendText,
    stop,
    pause,
    continueTask,
    resolveConfirm,
    clearHistory,
    updateSettings,
    refreshPermissions
  }
}
