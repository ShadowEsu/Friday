import { describe, expect, it } from 'vitest'
import { openAppTool } from '../../src/main/tools/openApp'

describe('openAppTool', () => {
  it('requires an app name', async () => {
    const result = await openAppTool.execute(
      {},
      { agentContext: { history: [] }, signal: new AbortController().signal }
    )
    expect(result.ok).toBe(false)
  })

  it('reports honestly that native app launch is unavailable on non-macOS', async () => {
    // This sandbox runs Linux; Friday targets macOS. The tool must not pretend it worked.
    if (process.platform === 'darwin') return
    const result = await openAppTool.execute(
      { app: 'Notes' },
      { agentContext: { history: [] }, signal: new AbortController().signal }
    )
    expect(result.ok).toBe(false)
    expect(result.verified).toBe(false)
    expect(result.message).toContain('macOS')
  })
})
