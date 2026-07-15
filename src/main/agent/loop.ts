import { isSensitiveTool } from './confirm'
import {
  AgentContext,
  AgentStatus,
  ActivityEntry,
  Plan,
  RouteResult,
  Tool,
  ToolCall,
  ToolContext,
  ToolResult
} from './types'
import { AgentEvent } from '../../shared/types'

export type { AgentEvent }

/** Minimal surface AgentLoop needs from CommandRouter - lets tests supply a lightweight fake. */
export interface RouterLike {
  route(utterance: string, context: AgentContext): Promise<RouteResult>
}

/** Minimal surface AgentLoop needs from ToolRegistry. */
export interface ToolRegistryLike {
  execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
  get(name: string): Tool | undefined
}

/** Minimal surface AgentLoop needs from HistoryStore. */
export interface HistoryLike {
  add(type: ActivityEntry['type'], message: string, data?: unknown): ActivityEntry
}

export interface SpeechSink {
  speak(text: string): Promise<void>
  stop(): void
}

const CONTROL_STOP = /^(stop|cancel|abort|never ?mind)$/i
const CONTROL_PAUSE = /^(pause|hold on|wait a second|let me take over)$/i
const CONTROL_CONTINUE = /^(continue|resume|go ahead|keep going)$/i

interface PendingConfirm {
  resolve: (approved: boolean) => void
}

export class AgentLoop {
  private status: AgentStatus = 'idle'
  private context: AgentContext = { history: [] }
  private abortController = new AbortController()
  private pendingConfirms = new Map<string, PendingConfirm>()
  private pauseGate: { promise: Promise<void>; release: () => void } | null = null
  private confirmBeforeSensitive = true

  constructor(
    private router: RouterLike,
    private tools: ToolRegistryLike,
    private history: HistoryLike,
    private speech: SpeechSink,
    private emit: (event: AgentEvent) => void
  ) {}

  setConfirmBeforeSensitive(value: boolean): void {
    this.confirmBeforeSensitive = value
  }

  getStatus(): AgentStatus {
    return this.status
  }

  getContext(): AgentContext {
    return this.context
  }

  private setStatus(status: AgentStatus): void {
    this.status = status
    this.emit({ type: 'status', status })
  }

  private log(type: ActivityEntry['type'], message: string, data?: unknown): void {
    this.history.add(type, message, data)
  }

  async handleUtterance(rawText: string): Promise<void> {
    const text = rawText.trim()
    if (!text) return

    // Interrupts take priority over everything, including an in-progress plan or speech.
    if (CONTROL_STOP.test(text)) return this.stop()
    if (CONTROL_PAUSE.test(text) && this.status === 'acting') return this.pause()
    if (CONTROL_CONTINUE.test(text) && this.status === 'paused') return this.continueTask()

    this.context.history.push({ role: 'user', text })
    this.emit({ type: 'conversation', role: 'user', text })
    this.log('command', text)

    this.setStatus('thinking')
    const route = await this.router.route(text, this.context)

    if (!route.understood) {
      const response = route.response ?? "I didn't understand that."
      await this.respond(response)
      return
    }

    await this.runPlan(route.plan)
  }

  private async runPlan(plan: Plan): Promise<void> {
    this.abortController = new AbortController()
    this.setStatus('acting')
    const results: { step: ToolCall; result: ToolResult }[] = []

    for (let i = 0; i < plan.steps.length; i++) {
      if (this.status === 'paused') {
        await this.pauseGate?.promise
      }
      if (this.abortController.signal.aborted) {
        this.log('system', 'Task stopped before completion')
        break
      }

      const step = plan.steps[i]
      this.emit({ type: 'task', plan, stepIndex: i })

      const needsConfirm =
        this.confirmBeforeSensitive &&
        (isSensitiveTool(step.tool) || this.tools.get(step.tool)?.sensitive)
      if (needsConfirm) {
        const approved = await this.requestConfirm(step)
        if (!approved) {
          this.log('confirm', `Declined: ${step.label}`)
          results.push({
            step,
            result: { ok: false, message: 'Cancelled by user', verified: true }
          })
          break
        }
      }

      const result = await this.tools.execute(step.tool, step.args, {
        agentContext: this.context,
        signal: this.abortController.signal
      })
      results.push({ step, result })
      this.log('tool', `${step.label}: ${result.message}`, result.data)
      this.emit({ type: 'task', plan, stepIndex: i, stepResult: result })
      this.updateContext(step, result)

      if (!result.ok) {
        break // don't pretend the rest of the plan succeeded
      }
    }

    await this.respond(this.summarize(plan, results))
  }

  private updateContext(step: ToolCall, result: ToolResult): void {
    if (step.tool === 'browser_open_url') {
      const siteName = step.args.siteName as string | undefined
      if (siteName) this.context.currentSite = siteName
      const data = result.data as { url?: string } | undefined
      if (data?.url) this.context.currentUrl = data.url
    }
    if (step.tool === 'browser_navigate_section') {
      this.context.lastEntity = String(step.args.section)
    }
  }

  private summarize(plan: Plan, results: { step: ToolCall; result: ToolResult }[]): string {
    if (results.length === 0) return `I didn't do anything for "${plan.goal}".`
    const last = results[results.length - 1]
    if (!last.result.ok) {
      return `I ran into a problem: ${last.result.message}`
    }
    if (results.length === 1) return last.result.message
    return `${plan.goal}. ${last.result.message}`
  }

  private async respond(text: string): Promise<void> {
    this.context.history.push({ role: 'friday', text })
    this.emit({ type: 'conversation', role: 'friday', text })
    this.log('response', text)
    this.setStatus('speaking')
    await this.speech.speak(text)
    this.setStatus('idle')
  }

  requestConfirm(step: ToolCall): Promise<boolean> {
    const id = crypto.randomUUID()
    this.emit({
      type: 'confirm-request',
      id,
      toolName: step.tool,
      label: step.label,
      args: step.args
    })
    this.log('confirm', `Awaiting confirmation: ${step.label}`)
    return new Promise((resolve) => {
      this.pendingConfirms.set(id, { resolve })
    })
  }

  resolveConfirm(id: string, approved: boolean): void {
    const pending = this.pendingConfirms.get(id)
    if (!pending) return
    this.pendingConfirms.delete(id)
    this.emit({ type: 'confirm-resolved', id, approved })
    pending.resolve(approved)
  }

  stop(): void {
    this.abortController.abort()
    for (const [id, pending] of this.pendingConfirms) {
      pending.resolve(false)
      this.emit({ type: 'confirm-resolved', id, approved: false })
    }
    this.pendingConfirms.clear()
    this.speech.stop()
    this.releasePauseGate()
    this.log('system', 'Stopped immediately')
    this.setStatus('idle')
    this.emit({ type: 'conversation', role: 'friday', text: 'Stopped.' })
  }

  pause(): void {
    if (this.status !== 'acting') return
    this.pauseGate = createGate()
    this.log('system', 'Paused - waiting for "continue"')
    this.setStatus('paused')
    this.emit({
      type: 'conversation',
      role: 'friday',
      text: "You need to log in manually. I've paused."
    })
  }

  continueTask(): void {
    if (this.status !== 'paused') return
    this.log('system', 'Resumed')
    this.setStatus('acting')
    this.releasePauseGate()
  }

  private releasePauseGate(): void {
    this.pauseGate?.release()
    this.pauseGate = null
  }
}

function createGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
