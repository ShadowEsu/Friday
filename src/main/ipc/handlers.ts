import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS, FridaySettings, PermissionStatus } from '../../shared/types'
import { AgentLoop } from '../agent/loop'
import { HistoryStore } from '../memory/history'
import { SettingsStore } from '../memory/settings'
import { TranscriptionProvider, TranscriptionUnavailableError } from '../tools/transcribe'

export interface IpcDeps {
  loop: AgentLoop
  history: HistoryStore
  settings: SettingsStore
  getTranscriptionProvider: () => TranscriptionProvider | null
  getPermissions: () => Promise<PermissionStatus>
}

export function registerIpcHandlers(deps: IpcDeps): void {
  ipcMain.handle(IPC_CHANNELS.command, async (_e: IpcMainInvokeEvent, text: string) => {
    await deps.loop.handleUtterance(text)
  })

  ipcMain.handle(IPC_CHANNELS.transcribeAndSend, async (_e, audio: ArrayBuffer) => {
    const provider = deps.getTranscriptionProvider()
    if (!provider) throw new TranscriptionUnavailableError()
    const text = await provider.transcribe(Buffer.from(audio))
    await deps.loop.handleUtterance(text)
    return text
  })

  ipcMain.handle(IPC_CHANNELS.stop, () => deps.loop.stop())
  ipcMain.handle(IPC_CHANNELS.pause, () => deps.loop.pause())
  ipcMain.handle(IPC_CHANNELS.continue, () => deps.loop.continueTask())
  ipcMain.handle(IPC_CHANNELS.resolveConfirm, (_e, id: string, approved: boolean) =>
    deps.loop.resolveConfirm(id, approved)
  )

  ipcMain.handle(IPC_CHANNELS.getHistory, (_e, limit?: number) => deps.history.list(limit))
  ipcMain.handle(IPC_CHANNELS.clearHistory, () => deps.history.clear())

  ipcMain.handle(IPC_CHANNELS.getSettings, () => deps.settings.getAll())
  ipcMain.handle(IPC_CHANNELS.setSettings, (_e, partial: Partial<FridaySettings>) => {
    const updated = deps.settings.set(partial)
    deps.loop.setConfirmBeforeSensitive(updated.confirmBeforeSensitiveActions)
    return updated
  })

  ipcMain.handle(IPC_CHANNELS.getPermissions, () => deps.getPermissions())
  ipcMain.handle(IPC_CHANNELS.getStatus, () => deps.loop.getStatus())
}
