import type { ReactElement } from 'react'
import { PermissionStatus } from '../../../shared/types'

const LABELS: Record<keyof PermissionStatus, string> = {
  microphone: 'Microphone',
  accessibility: 'Accessibility',
  screenRecording: 'Screen Recording',
  notifications: 'Notifications',
  calendar: 'Calendar'
}

export function PermissionsPanel({
  permissions,
  onRefresh
}: {
  permissions: PermissionStatus | null
  onRefresh: () => void
}): ReactElement {
  return (
    <div className="panel permissions-panel">
      <div className="activity-panel__header">
        <h2>macOS Permissions</h2>
        <button className="link" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      {!permissions && <p className="muted">Loading…</p>}
      {permissions && (
        <ul className="permission-list">
          {(Object.keys(LABELS) as (keyof PermissionStatus)[]).map((key) => (
            <li key={key}>
              <span>{LABELS[key]}</span>
              <span className={`badge badge--${permissions[key]}`}>
                {formatState(permissions[key])}
              </span>
            </li>
          ))}
        </ul>
      )}
      {permissions?.microphone === 'unsupported-platform' && (
        <p className="muted small">
          Running on a non-Mac environment - permission checks require macOS.
        </p>
      )}
    </div>
  )
}

function formatState(state: string): string {
  switch (state) {
    case 'granted':
      return 'Enabled'
    case 'denied':
      return 'Disabled'
    case 'unsupported-platform':
      return 'Unsupported'
    case 'unknown':
      return 'Check System Settings'
    default:
      return state
  }
}
