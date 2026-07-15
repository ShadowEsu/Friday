import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { Tool, ToolResult } from '../agent/types'

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

  async navigateSection(section: string): Promise<ToolResult> {
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

export function createBrowserTools(controller: BrowserController): Tool[] {
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
      'Click a navigation link/section on the current site by name',
      false,
      async (args) => controller.navigateSection(String(args.section))
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
      'browser_summarize',
      'Summarize the visible text content of the current page',
      false,
      async () => {
        const text = await controller.readVisibleText()
        return { ok: text.length > 0, message: text, data: { text }, verified: true }
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
    )
  ]
}
