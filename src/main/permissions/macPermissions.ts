import { PermissionState, PermissionStatus } from '../../shared/types'

export type { PermissionState, PermissionStatus }

/**
 * Electron's systemPreferences API only exposes a subset of macOS's TCC permissions
 * (mic/camera/screen, plus accessibility trust). Notifications and Calendar don't have a
 * queryable Electron API, so those are reported as 'unknown' with a pointer to System
 * Settings rather than guessed at - Friday should never claim a permission is granted
 * without being able to verify it.
 */
export async function getPermissionStatus(): Promise<PermissionStatus> {
  if (process.platform !== 'darwin') {
    return {
      microphone: 'unsupported-platform',
      accessibility: 'unsupported-platform',
      screenRecording: 'unsupported-platform',
      notifications: 'unsupported-platform',
      calendar: 'unsupported-platform'
    }
  }

  // Imported lazily so this module can be unit tested on non-mac / non-Electron environments.
  const { systemPreferences } = await import('electron')

  const mic = systemPreferences.getMediaAccessStatus('microphone') as PermissionState
  const screen = systemPreferences.getMediaAccessStatus('screen') as PermissionState
  const accessibility: PermissionState = systemPreferences.isTrustedAccessibilityClient(false)
    ? 'granted'
    : 'denied'

  return {
    microphone: mic,
    accessibility,
    screenRecording: screen,
    notifications: 'unknown',
    calendar: 'unknown'
  }
}
