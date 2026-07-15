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

  /**
   * Free-form text generation for summarization/synthesis tasks (not tool routing).
   * Returns null on any failure so callers can fall back to an honest non-LLM behavior
   * instead of pretending a summary was produced.
   */
  async complete(
    systemPrompt: string,
    userPrompt: string,
    timeoutMs = 30000
  ): Promise<string | null> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          stream: false,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          options: { temperature: 0.2 }
        }),
        signal: controller.signal
      })
      clearTimeout(timeout)
      if (!res.ok) return null
      const json = (await res.json()) as { message?: { content?: string } }
      const content = json.message?.content?.trim()
      return content && content.length > 0 ? content : null
    } catch {
      return null
    }
  }

  /** Summarize arbitrary text. Falls back to a truncated excerpt if the local model is unreachable. */
  async summarize(
    text: string,
    instruction = 'Summarize this concisely for a spoken response.'
  ): Promise<{
    summary: string
    usedLlm: boolean
  }> {
    const trimmed = text.trim()
    if (!trimmed) return { summary: 'There was nothing to summarize.', usedLlm: false }
    const result = await this.complete(
      'You summarize web page and conversation content for a voice assistant. Be concise (2-5 sentences), plain spoken language, no markdown, no headers.',
      `${instruction}\n\n---\n${trimmed.slice(0, 12000)}\n---`
    )
    if (result) return { summary: result, usedLlm: true }
    const fallback = trimmed.length > 400 ? `${trimmed.slice(0, 400)}...` : trimmed
    return {
      summary: `I couldn't reach the local model to summarize this, so here's the raw excerpt: ${fallback}`,
      usedLlm: false
    }
  }
}
