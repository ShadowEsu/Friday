import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const execFileAsync = promisify(execFile)

export interface TranscriptionProvider {
  transcribe(audio: Buffer): Promise<string>
}

/**
 * Shells out to a local whisper.cpp `main`/`whisper-cli` binary. Requires the user to have
 * built or installed whisper.cpp and a ggml model locally - see docs/SETUP.md. Not exercised
 * by the automated test suite because it depends on a binary + microphone hardware that this
 * development sandbox doesn't have; docs/LIMITATIONS.md calls this out explicitly.
 */
export class WhisperCppProvider implements TranscriptionProvider {
  constructor(
    private binaryPath: string,
    private modelPath: string
  ) {}

  async transcribe(audio: Buffer): Promise<string> {
    const tmpFile = join(tmpdir(), `friday-${randomUUID()}.wav`)
    await writeFile(tmpFile, audio)
    try {
      const { stdout } = await execFileAsync(
        this.binaryPath,
        ['-m', this.modelPath, '-f', tmpFile, '-nt', '-otxt'],
        {
          timeout: 30000
        }
      )
      return stdout.trim()
    } finally {
      await unlink(tmpFile).catch(() => {})
    }
  }
}

/** Returns whatever text is handed to it. Used for the typed-command fallback and for tests. */
export class EchoProvider implements TranscriptionProvider {
  async transcribe(audio: Buffer): Promise<string> {
    return audio.toString('utf-8')
  }
}

export class TranscriptionUnavailableError extends Error {
  constructor() {
    super(
      'Speech-to-text is not configured. Set a whisper.cpp binary and model path in Settings, or type your command instead.'
    )
    this.name = 'TranscriptionUnavailableError'
  }
}
