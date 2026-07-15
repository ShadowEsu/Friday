import type { ReactElement } from 'react'
import { ConversationTurn } from '../hooks/useFriday'

export function ConversationPanel({ turns }: { turns: ConversationTurn[] }): ReactElement {
  return (
    <div className="panel conversation-panel">
      <h2>Conversation</h2>
      <div className="conversation-panel__scroll">
        {turns.length === 0 && <p className="muted">Say or type a command to get started.</p>}
        {turns.map((turn, i) => (
          <div key={i} className={`bubble bubble--${turn.role}`}>
            <span className="bubble__role">{turn.role === 'user' ? 'You' : 'Friday'}</span>
            <p>{turn.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
