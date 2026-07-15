import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS, AgentEvent, FridaySettings, ActivityEntry } from '../shared/types'

const fridayApi = {
  sendCommand: (text: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.command, text),
  transcribeAndSend: (audio: ArrayBuffer): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.transcribeAndSend, audio),
  stop: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.stop),
  pause: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.pause),
  continueTask: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.continue),
  resolveConfirm: (id: string, approved: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.resolveConfirm, id, approved),
  getHistory: (limit?: number): Promise<ActivityEntry[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.getHistory, limit),
  clearHistory: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.clearHistory),
  getSettings: (): Promise<FridaySettings> => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  setSettings: (partial: Partial<FridaySettings>): Promise<FridaySettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.setSettings, partial),
  getPermissions: () => ipcRenderer.invoke(IPC_CHANNELS.getPermissions),
  getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getStatus),
  onEvent: (callback: (event: AgentEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: AgentEvent): void => callback(payload)
    ipcRenderer.on(IPC_CHANNELS.event, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.event, listener)
  }
}

export type FridayApi = typeof fridayApi

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('friday', fridayApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.friday = fridayApi
}
