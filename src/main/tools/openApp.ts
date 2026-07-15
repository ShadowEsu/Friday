import { execFile } from 'child_process'
import { promisify } from 'util'
import { Tool, ToolResult } from '../agent/types'

const execFileAsync = promisify(execFile)

async function launchApp(appName: string): Promise<ToolResult> {
  if (process.platform !== 'darwin') {
    return {
      ok: false,
      message: `Opening native apps requires macOS. Friday is running on ${process.platform}, so "${appName}" was not launched.`,
      verified: false
    }
  }
  try {
    await execFileAsync('open', ['-a', appName])
    // `open -a` returns as soon as the launch request is dispatched; give the app a
    // moment to appear, then verify it is actually running before claiming success.
    await new Promise((r) => setTimeout(r, 800))
    const { stdout } = await execFileAsync('osascript', [
      '-e',
      `application "${appName}" is running`
    ])
    const running = stdout.trim() === 'true'
    return {
      ok: running,
      message: running
        ? `${appName} is open.`
        : `Asked macOS to open ${appName}, but couldn't confirm it launched.`,
      verified: running
    }
  } catch (err) {
    return {
      ok: false,
      message: `Failed to open ${appName}: ${err instanceof Error ? err.message : err}`,
      verified: false
    }
  }
}

export const openAppTool: Tool = {
  name: 'open_app',
  description: 'Launch or focus a native macOS application by name',
  sensitive: false,
  async execute(args) {
    const app = String(args.app ?? '').trim()
    if (!app) return { ok: false, message: 'No application name given', verified: false }
    return launchApp(app)
  }
}
