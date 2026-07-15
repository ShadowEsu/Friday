import { Tool } from '../agent/types'

/**
 * Phase 5 in the product spec (calendar/messages/news integrations) isn't built yet - this
 * tool gives an honest, useful briefing today (time/date) instead of fabricating calendar or
 * message data. Extending it is the natural next step once Calendar/LinkedIn reading tools land.
 */
export const morningBriefingTool: Tool = {
  name: 'morning_briefing',
  description: 'Give a short morning briefing with the current date/time',
  sensitive: false,
  async execute() {
    const now = new Date()
    const dateStr = now.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
    const timeStr = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    const message = `Good morning. It's ${timeStr} on ${dateStr}. Calendar, message, and news summaries aren't connected yet - once they are, I'll fold them into this briefing.`
    return { ok: true, message, data: { date: dateStr, time: timeStr }, verified: true }
  }
}
