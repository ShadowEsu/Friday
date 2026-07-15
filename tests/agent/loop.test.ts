import { describe, expect, it, vi } from 'vitest'
import {
  AgentLoop,
  AgentEvent,
  RouterLike,
  ToolRegistryLike,
  HistoryLike,
  SpeechSink
} from '../../src/main/agent/loop'
import { Plan, RouteResult, Tool, ToolContext } from '../../src/main/agent/types'

interface Fakes {
  loop: AgentLoop
  events: AgentEvent[]
  spoken: string[]
  speech: SpeechSink
}

function makeFakes(
  overrides: { tools?: Record<string, Tool>; routePlan?: Plan | RouteResult } = {}
): Fakes {
  const events: AgentEvent[] = []
  const spoken: string[] = []

  const tools: Record<string, Tool> = overrides.tools ?? {}

  const toolRegistry: ToolRegistryLike = {
    get: (name) => tools[name],
    execute: async (name, args, ctx: ToolContext) => {
      const tool = tools[name]
      if (!tool) return { ok: false, message: `Unknown tool: ${name}`, verified: false }
      if (ctx.signal.aborted) return { ok: false, message: 'Cancelled', verified: false }
      return tool.execute(args, ctx)
    }
  }

  const router: RouterLike = {
    route: async (): Promise<RouteResult> => {
      const plan = overrides.routePlan
      if (plan && 'steps' in plan) return { intent: 'test', understood: true, plan }
      return plan as RouteResult
    }
  }

  const history: HistoryLike = {
    add: (type, message, data) => ({
      id: 0,
      timestamp: new Date().toISOString(),
      type,
      message,
      data: data as never
    })
  }

  const speech: SpeechSink = {
    speak: async (text: string) => {
      spoken.push(text)
    },
    stop: vi.fn()
  }

  const loop = new AgentLoop(router, toolRegistry, history, speech, (e) => events.push(e))
  return { loop, events, spoken, speech }
}

function tool(name: string, run: Tool['execute'], sensitive = false): Tool {
  return { name, description: name, sensitive, execute: run }
}

describe('AgentLoop', () => {
  it('runs a multi-step plan to completion and speaks a final summary', async () => {
    const plan: Plan = {
      goal: 'Open YouTube',
      steps: [
        { tool: 'open', args: {}, label: 'Open YouTube' },
        { tool: 'verify', args: {}, label: 'Verify YouTube loaded' }
      ]
    }
    const { loop, events, spoken } = makeFakes({
      routePlan: plan,
      tools: {
        open: tool('open', async () => ({ ok: true, message: 'YouTube opened', verified: true })),
        verify: tool('verify', async () => ({
          ok: true,
          message: 'YouTube is loaded',
          verified: true
        }))
      }
    })

    await loop.handleUtterance('Open YouTube')

    expect(spoken).toEqual(['Open YouTube. YouTube is loaded'])
    expect(loop.getStatus()).toBe('idle')
    const statuses = events
      .filter((e) => e.type === 'status')
      .map((e) => (e as { status: string }).status)
    expect(statuses).toEqual(['thinking', 'acting', 'speaking', 'idle'])
  })

  it('stops the plan honestly when a step fails instead of pretending success', async () => {
    const plan: Plan = {
      goal: 'Do two things',
      steps: [
        { tool: 'fails', args: {}, label: 'A step that fails' },
        { tool: 'never_runs', args: {}, label: 'Should not execute' }
      ]
    }
    let secondStepRan = false
    const { loop, spoken } = makeFakes({
      routePlan: plan,
      tools: {
        fails: tool('fails', async () => ({
          ok: false,
          message: 'Could not find the button',
          verified: false
        })),
        never_runs: tool('never_runs', async () => {
          secondStepRan = true
          return { ok: true, message: 'ran', verified: true }
        })
      }
    })

    await loop.handleUtterance('do the thing')

    expect(secondStepRan).toBe(false)
    expect(spoken[0]).toContain('Could not find the button')
  })

  it('stops immediately mid-plan, without waiting for the running step to finish naturally', async () => {
    const plan: Plan = {
      goal: 'Slow task',
      steps: [
        { tool: 'slow', args: {}, label: 'A slow step' },
        { tool: 'after', args: {}, label: 'Should not run after stop' }
      ]
    }
    let afterRan = false
    let releaseSlow: () => void = () => {}
    const slowStarted = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })

    const { loop, speech } = makeFakes({
      routePlan: plan,
      tools: {
        slow: tool('slow', async (_args, ctx) => {
          releaseSlow()
          await new Promise((r) => setTimeout(r, 50))
          if (ctx.signal.aborted) return { ok: false, message: 'Cancelled', verified: false }
          return { ok: true, message: 'finished slowly', verified: true }
        }),
        after: tool('after', async () => {
          afterRan = true
          return { ok: true, message: 'ran', verified: true }
        })
      }
    })

    const run = loop.handleUtterance('do the slow thing')
    await slowStarted
    loop.stop()
    await run

    expect(afterRan).toBe(false)
    expect(loop.getStatus()).toBe('idle')
    expect(speech.stop).toHaveBeenCalled()
  })

  it('recognizes "stop" as an instant control word without consulting the router', async () => {
    const routeSpy = vi.fn()
    const toolRegistry: ToolRegistryLike = {
      get: () => undefined,
      execute: async () => ({ ok: true, message: '', verified: true })
    }
    const history: HistoryLike = {
      add: (type, message) => ({ id: 0, timestamp: '', type, message })
    }
    const speech: SpeechSink = { speak: vi.fn(async () => {}), stop: vi.fn() }
    const events: AgentEvent[] = []
    const loop = new AgentLoop({ route: routeSpy }, toolRegistry, history, speech, (e) =>
      events.push(e)
    )

    await loop.handleUtterance('Stop')

    expect(routeSpy).not.toHaveBeenCalled()
    expect(speech.stop).toHaveBeenCalled()
    expect(loop.getStatus()).toBe('idle')
  })

  it('pauses mid-plan and resumes only after continueTask() is called', async () => {
    const plan: Plan = {
      goal: 'Log in then continue',
      steps: [
        { tool: 'first', args: {}, label: 'First step' },
        { tool: 'second', args: {}, label: 'Second step' }
      ]
    }
    let secondRan = false
    const { loop } = makeFakes({
      routePlan: plan,
      tools: {
        first: tool('first', async () => {
          loop.pause()
          return { ok: true, message: 'paused for login', verified: true }
        }),
        second: tool('second', async () => {
          secondRan = true
          return { ok: true, message: 'done', verified: true }
        })
      }
    })

    const run = loop.handleUtterance('do the multi-step thing')
    // give the microtask queue a turn so the plan reaches the pause
    await new Promise((r) => setTimeout(r, 10))
    expect(loop.getStatus()).toBe('paused')
    expect(secondRan).toBe(false)

    loop.continueTask()
    await run

    expect(secondRan).toBe(true)
    expect(loop.getStatus()).toBe('idle')
  })

  it('gates a sensitive tool behind confirmation and honors decline', async () => {
    const plan: Plan = {
      goal: 'Accept a request',
      steps: [{ tool: 'linkedin_accept_request', args: {}, label: 'Accept the connection request' }]
    }
    let executed = false
    const { loop, events } = makeFakes({
      routePlan: plan,
      tools: {
        linkedin_accept_request: tool(
          'linkedin_accept_request',
          async () => {
            executed = true
            return { ok: true, message: 'Accepted', verified: true }
          },
          true
        )
      }
    })

    const run = loop.handleUtterance('accept this request')
    await new Promise((r) => setTimeout(r, 10))

    const confirmEvent = events.find((e) => e.type === 'confirm-request') as
      { type: 'confirm-request'; id: string } | undefined
    expect(confirmEvent).toBeTruthy()
    loop.resolveConfirm(confirmEvent!.id, false)
    await run

    expect(executed).toBe(false)
  })

  it('gates a sensitive tool behind confirmation and executes it on approval', async () => {
    const plan: Plan = {
      goal: 'Accept a request',
      steps: [{ tool: 'linkedin_accept_request', args: {}, label: 'Accept the connection request' }]
    }
    let executed = false
    const { loop, events } = makeFakes({
      routePlan: plan,
      tools: {
        linkedin_accept_request: tool(
          'linkedin_accept_request',
          async () => {
            executed = true
            return { ok: true, message: 'Accepted', verified: true }
          },
          true
        )
      }
    })

    const run = loop.handleUtterance('accept this request')
    await new Promise((r) => setTimeout(r, 10))

    const confirmEvent = events.find((e) => e.type === 'confirm-request') as
      { type: 'confirm-request'; id: string } | undefined
    loop.resolveConfirm(confirmEvent!.id, true)
    await run

    expect(executed).toBe(true)
  })

  it("responds honestly when the router doesn't understand the command", async () => {
    const { loop, spoken } = makeFakes({
      routePlan: {
        intent: 'unknown',
        understood: false,
        plan: { goal: '', steps: [] },
        response: "I didn't understand that."
      } as RouteResult
    })

    await loop.handleUtterance('askjdhfkajshdf')

    expect(spoken).toEqual(["I didn't understand that."])
  })
})
