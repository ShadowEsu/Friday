import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { Tool, ToolResult } from '../agent/types'
import { resolveSectionUrl } from '../agent/sites'
import {
  CalendarEvent,
  addDays,
  computeFreeSlots,
  createEventUrl,
  dayUrl,
  formatTimeRange,
  nextUpcoming,
  parseEventTimeRange
} from './calendarTime'

export interface BrowserControllerOptions {
  headless?: boolean
  /** Playwright browser channel, e.g. 'chrome' to drive the user's real installed Chrome */
  channel?: string
  /** Override the browser binary Playwright launches - mainly used by tests */
  executablePath?: string
  userDataDir?: string
  /** Injected so the browser layer never has to import Electron directly (keeps it unit-testable) */
  clipboardWriter?: (text: string) => void
  clipboardReader?: () => string
}

const MAX_READ_CHARS = 6000

/**
 * Owns a single persistent browser context (real user profile, so existing logins survive)
 * and exposes generic, site-agnostic primitives. Site-specific tools are thin wrappers below
 * that pick sensible selectors using the priority order: role+label, DOM text, form label,
 * placeholder, then a stable CSS selector.
 */
export class BrowserController {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null

  constructor(private opts: BrowserControllerOptions = {}) {}

  async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page
    if (!this.context) {
      if (this.opts.userDataDir) {
        this.context = await chromium.launchPersistentContext(this.opts.userDataDir, {
          headless: this.opts.headless ?? false,
          channel: this.opts.channel,
          executablePath: this.opts.executablePath,
          viewport: null
        })
        this.browser = null
      } else {
        this.browser = await chromium.launch({
          headless: this.opts.headless ?? true,
          channel: this.opts.channel,
          executablePath: this.opts.executablePath
        })
        this.context = await this.browser.newContext({ viewport: { width: 1280, height: 800 } })
      }
    }
    const pages = this.context.pages()
    this.page = pages[0] ?? (await this.context.newPage())
    return this.page
  }

  async listTabs(): Promise<{ index: number; url: string; title: string }[]> {
    if (!this.context) return []
    const pages = this.context.pages()
    return Promise.all(
      pages.map(async (p, i) => ({
        index: i,
        url: p.url(),
        title: await p.title().catch(() => '')
      }))
    )
  }

  async newTab(): Promise<Page> {
    const ctx = this.context ?? (await this.ensurePage(), this.context!)
    const page = await ctx.newPage()
    this.page = page
    return page
  }

  async switchTab(index: number): Promise<boolean> {
    if (!this.context) return false
    const pages = this.context.pages()
    if (index < 0 || index >= pages.length) return false
    this.page = pages[index]
    await this.page.bringToFront()
    return true
  }

  async openUrl(url: string): Promise<ToolResult> {
    const page = await this.ensurePage()
    const target = /^https?:\/\//.test(url) ? url : `https://${url}`
    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {})
      const currentUrl = page.url()
      const verified = currentUrl.length > 0 && !currentUrl.startsWith('chrome-error://')
      return {
        ok: verified,
        message: verified ? `Opened ${currentUrl}` : `Navigation to ${target} did not complete`,
        data: { url: currentUrl, title: await page.title().catch(() => '') },
        verified
      }
    } catch (err) {
      return {
        ok: false,
        message: `Could not open ${target}: ${err instanceof Error ? err.message : err}`,
        verified: false
      }
    }
  }

  async goBack(): Promise<ToolResult> {
    const page = await this.ensurePage()
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
    return { ok: true, message: 'Went back', data: { url: page.url() }, verified: true }
  }

  async readVisibleText(): Promise<string> {
    const page = await this.ensurePage()
    const text = await page.evaluate(() => document.body?.innerText ?? '')
    return text.trim().slice(0, MAX_READ_CHARS)
  }

  /** Best-effort extraction of repeated list-like items (messages, requests, search results). */
  async readListItems(maxItems = 10): Promise<string[]> {
    const page = await this.ensurePage()
    const items = await page.evaluate((max) => {
      const candidates = Array.from(document.querySelectorAll('li, [role="listitem"], article'))
      return candidates
        .map((el) => (el as HTMLElement).innerText?.trim())
        .filter((t): t is string => !!t && t.length > 0 && t.length < 500)
        .slice(0, max)
    }, maxItems)
    return items
  }

  private async locateByText(target: string): Promise<ReturnType<Page['getByText']> | null> {
    const page = await this.ensurePage()
    const byRoleButton = page.getByRole('button', { name: new RegExp(escapeRegex(target), 'i') })
    if (await byRoleButton.count()) return byRoleButton.first()
    const byRoleLink = page.getByRole('link', { name: new RegExp(escapeRegex(target), 'i') })
    if (await byRoleLink.count()) return byRoleLink.first()
    const byText = page.getByText(new RegExp(escapeRegex(target), 'i'), { exact: false })
    if (await byText.count()) return byText.first()
    return null
  }

  async clickByText(target: string): Promise<ToolResult> {
    const locator = await this.locateByText(target)
    if (!locator)
      return {
        ok: false,
        message: `Couldn't find anything matching "${target}" to click`,
        verified: false
      }
    try {
      await locator.click({ timeout: 8000 })
      return { ok: true, message: `Clicked "${target}"`, verified: true }
    } catch (err) {
      return {
        ok: false,
        message: `Found "${target}" but couldn't click it: ${err instanceof Error ? err.message : err}`,
        verified: false
      }
    }
  }

  async typeText(text: string, target?: string): Promise<ToolResult> {
    const page = await this.ensurePage()
    let field
    if (target) {
      field = page
        .getByLabel(new RegExp(escapeRegex(target), 'i'))
        .or(page.getByPlaceholder(new RegExp(escapeRegex(target), 'i')))
    } else {
      field = page.getByRole('textbox').last()
    }
    try {
      await field.first().fill(text, { timeout: 8000 })
      return { ok: true, message: `Typed into ${target ?? 'the active field'}`, verified: true }
    } catch {
      try {
        await page.keyboard.type(text)
        return {
          ok: true,
          message: 'Typed using the keyboard (no matching field found)',
          verified: false
        }
      } catch (err) {
        return {
          ok: false,
          message: `Couldn't type text: ${err instanceof Error ? err.message : err}`,
          verified: false
        }
      }
    }
  }

  async scroll(direction: 'up' | 'down'): Promise<ToolResult> {
    const page = await this.ensurePage()
    const delta = direction === 'down' ? 800 : -800
    await page.mouse.wheel(0, delta)
    return { ok: true, message: `Scrolled ${direction}`, verified: true }
  }

  async search(query: string): Promise<ToolResult> {
    const page = await this.ensurePage()
    const host = new URL(page.url().startsWith('http') ? page.url() : 'https://example.com')
      .hostname
    try {
      if (host.includes('youtube.com')) {
        const box = page.getByRole('combobox', { name: /search/i }).or(page.locator('input#search'))
        await box.first().fill(query, { timeout: 8000 })
        await page.keyboard.press('Enter')
      } else if (host.includes('google.com')) {
        const box = page.getByRole('combobox').or(page.locator('input[name="q"]'))
        await box.first().fill(query, { timeout: 8000 })
        await page.keyboard.press('Enter')
      } else {
        await this.openUrl(`https://www.google.com/search?q=${encodeURIComponent(query)}`)
        return { ok: true, message: `Searched the web for "${query}"`, verified: true }
      }
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
      return { ok: true, message: `Searched for "${query}"`, verified: true }
    } catch (err) {
      return {
        ok: false,
        message: `Search failed: ${err instanceof Error ? err.message : err}`,
        verified: false
      }
    }
  }

  async openResult(index: number, preferOfficial: boolean): Promise<ToolResult> {
    const page = await this.ensurePage()
    const host = new URL(page.url().startsWith('http') ? page.url() : 'https://example.com')
      .hostname
    try {
      if (host.includes('youtube.com')) {
        const titles = page.locator('ytd-video-renderer #video-title, a#video-title')
        const count = await titles.count()
        if (count === 0) return { ok: false, message: 'No search results found', verified: false }
        let chosen = index
        if (preferOfficial) {
          for (let i = 0; i < count; i++) {
            const text =
              (await titles
                .nth(i)
                .innerText()
                .catch(() => '')) ?? ''
            if (/official/i.test(text)) {
              chosen = i
              break
            }
          }
        }
        const target = titles.nth(Math.min(chosen, count - 1))
        const label = await target.innerText().catch(() => '')
        await target.click({ timeout: 8000 })
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
        return {
          ok: true,
          message: `Opened result "${label}"`,
          data: { title: label },
          verified: page.url().includes('/watch')
        }
      }
      // generic organic search result links
      const links = page.locator('a h3, a[data-testid="result-title-a"]')
      const count = await links.count()
      if (count === 0) return { ok: false, message: 'No search results found', verified: false }
      const target = links.nth(Math.min(index, count - 1))
      const label = await target.innerText().catch(() => '')
      const anchor = target.locator('xpath=ancestor::a[1]')
      await anchor.click({ timeout: 8000 })
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
      return {
        ok: true,
        message: `Opened result "${label}"`,
        data: { title: label },
        verified: true
      }
    } catch (err) {
      return {
        ok: false,
        message: `Couldn't open the result: ${err instanceof Error ? err.message : err}`,
        verified: false
      }
    }
  }

  async navigateSection(section: string, siteName?: string): Promise<ToolResult> {
    const directUrl = siteName ? resolveSectionUrl(siteName, section) : undefined
    if (directUrl) return this.openUrl(directUrl)

    const result = await this.clickByText(section)
    if (!result.ok) return result
    const page = await this.ensurePage()
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {})
    return { ...result, message: `Navigated to ${section}` }
  }

  async submit(): Promise<ToolResult> {
    const page = await this.ensurePage()
    const sendButton = page.getByRole('button', { name: /send|submit|run/i })
    if (await sendButton.count()) {
      await sendButton.first().click({ timeout: 8000 })
      return { ok: true, message: 'Submitted', verified: true }
    }
    await page.keyboard.press('Enter')
    return { ok: true, message: 'Submitted with Enter (no send button found)', verified: false }
  }

  async paste(): Promise<ToolResult> {
    if (this.opts.clipboardReader) {
      const text = this.opts.clipboardReader()
      if (text) return this.typeText(text)
    }
    const page = await this.ensurePage()
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${modifier}+KeyV`)
    return { ok: true, message: 'Pasted from the system clipboard', verified: false }
  }

  async copyLatestResponse(): Promise<ToolResult> {
    const page = await this.ensurePage()
    const host = new URL(page.url().startsWith('http') ? page.url() : 'https://example.com')
      .hostname
    let text = ''
    try {
      if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) {
        const messages = page.locator('[data-message-author-role="assistant"]')
        text =
          (await messages
            .last()
            .innerText()
            .catch(() => '')) ?? ''
      } else if (host.includes('claude.ai')) {
        const messages = page.locator('[data-testid="message"], .font-claude-message')
        text =
          (await messages
            .last()
            .innerText()
            .catch(() => '')) ?? ''
      } else {
        text = await this.readVisibleText()
      }
    } catch {
      text = ''
    }
    if (!text) return { ok: false, message: 'Could not find a response to copy', verified: false }
    if (this.opts.clipboardWriter) this.opts.clipboardWriter(text)
    return { ok: true, message: 'Copied the latest response', data: { text }, verified: true }
  }

  async waitForCompletion(timeoutMs = 90000): Promise<ToolResult> {
    const page = await this.ensurePage()
    const stopButton = page.getByRole('button', { name: /stop generating|stop streaming/i })
    const start = Date.now()
    try {
      if (await stopButton.count()) {
        await stopButton.first().waitFor({ state: 'detached', timeout: timeoutMs })
      } else {
        await page.waitForTimeout(2000)
      }
      return {
        ok: true,
        message: `Generation finished after ${Math.round((Date.now() - start) / 1000)}s`,
        verified: true
      }
    } catch {
      return { ok: false, message: 'Timed out waiting for generation to finish', verified: false }
    }
  }

  async selectModel(modelName: string): Promise<ToolResult> {
    const page = await this.ensurePage()
    const selector = page.getByRole('button', { name: /model|opus|sonnet|haiku|gpt/i })
    if (!(await selector.count())) {
      return { ok: false, message: 'No model selector found on this page', verified: false }
    }
    await selector
      .first()
      .click({ timeout: 8000 })
      .catch(() => {})
    const option = page
      .getByRole('menuitemradio', { name: new RegExp(escapeRegex(modelName), 'i') })
      .or(page.getByRole('option', { name: new RegExp(escapeRegex(modelName), 'i') }))
    if (await option.count()) {
      await option.first().click({ timeout: 8000 })
      return { ok: true, message: `Selected ${modelName}`, verified: true }
    }
    await page.keyboard.press('Escape').catch(() => {})
    return {
      ok: false,
      message: `${modelName} is not available in the model selector`,
      verified: true
    }
  }

  async mediaSetPlaying(shouldPlay: boolean): Promise<ToolResult> {
    const page = await this.ensurePage()
    const before = await page.evaluate(
      () => (document.querySelector('video') as HTMLVideoElement | null)?.paused
    )
    if (before === undefined)
      return { ok: false, message: 'No video found on this page', verified: false }
    await page.evaluate((play) => {
      const v = document.querySelector('video') as HTMLVideoElement | null
      if (v) play ? v.play() : v.pause()
    }, shouldPlay)
    const after = await page.evaluate(
      () => (document.querySelector('video') as HTMLVideoElement | null)?.paused
    )
    const verified = shouldPlay ? after === false : after === true
    return {
      ok: verified,
      message: shouldPlay
        ? verified
          ? 'Playing'
          : 'Could not resume playback'
        : verified
          ? 'Paused'
          : 'Could not pause',
      data: { paused: after },
      verified
    }
  }

  async mediaSeek(deltaSeconds: number): Promise<ToolResult> {
    const page = await this.ensurePage()
    const result = await page.evaluate((delta) => {
      const v = document.querySelector('video') as HTMLVideoElement | null
      if (!v) return null
      const before = v.currentTime
      v.currentTime = Math.max(0, before + delta)
      return { before, after: v.currentTime }
    }, deltaSeconds)
    if (!result) return { ok: false, message: 'No video found on this page', verified: false }
    return {
      ok: true,
      message: `Seeked ${deltaSeconds > 0 ? 'forward' : 'back'} ${Math.abs(deltaSeconds)} seconds`,
      data: result,
      verified: result.after !== result.before
    }
  }

  async toggleCaptions(): Promise<ToolResult> {
    const page = await this.ensurePage()
    await page.keyboard.press('c')
    return { ok: true, message: 'Toggled captions', verified: false }
  }

  /** Finds a conversation/project by its visible title (ChatGPT/Claude sidebar, YouTube history, etc.). */
  async openConversationByTitle(title: string): Promise<ToolResult> {
    const page = await this.ensurePage()
    const pattern = new RegExp(escapeRegex(title), 'i')
    const candidate = page
      .getByRole('link', { name: pattern })
      .or(page.getByRole('button', { name: pattern }))
      .or(page.getByText(pattern, { exact: false }))
    const count = await candidate.count().catch(() => 0)
    if (count === 0) {
      return {
        ok: false,
        message: `Couldn't find "${title}" in the visible list. It may not be open here, or the name doesn't match exactly.`,
        verified: false
      }
    }
    try {
      await candidate.first().click({ timeout: 8000 })
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
      return { ok: true, message: `Opened "${title}"`, verified: true }
    } catch (err) {
      return {
        ok: false,
        message: `Found "${title}" but couldn't open it: ${err instanceof Error ? err.message : err}`,
        verified: false
      }
    }
  }

  async acceptFirstConnectionRequest(): Promise<ToolResult> {
    const page = await this.ensurePage()
    const acceptButton = page.getByRole('button', { name: /^accept$/i })
    if (!(await acceptButton.count())) {
      return { ok: false, message: 'No visible connection request to accept', verified: false }
    }
    const nameNear = await acceptButton
      .first()
      .locator('xpath=ancestor::li[1]')
      .innerText()
      .catch(() => '')
    await acceptButton.first().click({ timeout: 8000 })
    return {
      ok: true,
      message: `Accepted connection request${nameNear ? ` from ${nameNear.split('\n')[0]}` : ''}`,
      verified: true
    }
  }

  /**
   * Reads events for a given day off calendar.google.com. Google Calendar event chips expose
   * their time range in an `aria-label` (role+label - the spec's preferred selector strategy),
   * so this doesn't depend on any particular visual layout.
   */
  async readCalendarEvents(which: 'today' | 'tomorrow' = 'today'): Promise<{
    events: CalendarEvent[]
    raw: string[]
  }> {
    const day = which === 'tomorrow' ? addDays(new Date(), 1) : new Date()
    const page = await this.ensurePage()
    await page.goto(dayUrl(day), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(1000)
    const labels = await page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll('[role="button"][data-eventid], [data-eventid]')
      )
      return nodes
        .map((el) => el.getAttribute('aria-label') || (el as HTMLElement).innerText)
        .filter((t): t is string => !!t && t.trim().length > 0)
    })
    const raw = Array.from(new Set(labels.map((l) => l.trim())))
    const events: CalendarEvent[] = []
    for (const label of raw) {
      const range = parseEventTimeRange(label, day)
      if (range) events.push({ label: label.split(',')[0].trim(), ...range })
    }
    return { events, raw }
  }

  async nextMeeting(): Promise<ToolResult> {
    const { events, raw } = await this.readCalendarEvents('today')
    if (events.length === 0 && raw.length === 0) {
      return {
        ok: true,
        message: "You don't have any events on your calendar today.",
        verified: true
      }
    }
    const next = nextUpcoming(events, new Date())
    if (!next) {
      return { ok: true, message: "You've got no more meetings today.", verified: true }
    }
    return {
      ok: true,
      message: `Your next meeting is "${next.label}" at ${formatTimeRange(next)}.`,
      data: { title: next.label, start: next.start.toISOString(), end: next.end.toISOString() },
      verified: true
    }
  }

  async findFreeTime(): Promise<ToolResult> {
    const { events } = await this.readCalendarEvents('today')
    const now = new Date()
    const dayStart = new Date(now)
    dayStart.setHours(9, 0, 0, 0)
    const dayEnd = new Date(now)
    dayEnd.setHours(18, 0, 0, 0)
    const start = now > dayStart ? now : dayStart
    if (start >= dayEnd) {
      return {
        ok: true,
        message: "It's past the end of your working day - no free time left today.",
        verified: true
      }
    }
    const free = computeFreeSlots(
      events.map((e) => ({ start: e.start, end: e.end })),
      start,
      dayEnd
    )
    if (free.length === 0) {
      return { ok: true, message: "You're fully booked for the rest of the day.", verified: true }
    }
    const summary = free.map((f) => formatTimeRange(f)).join(', ')
    return {
      ok: true,
      message: `You have free time: ${summary}.`,
      data: {
        slots: free.map((f) => ({ start: f.start.toISOString(), end: f.end.toISOString() }))
      },
      verified: true
    }
  }

  async openMeetingLink(): Promise<ToolResult> {
    const page = await this.ensurePage()
    const link = page
      .getByRole('link', { name: /meet|zoom|join/i })
      .or(page.getByRole('button', { name: /join with google meet|join now/i }))
    if (!(await link.count())) {
      return { ok: false, message: "I couldn't find a meeting link on this event", verified: false }
    }
    await link.first().click({ timeout: 8000 })
    return { ok: true, message: 'Opened the meeting link', verified: true }
  }

  async createEvent(details: {
    title: string
    start: Date
    end: Date
    description?: string
    location?: string
  }): Promise<ToolResult> {
    const page = await this.ensurePage()
    const url = createEventUrl(details)
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(1000)
      const saveButton = page.getByRole('button', { name: /^save$/i })
      if (await saveButton.count()) {
        await saveButton.first().click({ timeout: 8000 })
        await page.waitForTimeout(1000)
      }
      return {
        ok: true,
        message: `Created "${details.title}" at ${formatTimeRange({ start: details.start, end: details.end })}`,
        verified: true
      }
    } catch (err) {
      return {
        ok: false,
        message: `Couldn't create the event: ${err instanceof Error ? err.message : err}`,
        verified: false
      }
    }
  }

  async gatherNews(topic: string): Promise<{ headlines: string[] }> {
    const page = await this.ensurePage()
    await this.openUrl(
      `https://news.google.com/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`
    )
    await page.waitForTimeout(1500)
    const headlines = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('article'))
      return nodes
        .map((el) => (el as HTMLElement).innerText?.split('\n')[0]?.trim())
        .filter((t): t is string => !!t && t.length > 0)
    })
    return { headlines }
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {})
    await this.browser?.close().catch(() => {})
    this.context = null
    this.browser = null
    this.page = null
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface Summarizer {
  summarize(text: string, instruction?: string): Promise<{ summary: string; usedLlm: boolean }>
}

export function createBrowserTools(controller: BrowserController, summarizer?: Summarizer): Tool[] {
  const t = (
    name: string,
    description: string,
    sensitive: boolean,
    execute: Tool['execute']
  ): Tool => ({
    name,
    description,
    sensitive,
    execute
  })

  return [
    t(
      'browser_open_url',
      'Navigate the browser to a URL and verify it loaded',
      false,
      async (args) => controller.openUrl(String(args.url))
    ),
    t('browser_go_back', 'Go back to the previous page', false, async () => controller.goBack()),
    t(
      'browser_search',
      'Search using the search box on the current site (or the web generally)',
      false,
      async (args) => controller.search(String(args.query))
    ),
    t(
      'browser_open_result',
      'Open a search result by position, optionally preferring an official one',
      false,
      async (args) => controller.openResult(Number(args.index ?? 0), Boolean(args.preferOfficial))
    ),
    t(
      'browser_navigate_section',
      'Go to a named section of the current site (messages, requests, notifications, etc.)',
      false,
      async (args, ctx) =>
        controller.navigateSection(String(args.section), ctx.agentContext.currentSite)
    ),
    t(
      'browser_open_conversation',
      'Open a conversation or project from a visible list by its title (ChatGPT/Claude sidebar, etc.)',
      false,
      async (args) => controller.openConversationByTitle(String(args.title))
    ),
    t('browser_read', 'Read the visible text content of the current page', false, async () => {
      const text = await controller.readVisibleText()
      return {
        ok: text.length > 0,
        message: text || 'The page appears empty',
        data: { text },
        verified: true
      }
    }),
    t(
      'browser_read_list',
      'Read each visible list-like item on the current page (messages, requests, results)',
      false,
      async () => {
        const items = await controller.readListItems()
        return {
          ok: items.length > 0,
          message: items.join('\n---\n') || 'No list items found',
          data: { items },
          verified: true
        }
      }
    ),
    t(
      'browser_summarize_list',
      'Summarize the visible list items on the page (messages, requests, headlines)',
      false,
      async (args) => {
        const items = await controller.readListItems()
        if (items.length === 0)
          return { ok: false, message: 'Nothing visible to summarize', verified: true }
        const text = items.join('\n---\n')
        if (!summarizer) {
          return { ok: true, message: items.join('. '), data: { items }, verified: true }
        }
        const instruction = args.instruction
          ? String(args.instruction)
          : 'Summarize these items for the user in a few spoken sentences, noting anything time-sensitive or that needs a reply.'
        const { summary } = await summarizer.summarize(text, instruction)
        return { ok: true, message: summary, data: { items, summary }, verified: true }
      }
    ),
    t(
      'browser_summarize',
      'Summarize the visible text content of the current page',
      false,
      async (args) => {
        const text = await controller.readVisibleText()
        if (!text) return { ok: false, message: 'The page appears empty', verified: true }
        if (!summarizer) {
          const excerpt = text.length > 400 ? `${text.slice(0, 400)}...` : text
          return {
            ok: true,
            message: `Local model isn't connected, so here's the raw text: ${excerpt}`,
            data: { text },
            verified: true
          }
        }
        const instruction = args.instruction ? String(args.instruction) : undefined
        const { summary } = await summarizer.summarize(text, instruction)
        return { ok: true, message: summary, data: { text, summary }, verified: true }
      }
    ),
    t('browser_click', 'Click a button or link matching the given text', false, async (args) =>
      controller.clickByText(String(args.target))
    ),
    t(
      'browser_type',
      'Type text into a field, matched by label/placeholder when given',
      false,
      async (args) =>
        controller.typeText(String(args.text), args.target ? String(args.target) : undefined)
    ),
    t('browser_scroll', 'Scroll the page up or down', false, async (args) =>
      controller.scroll(args.direction === 'up' ? 'up' : 'down')
    ),
    t(
      'browser_submit',
      'Submit the current input (send/submit/run button, or Enter)',
      false,
      async () => controller.submit()
    ),
    t('browser_paste', 'Paste the clipboard contents into the active field', false, async () =>
      controller.paste()
    ),
    t(
      'browser_copy_response',
      'Copy the latest AI response on the page to the clipboard',
      false,
      async () => controller.copyLatestResponse()
    ),
    t(
      'browser_wait_for_completion',
      'Wait until an in-progress AI response finishes generating',
      false,
      async () => controller.waitForCompletion()
    ),
    t(
      'browser_select_model',
      'Select a model from a visible model picker, if available',
      false,
      async (args) => controller.selectModel(String(args.model))
    ),
    t('media_play', 'Resume video playback', false, async () => controller.mediaSetPlaying(true)),
    t('media_pause', 'Pause video playback', false, async () => controller.mediaSetPlaying(false)),
    t(
      'media_seek',
      'Seek the current video forward or backward by N seconds',
      false,
      async (args) => controller.mediaSeek(Number(args.deltaSeconds ?? 0))
    ),
    t('media_toggle_captions', 'Toggle video captions', false, async () =>
      controller.toggleCaptions()
    ),
    t(
      'linkedin_accept_request',
      'Accept the first visible LinkedIn connection request',
      true,
      async () => controller.acceptFirstConnectionRequest()
    ),
    t(
      'calendar_read_events',
      "Read today's or tomorrow's Google Calendar events",
      false,
      async (args) => {
        const which = args.day === 'tomorrow' ? 'tomorrow' : 'today'
        const { events, raw } = await controller.readCalendarEvents(which)
        if (raw.length === 0) {
          return {
            ok: true,
            message: `You have no events ${which}.`,
            data: { events: [] },
            verified: true
          }
        }
        const list = (events.length > 0 ? events.map((e) => e.label) : raw).join(', ')
        return {
          ok: true,
          message: `${which === 'today' ? "Today's" : "Tomorrow's"} events: ${list}.`,
          data: { events },
          verified: true
        }
      }
    ),
    t('calendar_next_meeting', "Read the user's next upcoming meeting today", false, async () =>
      controller.nextMeeting()
    ),
    t(
      'calendar_find_free_time',
      "Find free time on the user's calendar for the rest of the working day",
      false,
      async () => controller.findFreeTime()
    ),
    t(
      'calendar_open_meeting_link',
      'Open the video call link on the currently visible calendar event',
      false,
      async () => controller.openMeetingLink()
    ),
    t(
      'calendar_create_event',
      'Create a new Google Calendar event (requires confirmation)',
      true,
      async (args) => {
        const start = new Date(String(args.start))
        const end = new Date(String(args.end))
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          return {
            ok: false,
            message: 'Missing or invalid start/end time for the event',
            verified: false
          }
        }
        return controller.createEvent({
          title: String(args.title ?? 'New event'),
          start,
          end,
          description: args.description ? String(args.description) : undefined,
          location: args.location ? String(args.location) : undefined
        })
      }
    )
  ]
}
