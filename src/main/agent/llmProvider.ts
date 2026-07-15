import { AgentContext, Plan } from './types'

export interface LlmProviderConfig {
  baseUrl: string
  model: string
}

export interface LlmRouteRequest {
  utterance: string
  context: AgentContext
  toolCatalog: { name: string; description: string }[]
}

const SYSTEM_PROMPT = `You are the command router for Friday, a local personal computer agent.
Given the user's utterance and the available tools, respond with ONLY a JSON object of the form:
{"goal": "short description", "steps": [{"tool": "tool_name", "args": {...}, "label": "human readable step"}]}
If the request is unclear or you cannot map it to the available tools, respond with:
{"goal": "clarify", "steps": [], "response": "a short clarifying question"}
Only use tool names from the provided catalog. Do not invent tools. Do not add commentary outside the JSON.`

/**
 * Thin client for a local Ollama-compatible chat endpoint. Returns null (rather than throwing)
 * when the local model is unreachable or misconfigured so the router can fall back gracefully -
 * Friday must never pretend to understand a command it didn't.
 */
export class OllamaProvider {
  constructor(private config: LlmProviderConfig) {}

  async route(request: LlmRouteRequest): Promise<Plan | { response: string } | null> {
    const catalogText = request.toolCatalog.map((t) => `- ${t.name}: ${t.description}`).join('\n')
    const contextText = request.context.history
      .slice(-6)
      .map((h) => `${h.role}: ${h.text}`)
      .join('\n')

    const body = {
      model: this.config.model,
      stream: false,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nAvailable tools:\n${catalogText}` },
        {
          role: 'user',
          content: `Recent conversation:\n${contextText}\n\nCurrent utterance: "${request.utterance}"`
        }
      ],
      format: 'json',
      options: { temperature: 0 }
    }

    let res: Response
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      res = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      clearTimeout(timeout)
    } catch {
      return null
    }

    if (!res.ok) return null

    try {
      const json = (await res.json()) as { message?: { content?: string } }
      const content = json.message?.content
      if (!content) return null
      const parsed = JSON.parse(content)
      if (parsed.response && (!parsed.steps || parsed.steps.length === 0)) {
        return { response: parsed.response }
      }
      if (Array.isArray(parsed.steps)) {
        return { goal: parsed.goal ?? request.utterance, steps: parsed.steps } as Plan
      }
      return null
    } catch {
      return null
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const res = await fetch(`${this.config.baseUrl}/api/tags`, { signal: controller.signal })
      clearTimeout(timeout)
      return res.ok
    } catch {
      return false
    }
  }
}
