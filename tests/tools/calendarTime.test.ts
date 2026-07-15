import { describe, expect, it } from 'vitest'
import {
  addDays,
  computeFreeSlots,
  createEventUrl,
  dayUrl,
  formatTimeRange,
  nextUpcoming,
  parseEventTimeRange
} from '../../src/main/tools/calendarTime'

const DAY = new Date(2026, 6, 15) // July 15 2026, local time

describe('parseEventTimeRange', () => {
  it('parses a standard Google Calendar aria-label time range', () => {
    const range = parseEventTimeRange('Team sync, 11:00 AM to 11:30 AM, Wednesday, July 15', DAY)
    expect(range).not.toBeNull()
    expect(range!.start.getHours()).toBe(11)
    expect(range!.start.getMinutes()).toBe(0)
    expect(range!.end.getHours()).toBe(11)
    expect(range!.end.getMinutes()).toBe(30)
  })

  it('handles noon and midnight correctly', () => {
    const noon = parseEventTimeRange('Lunch, 12:00 PM to 1:00 PM', DAY)
    expect(noon!.start.getHours()).toBe(12)
    const midnight = parseEventTimeRange('Late thing, 12:00 AM to 12:30 AM', DAY)
    expect(midnight!.start.getHours()).toBe(0)
  })

  it('returns null for a label without a recognizable time range (e.g. all-day event)', () => {
    expect(parseEventTimeRange('Company holiday', DAY)).toBeNull()
  })
})

describe('computeFreeSlots', () => {
  const dayStart = new Date(DAY)
  dayStart.setHours(9, 0, 0, 0)
  const dayEnd = new Date(DAY)
  dayEnd.setHours(18, 0, 0, 0)

  it('finds the single gap around one meeting', () => {
    const meeting = {
      start: new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate(), 11, 0),
      end: new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate(), 11, 30)
    }
    const free = computeFreeSlots([meeting], dayStart, dayEnd)
    expect(free).toHaveLength(2)
    expect(free[0].start.getHours()).toBe(9)
    expect(free[0].end.getHours()).toBe(11)
    expect(free[1].start.getHours()).toBe(11)
    expect(free[1].start.getMinutes()).toBe(30)
    expect(free[1].end.getHours()).toBe(18)
  })

  it('merges overlapping busy blocks instead of reporting a fake gap between them', () => {
    const a = { start: hour(10), end: hour(11) }
    const b = { start: hour(10.5), end: hour(12) }
    const free = computeFreeSlots([a, b], dayStart, dayEnd)
    // no gap should appear between 10 and 12 since the two events overlap
    const gapInsideOverlap = free.some((f) => f.start.getHours() >= 10 && f.end.getHours() <= 12)
    expect(gapInsideOverlap).toBe(false)
  })

  it('reports fully booked when busy spans the whole window', () => {
    const free = computeFreeSlots([{ start: dayStart, end: dayEnd }], dayStart, dayEnd)
    expect(free).toHaveLength(0)
  })

  function hour(h: number): Date {
    const d = new Date(DAY)
    d.setHours(Math.floor(h), (h % 1) * 60, 0, 0)
    return d
  }
})

describe('nextUpcoming', () => {
  it('picks the earliest event that has not ended yet', () => {
    const now = new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate(), 10, 0)
    const past = { label: 'Standup', start: hourOf(9), end: hourOf(9.5) }
    const soon = { label: 'Design review', start: hourOf(11), end: hourOf(11.5) }
    const later = { label: '1:1', start: hourOf(14), end: hourOf(14.5) }
    const next = nextUpcoming([later, past, soon], now)
    expect(next?.label).toBe('Design review')
  })

  it('returns null when every event today has already ended', () => {
    const now = new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate(), 20, 0)
    const past = { label: 'Standup', start: hourOf(9), end: hourOf(9.5) }
    expect(nextUpcoming([past], now)).toBeNull()
  })

  function hourOf(h: number): Date {
    const d = new Date(DAY)
    d.setHours(Math.floor(h), (h % 1) * 60, 0, 0)
    return d
  }
})

describe('dayUrl / addDays', () => {
  it('builds a Google Calendar day-view URL for the given date', () => {
    expect(dayUrl(DAY)).toBe('https://calendar.google.com/calendar/r/day/2026/07/15')
  })

  it('adds days correctly across a month boundary', () => {
    const endOfMonth = new Date(2026, 6, 31)
    const next = addDays(endOfMonth, 1)
    expect(next.getMonth()).toBe(7)
    expect(next.getDate()).toBe(1)
  })
})

describe('formatTimeRange', () => {
  it('formats a start/end pair as human-readable text', () => {
    const start = new Date(DAY)
    start.setHours(11, 0, 0, 0)
    const end = new Date(DAY)
    end.setHours(11, 30, 0, 0)
    expect(formatTimeRange({ start, end })).toMatch(/11:00.*to.*11:30/i)
  })
})

describe('createEventUrl', () => {
  it('builds a valid Google Calendar quick-add URL with the expected params', () => {
    const start = new Date(Date.UTC(2026, 6, 15, 18, 0, 0))
    const end = new Date(Date.UTC(2026, 6, 15, 18, 30, 0))
    const url = createEventUrl({ title: 'Sync with Jordan', start, end })
    expect(url).toContain('https://calendar.google.com/calendar/render?')
    expect(url).toContain('action=TEMPLATE')
    expect(url).toContain('text=Sync+with+Jordan')
    expect(url).toContain('dates=20260715T180000Z%2F20260715T183000Z')
  })
})
