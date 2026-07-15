import { Tool, ToolContext, ToolResult } from '../agent/types'

export class ToolRegistry {
  private tools = new Map<string, Tool>()

  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  list(): Tool[] {
    return Array.from(this.tools.values())
  }

  catalog(): { name: string; description: string }[] {
    return this.list().map((t) => ({ name: t.name, description: t.description }))
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { ok: false, message: `Unknown tool: ${name}`, verified: false }
    }
    if (ctx.signal.aborted) {
      return { ok: false, message: 'Cancelled', verified: false }
    }
    try {
      return await tool.execute(args, ctx)
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        verified: false
      }
    }
  }
}
