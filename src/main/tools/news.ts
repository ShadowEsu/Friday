import { Tool } from '../agent/types'
import { BrowserController, Summarizer } from './browser'

// Common words that carry little topical meaning - excluded so two unrelated headlines that
// happen to share "after", "new", "says" etc. don't get flagged as the same story.
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'after',
  'says',
  'say',
  'new',
  'today',
  'over',
  'into',
  'amid',
  'report',
  'reports',
  'here',
  'this',
  'that',
  'from',
  'has',
  'have',
  'will',
  'its',
  'his',
  'her',
  'their'
])

function significantTokens(title: string): Set<string> {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return new Set(normalized.split(' ').filter((t) => t.length > 2 && !STOPWORDS.has(t)))
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Removes near-duplicate headlines (the same story reported by multiple outlets, which is the
 * norm for news search results) using Jaccard similarity over significant (non-stopword)
 * tokens rather than exact-string match. Pure and dependency-free so it's directly
 * unit-testable without a live browser or search API.
 */
export function dedupeHeadlines(titles: string[], maxItems = 5): string[] {
  const kept: { original: string; tokens: Set<string> }[] = []
  for (const title of titles) {
    const trimmed = title.trim()
    if (!trimmed || trimmed.length < 8) continue
    const tokens = significantTokens(trimmed)
    if (tokens.size === 0) continue
    const isDup = kept.some((k) => jaccardSimilarity(k.tokens, tokens) > 0.6)
    if (!isDup) kept.push({ original: trimmed, tokens })
    if (kept.length >= maxItems) break
  }
  return kept.map((k) => k.original)
}

export function createNewsTools(controller: BrowserController, summarizer?: Summarizer): Tool[] {
  const newsBriefing: Tool = {
    name: 'news_briefing',
    description: "Gather and read today's top news stories, one at a time",
    sensitive: false,
    async execute(args, ctx) {
      const topic = args.topic ? String(args.topic) : 'top news today'
      const { headlines } = await controller.gatherNews(topic)
      const deduped = dedupeHeadlines(headlines, 5)
      if (deduped.length === 0) {
        return { ok: false, message: "I couldn't find any news right now.", verified: false }
      }
      let stories = deduped
      if (summarizer) {
        const { summary } = await summarizer.summarize(
          deduped.join('\n'),
          'Rewrite each of these headlines as one short, clear spoken sentence, one per line, in the same order, with no numbering or extra commentary.'
        )
        const lines = summary
          .split('\n')
          .map((l) => l.replace(/^[-*\d.\s]+/, '').trim())
          .filter(Boolean)
        if (lines.length >= Math.min(2, deduped.length)) stories = lines
      }
      ctx.agentContext.queue = stories.slice(1)
      return {
        ok: true,
        message: `Here's what happened today. First: ${stories[0]} ${
          stories.length > 1 ? 'Say "next" for more, or "stop".' : ''
        }`.trim(),
        data: { stories, count: stories.length },
        verified: true
      }
    }
  }
  return [newsBriefing]
}

export const queueNextTool: Tool = {
  name: 'queue_next',
  description: 'Read the next item from a pending list (e.g. remaining news stories)',
  sensitive: false,
  async execute(_args, ctx) {
    const queue = ctx.agentContext.queue
    if (!queue || queue.length === 0) {
      return { ok: true, message: "That's everything - nothing more queued up.", verified: true }
    }
    const [next, ...rest] = queue
    ctx.agentContext.queue = rest
    return {
      ok: true,
      message: rest.length > 0 ? next : `${next} That's the last one.`,
      data: { remaining: rest.length },
      verified: true
    }
  }
}
