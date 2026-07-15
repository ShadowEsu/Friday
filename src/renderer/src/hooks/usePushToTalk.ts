import { useCallback, useRef, useState } from 'react'

export interface PushToTalkResult {
  recording: boolean
  error: string | null
  start: () => Promise<void>
  stop: () => void
}

export function usePushToTalk(onTranscript: (text: string) => void): PushToTalkResult {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)

  const start = useCallback(async () => {
    setError(null)
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunks.current = []
      const recorder = new MediaRecorder(stream.current)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data)
      }
      recorder.onstop = async () => {
        const blob = new Blob(chunks.current, { type: recorder.mimeType })
        const buffer = await blob.arrayBuffer()
        stream.current?.getTracks().forEach((t) => t.stop())
        try {
          const text = await window.friday.transcribeAndSend(buffer)
          onTranscript(text)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
      mediaRecorder.current = recorder
      recorder.start()
      setRecording(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access was denied')
    }
  }, [onTranscript])

  const stopRecording = useCallback(() => {
    mediaRecorder.current?.stop()
    setRecording(false)
  }, [])

  return { recording, error, start, stop: stopRecording }
}
