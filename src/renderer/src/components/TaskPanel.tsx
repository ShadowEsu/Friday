import type { ReactElement } from 'react'
import { AgentStatus } from '../../../shared/types'
import { TaskState } from '../hooks/useFriday'

export function TaskPanel({
  task,
  status,
  onPause,
  onContinue,
  onStop
}: {
  task: TaskState | null
  status: AgentStatus
  onPause: () => void
  onContinue: () => void
  onStop: () => void
}): ReactElement {
  return (
    <div className="panel task-panel">
      <h2>Current Task</h2>
      {!task && <p className="muted">No task running.</p>}
      {task && (
        <>
          <p className="task-panel__goal">{task.plan.goal}</p>
          <ol className="task-panel__steps">
            {task.plan.steps.map((step, i) => {
              const result = task.stepResults[i]
              const state =
                i < task.stepIndex || result
                  ? result?.ok === false
                    ? 'failed'
                    : 'done'
                  : i === task.stepIndex
                    ? 'active'
                    : 'pending'
              return (
                <li key={i} className={`task-step task-step--${state}`}>
                  <span className="task-step__marker" />
                  {step.label}
                  {result && !result.ok && (
                    <span className="task-step__error"> — {result.message}</span>
                  )}
                </li>
              )
            })}
          </ol>
        </>
      )}
      <div className="task-panel__controls">
        {status === 'paused' ? (
          <button onClick={onContinue}>Continue</button>
        ) : (
          <button onClick={onPause} disabled={status !== 'acting'}>
            Pause
          </button>
        )}
        <button className="danger" onClick={onStop}>
          Stop
        </button>
      </div>
    </div>
  )
}
