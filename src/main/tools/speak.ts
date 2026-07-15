import { spawn, ChildProcess } from 'child_process'

export interface SpeechOptions {
  rate?: number // words per minute, macOS `say` default is ~175
  voice?: string
}

/**
 * Text-to-speech via the macOS `say` command. On other platforms this becomes a no-op that
 * still resolves (and logs), since Friday is designed to run on the user's own Mac - see
 * docs/LIMITATIONS.md for what "native voice output" means on non-mac dev environments.
 */
export class SpeechOutput {
  private current: ChildProcess | null = null

  async speak(text: string, opts: SpeechOptions = {}): Promise<void> {
    this.stop()
    if (!text.trim()) return
    if (process.platform !== 'darwin') {
      // No native TTS available; the caller is responsible for surfacing `text` in the UI.
      return
    }
    await new Promise<void>((resolve) => {
      const args: string[] = []
      if (opts.voice) args.push('-v', opts.voice)
      if (opts.rate) args.push('-r', String(opts.rate))
      args.push(text)
      const child = spawn('say', args)
      this.current = child
      child.on('close', () => {
        if (this.current === child) this.current = null
        resolve()
      })
      child.on('error', () => {
        if (this.current === child) this.current = null
        resolve()
      })
    })
  }

  /** Interrupts speech immediately - required for "Stop" to feel instant while Friday is talking. */
  stop(): void {
    if (this.current) {
      this.current.kill()
      this.current = null
    }
  }

  get speaking(): boolean {
    return this.current !== null
  }
}
