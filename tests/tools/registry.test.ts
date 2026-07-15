import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '../../src/main/tools/registry'
import { Tool } from '../../src/main/agent/types'

function makeTool(name: string, execute: Tool['execute'], sensitive = false): Tool {
  return { name, description: `test tool ${name}`, sensitive, execute }
}

describe('ToolRegistry', () => {
  it('dispatches to a registered tool', async () => {
    const registry = new ToolRegistry()
    registry.register(
      makeTool('echo', async (args) => ({ ok: true, message: String(args.text), verified: true }))
    )

    const result = await registry.execute(
      'echo',
      { text: 'hi' },
      { agentContext: { history: [] }, signal: new AbortController().signal }
    )
    expect(result).toEqual({ ok: true, message: 'hi', verified: true })
  })

  it('returns a clean failure for an unknown tool instead of throwing', async () => {
    const registry = new ToolRegistry()
    const result = await registry.execute(
      'does_not_exist',
      {},
      { agentContext: { history: [] }, signal: new AbortController().signal }
    )
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Unknown tool')
  })

  it('short-circuits when the signal is already aborted', async () => {
    const registry = new ToolRegistry()
    let called = false
    registry.register(
      makeTool('should_not_run', async () => {
        called = true
        return { ok: true, message: 'ran', verified: true }
      })
    )
    const controller = new AbortController()
    controller.abort()
    const result = await registry.execute(
      'should_not_run',
      {},
      { agentContext: { history: [] }, signal: controller.signal }
    )
    expect(result.ok).toBe(false)
    expect(called).toBe(false)
  })

  it('catches tool exceptions and reports them as failures', async () => {
    const registry = new ToolRegistry()
    registry.register(
      makeTool('throws', async () => {
        throw new Error('boom')
      })
    )
    const result = await registry.execute(
      'throws',
      {},
      { agentContext: { history: [] }, signal: new AbortController().signal }
    )
    expect(result.ok).toBe(false)
    expect(result.message).toContain('boom')
  })

  it('exposes a catalog for the LLM router', () => {
    const registry = new ToolRegistry()
    registry.register(makeTool('a', async () => ({ ok: true, message: '', verified: true })))
    registry.register(makeTool('b', async () => ({ ok: true, message: '', verified: true })))
    expect(
      registry
        .catalog()
        .map((t) => t.name)
        .sort()
    ).toEqual(['a', 'b'])
  })
})
