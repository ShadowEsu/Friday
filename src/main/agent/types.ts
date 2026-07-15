export type {
  AgentStatus,
  ToolCall,
  Plan,
  AgentContext,
  ToolResult,
  ActivityEntry
} from '../../shared/types'

import { AgentContext, Plan, ToolResult } from '../../shared/types'

export interface RouteResult {
  intent: string
  plan: Plan
  understood: boolean
  response?: string
}

export interface ToolContext {
  agentContext: AgentContext
  signal: AbortSignal
}

export interface Tool {
  name: string
  description: string
  sensitive: boolean
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
}
