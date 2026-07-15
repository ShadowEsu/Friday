import type { ReactElement } from 'react'
import { ActivityEntry } from '../../../shared/types'

export function ActivityHistory({
  entries,
  onClear
}: {
  entries: ActivityEntry[]
  onClear: () => void
}): ReactElement {
  return (
    <div className="panel activity-panel">
      <div className="activity-panel__header">
        <h2>Activity History</h2>
        <button className="link" onClick={onClear}>
          Clear
        </button>
      </div>
      <div className="activity-panel__scroll">
        {entries.length === 0 && <p className="muted">Nothing logged yet.</p>}
        {entries.map((entry) => (
          <div key={entry.id} className={`activity-entry activity-entry--${entry.type}`}>
            <span className="activity-entry__time">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <span className="activity-entry__message">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
