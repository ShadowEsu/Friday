import { Tool } from '../agent/types'
import { BrowserController, Summarizer } from './browser'
import { dedupeHeadlines } from './news'
import { formatTimeRange } from './calendarTime'

/**
 * The "Good Morning" routine (Phase 5). Composes calendar, LinkedIn, and news reads that each
 * degrade honestly and independently - one source being unreachable (no network, not logged in,
 * calendar empty) doesn't block the others or fabricate data for it.
 */
export function createMorningBriefingTool(
  controller: BrowserController,
  summarizer?: Summarizer
): Tool {
  return {
    name: 'morning_briefing',
    description: "Give a short morning briefing: time, today's calendar, messages, and news",
    sensitive: false,
    async execute() {
      const now = new Date()
      const dateStr = now.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      })
      const timeStr = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      const parts: string[] = [`Good morning. It's ${timeStr} on ${dateStr}.`]

      try {
        const { events } = await controller.readCalendarEvents('today')
        if (events.length > 0) {
          parts.push(
            `You have ${events.length} event${events.length === 1 ? '' : 's'} today. First up: "${events[0].label}" at ${formatTimeRange(events[0])}.`
          )
        } else {
          parts.push('Nothing on your calendar today.')
        }
      } catch {
        parts.push("I couldn't reach your calendar.")
      }

      try {
        await controller.openUrl('https://www.linkedin.com/messaging/')
        const items = await controller.readListItems(10)
        if (items.length > 0) {
          parts.push(
            `You have ${items.length} recent LinkedIn conversation${items.length === 1 ? '' : 's'} visible.`
          )
        }
      } catch {
        parts.push("I couldn't check LinkedIn messages.")
      }

      try {
        const { headlines } = await controller.gatherNews('top news today')
        const deduped = dedupeHeadlines(headlines, 3)
        if (deduped.length > 0) {
          parts.push(`In the news: ${deduped.join('; ')}.`)
        }
      } catch {
        parts.push("I couldn't pull today's news.")
      }

      let message = parts.join(' ')
      if (summarizer) {
        const { summary, usedLlm } = await summarizer.summarize(
          message,
          'Turn this into a short, warm spoken morning briefing in 4-6 sentences. Keep every fact, just make it flow naturally.'
        )
        if (usedLlm) message = summary
      }
      return { ok: true, message, data: { date: dateStr, time: timeStr }, verified: true }
    }
  }
}
