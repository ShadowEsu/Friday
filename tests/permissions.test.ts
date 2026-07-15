import { describe, expect, it } from 'vitest'
import { getPermissionStatus } from '../src/main/permissions/macPermissions'

describe('getPermissionStatus', () => {
  it('reports unsupported-platform on non-macOS without touching the electron module', async () => {
    if (process.platform === 'darwin') return
    const status = await getPermissionStatus()
    expect(status).toEqual({
      microphone: 'unsupported-platform',
      accessibility: 'unsupported-platform',
      screenRecording: 'unsupported-platform',
      notifications: 'unsupported-platform',
      calendar: 'unsupported-platform'
    })
  })
})
