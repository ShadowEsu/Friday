import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'path'
import { BrowserController } from '../../src/main/tools/browser'
import { startFixtureServer, TestServer } from '../helpers/staticServer'

// This sandbox has no display and no network access to real sites, so these tests exercise
// BrowserController's generic, site-agnostic primitives against a local static fixture page
// rather than youtube.com/linkedin.com/etc. Site-specific selector heuristics in browser.ts
// (YouTube/LinkedIn/ChatGPT/Claude) are documented as untested in docs/LIMITATIONS.md and need
// validation against the real sites on the user's Mac.
const CHROMIUM_PATH = '/opt/pw-browsers/chromium'

describe('BrowserController', () => {
  let server: TestServer
  let controller: BrowserController

  beforeAll(async () => {
    server = await startFixtureServer(join(__dirname, '..', 'fixtures'))
    controller = new BrowserController({ headless: true, executablePath: CHROMIUM_PATH })
  })

  afterAll(async () => {
    await controller.close()
    await server.close()
  })

  it('opens a URL and verifies navigation', async () => {
    const result = await controller.openUrl(server.url)
    expect(result.ok).toBe(true)
    expect(result.verified).toBe(true)
    expect((result.data as { title: string }).title).toBe('Friday Test Fixture')
  })

  it('reads visible page text', async () => {
    const text = await controller.readVisibleText()
    expect(text).toContain('hello from the fixture page')
  })

  it('reads list items', async () => {
    const items = await controller.readListItems()
    expect(items).toEqual(expect.arrayContaining(['First item', 'Second item', 'Third item']))
  })

  it('clicks an element by visible text and the click actually takes effect', async () => {
    const before = await controller.readVisibleText()
    expect(before).toContain('Not clicked')

    const result = await controller.clickByText('Click Me')
    expect(result.ok).toBe(true)

    const after = await controller.readVisibleText()
    expect(after).toContain('Clicked!')
  })

  it('reports failure honestly when the target does not exist', async () => {
    const result = await controller.clickByText('This Button Does Not Exist')
    expect(result.ok).toBe(false)
    expect(result.verified).toBe(false)
  })

  it('types into a labeled field', async () => {
    const result = await controller.typeText('hello agent', 'Message')
    expect(result.ok).toBe(true)
    expect(result.verified).toBe(true)
  })

  it('submits via the send button', async () => {
    const before = await controller.readVisibleText()
    expect(before).toContain('Not submitted')

    const result = await controller.submit()
    expect(result.ok).toBe(true)

    const after = await controller.readVisibleText()
    expect(after).toContain('Submitted!')
  })

  it('scrolls the page', async () => {
    const result = await controller.scroll('down')
    expect(result.ok).toBe(true)
  })

  it('plays and pauses a video element, verifying the actual state', async () => {
    const play = await controller.mediaSetPlaying(true)
    expect(play.ok).toBe(true)
    expect(play.data).toEqual({ paused: false })

    const pause = await controller.mediaSetPlaying(false)
    expect(pause.ok).toBe(true)
    expect(pause.data).toEqual({ paused: true })
  })

  it('seeks the video and verifies the new position', async () => {
    const result = await controller.mediaSeek(30)
    expect(result.ok).toBe(true)
    expect(result.verified).toBe(true)
    expect((result.data as { after: number }).after).toBeGreaterThan(0)
  })
})
