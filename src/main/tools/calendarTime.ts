/**
 * Pure date/time helpers for the Google Calendar tools in `browser.ts`. Kept dependency-free
 * (no Playwright, no Electron) so they're directly unit-testable without a live browser or
 * network access - the actual DOM scraping (aria-label extraction) is the unverified part;
 * everything here is ordinary date arithmetic.
 */

export interface TimeRange {
  start: Date
  end: Date
}

export interface CalendarEvent extends TimeRange {
  label: string
}

const TIME_RANGE_RE =
  /(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)\s*(?:to|[-–—])\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)/i

/**
 * Extracts a start/end time from a Google Calendar event aria-label such as
 * "Team sync, 11:00 AM to 11:30 AM, Monday, July 15" - relative to the given day.
 * Returns null if the label doesn't contain a recognizable time range (e.g. an all-day event).
 */
export function parseEventTimeRange(label: string, referenceDay: Date): TimeRange | null {
  const match = TIME_RANGE_RE.exec(label)
  if (!match) return null
  const [, sh, sm, sap, eh, em, eap] = match
  const start = buildTime(referenceDay, sh, sm, sap)
  const end = buildTime(referenceDay, eh, em, eap)
  if (!start || !end) return null
  return { start, end }
}

function buildTime(
  day: Date,
  hourStr: string,
  minuteStr: string | undefined,
  ampm: string
): Date | null {
  let hour = parseInt(hourStr, 10)
  const minute = minuteStr ? parseInt(minuteStr, 10) : 0
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null
  const isPm = /p/i.test(ampm)
  if (hour === 12) hour = isPm ? 12 : 0
  else if (isPm) hour += 12
  const d = new Date(day)
  d.setHours(hour, minute, 0, 0)
  return d
}

/** Sorts, merges overlapping/adjacent busy intervals, then returns the gaps within [dayStart, dayEnd]. */
export function computeFreeSlots(
  busy: TimeRange[],
  dayStart: Date,
  dayEnd: Date,
  minGapMinutes = 15
): TimeRange[] {
  const sorted = busy
    .map((b) => ({ start: b.start, end: b.end }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const merged: TimeRange[] = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last && range.start.getTime() <= last.end.getTime()) {
      if (range.end > last.end) last.end = range.end
    } else {
      merged.push({ ...range })
    }
  }

  const free: TimeRange[] = []
  let cursor = dayStart
  for (const range of merged) {
    if (range.start > cursor) {
      const gapMinutes = (range.start.getTime() - cursor.getTime()) / 60000
      if (gapMinutes >= minGapMinutes) free.push({ start: cursor, end: range.start })
    }
    if (range.end > cursor) cursor = range.end
  }
  if (dayEnd > cursor) {
    const gapMinutes = (dayEnd.getTime() - cursor.getTime()) / 60000
    if (gapMinutes >= minGapMinutes) free.push({ start: cursor, end: dayEnd })
  }
  return free
}

/** The earliest event that hasn't ended yet, relative to `now`. */
export function nextUpcoming(events: CalendarEvent[], now: Date): CalendarEvent | null {
  const upcoming = events
    .filter((e) => e.end > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
  return upcoming[0] ?? null
}

export function formatTimeRange(range: TimeRange): string {
  const fmt = (d: Date): string =>
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${fmt(range.start)} to ${fmt(range.end)}`
}

export function dayUrl(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `https://calendar.google.com/calendar/r/day/${y}/${m}/${d}`
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function toUtcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

export interface NewEventDetails {
  title: string
  start: Date
  end: Date
  description?: string
  location?: string
}

/**
 * Google Calendar's documented "quick add" URL scheme - navigating here pre-fills the create
 * event form without touching any DOM, which is far more reliable than filling out the create
 * dialog by hand. The event still needs an explicit Save click to actually be created.
 */
export function createEventUrl(details: NewEventDetails): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: details.title,
    dates: `${toUtcStamp(details.start)}/${toUtcStamp(details.end)}`
  })
  if (details.description) params.set('details', details.description)
  if (details.location) params.set('location', details.location)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
