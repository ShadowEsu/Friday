import { AgentContext, Plan, RouteResult } from './types'
import { parseWithRules } from './rules'
import { OllamaProvider } from './llmProvider'

export interface ToolCatalogEntry {
  name: string
  description: string
}

export class CommandRouter {
  constructor(
    private llm: OllamaProvider | undefined,
    private toolCatalog: ToolCatalogEntry[]
  ) {}

  async route(utterance: string, context: AgentContext): Promise<RouteResult> {
    const trimmed = utterance.trim()
    if (!trimmed) {
      return {
        intent: 'empty',
        understood: false,
        plan: { goal: 'none', steps: [] },
        response: "I didn't catch that."
      }
    }

    const rulePlan = parseWithRules(trimmed, context)
    if (rulePlan) {
      return { intent: rulePlan.steps[0]?.tool ?? 'multi_step', understood: true, plan: rulePlan }
    }

    if (this.llm) {
      const result = await this.llm.route({
        utterance: trimmed,
        context,
        toolCatalog: this.toolCatalog
      })
      if (result && 'response' in result) {
        return {
          intent: 'clarify',
          understood: false,
          plan: { goal: 'clarify', steps: [] },
          response: result.response
        }
      }
      if (result && 'steps' in result) {
        const plan = result as Plan
        const validSteps = plan.steps.filter((s) => this.toolCatalog.some((t) => t.name === s.tool))
        if (validSteps.length > 0) {
          return {
            intent: validSteps[0].tool,
            understood: true,
            plan: { ...plan, steps: validSteps }
          }
        }
      }
    }

    return {
      intent: 'unknown',
      understood: false,
      plan: { goal: 'unknown', steps: [] },
      response: "I didn't understand that command. Could you rephrase it?"
    }
  }
}
