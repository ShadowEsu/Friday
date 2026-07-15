import { ElectronAPI } from '@electron-toolkit/preload'
import { FridayApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    friday: FridayApi
  }
}
