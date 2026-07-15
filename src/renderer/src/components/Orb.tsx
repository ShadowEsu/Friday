import type { ReactElement } from 'react'
import { AgentStatus } from '../../../shared/types'

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'Idle',
  listening: 'Listening…',
  thinking: 'Thinking…',
  acting: 'Working…',
  speaking: 'Speaking…',
  paused: 'Paused',
  error: 'Error'
}

export function Orb({
  status,
  onPress
}: {
  status: AgentStatus
  onPress: () => void
}): ReactElement {
  return (
    <button className={`orb orb--${status}`} onClick={onPress} aria-label="Push to talk">
      <span className="orb__core" />
      <span className="orb__label">{STATUS_LABEL[status]}</span>
    </button>
  )
}
