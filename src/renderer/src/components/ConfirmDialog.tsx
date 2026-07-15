import type { ReactElement } from 'react'
import { ConfirmRequest } from '../hooks/useFriday'

export function ConfirmDialog({
  request,
  onResolve
}: {
  request: ConfirmRequest | null
  onResolve: (id: string, approved: boolean) => void
}): ReactElement | null {
  if (!request) return null
  return (
    <div className="confirm-overlay">
      <div className="confirm-dialog">
        <h3>Confirm action</h3>
        <p>{request.label}</p>
        {Object.keys(request.args).length > 0 && (
          <pre className="confirm-dialog__args">{JSON.stringify(request.args, null, 2)}</pre>
        )}
        <div className="confirm-dialog__buttons">
          <button onClick={() => onResolve(request.id, false)}>Cancel</button>
          <button className="primary" onClick={() => onResolve(request.id, true)}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
