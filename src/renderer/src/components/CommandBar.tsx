import type { ReactElement } from 'react'
import { useState } from 'react'
import { usePushToTalk } from '../hooks/usePushToTalk'

export function CommandBar({ onSubmit }: { onSubmit: (text: string) => void }): ReactElement {
  const [text, setText] = useState('')
  const { recording, error, start, stop } = usePushToTalk((transcript) => setText(transcript))

  const submit = (): void => {
    if (!text.trim()) return
    onSubmit(text)
    setText('')
  }

  return (
    <div className="command-bar">
      <input
        className="command-bar__input"
        placeholder='Type a command, e.g. "Open YouTube"'
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
      <button className="command-bar__send" onClick={submit}>
        Send
      </button>
      <button
        className={`command-bar__mic ${recording ? 'command-bar__mic--active' : ''}`}
        onMouseDown={start}
        onMouseUp={stop}
        onMouseLeave={() => recording && stop()}
        title="Hold to talk"
      >
        {recording ? 'Listening…' : 'Hold to talk'}
      </button>
      {error && <span className="command-bar__error">{error}</span>}
    </div>
  )
}
