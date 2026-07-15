import { describe, expect, it } from 'vitest'
import { CommandRouter } from '../src/main/agent/router'
import { AgentContext } from '../src/main/agent/types'

function ctx(overrides: Partial<AgentContext> = {}): AgentContext {
  return { history: [], ...overrides }
}

// No LLM provider is wired in these tests - the deterministic rule-based parser must handle
// every command from the product spec's required command list and demo script on its own,
// with no network dependency.
const router = new CommandRouter(undefined, [])

describe('CommandRouter - rule-based parsing (offline, no LLM)', () => {
  it('parses "Open YouTube." into a verified browser navigation step', async () => {
    const result = await router.route('Open YouTube.', ctx())
    expect(result.understood).toBe(true)
    expect(result.plan.steps).toEqual([
      {
        tool: 'browser_open_url',
        args: { url: 'https://www.youtube.com', siteName: 'youtube' },
        label: 'Open youtube'
      }
    ])
  })

  it('parses "Open LinkedIn.", "Open ChatGPT.", and "Open Claude."', async () => {
    const linkedin = await router.route('Open LinkedIn.', ctx())
    expect(linkedin.plan.steps[0].args.url).toBe('https://www.linkedin.com')

    const chatgpt = await router.route('Open ChatGPT.', ctx())
    expect(chatgpt.plan.steps[0].args.url).toBe('https://chatgpt.com')

    const claude = await router.route('Open Claude.', ctx())
    expect(claude.plan.steps[0].args.url).toBe('https://claude.ai')
  })

  it('parses "Search for the newest OpenAI video."', async () => {
    const result = await router.route('Search for the newest OpenAI video.', ctx())
    expect(result.understood).toBe(true)
    expect(result.plan.steps[0]).toEqual({
      tool: 'browser_search',
      args: { query: 'the newest OpenAI video' },
      label: 'Search for "the newest OpenAI video"'
    })
  })

  it('parses "Open the first official result." with the official-preference flag set', async () => {
    const result = await router.route('Open the first official result.', ctx())
    expect(result.plan.steps[0]).toEqual({
      tool: 'browser_open_result',
      args: { index: 0, preferOfficial: true },
      label: 'Open the matching search result'
    })
  })

  it('parses media controls: pause, skip forward thirty seconds', async () => {
    const pause = await router.route('Pause the video.', ctx())
    expect(pause.plan.steps[0].tool).toBe('media_pause')

    const skip = await router.route('Skip forward thirty seconds.', ctx())
    expect(skip.plan.steps[0]).toEqual({
      tool: 'media_seek',
      args: { deltaSeconds: 30 },
      label: 'Skip forward 30 seconds'
    })
  })

  it('parses "Stop." as an immediate control command', async () => {
    const result = await router.route('Stop.', ctx())
    expect(result.understood).toBe(true)
    expect(result.plan.steps[0].tool).toBe('stop')
  })

  it('parses LinkedIn workflow commands: messages, requests, accept', async () => {
    const messages = await router.route('Go to my messages.', ctx())
    expect(messages.plan.steps[0]).toEqual({
      tool: 'browser_navigate_section',
      args: { section: 'messages' },
      label: 'Go to messages'
    })

    const requests = await router.route('Show me my connection requests.', ctx())
    expect(requests.plan.steps[0].args).toEqual({ section: 'connection requests' })

    const readEach = await router.route('Read each request to me.', ctx())
    expect(readEach.plan.steps[0].tool).toBe('browser_read_list')

    const accept = await router.route('Accept this request.', ctx())
    expect(accept.plan.steps[0].tool).toBe('linkedin_accept_request')
  })

  it('parses the ChatGPT-to-Claude workflow vocabulary', async () => {
    expect((await router.route('Copy the final prompt.', ctx())).plan.steps[0].tool).toBe(
      'browser_copy_response'
    )
    expect((await router.route('Paste the prompt.', ctx())).plan.steps[0].tool).toBe(
      'browser_paste'
    )
    expect((await router.route('Run it.', ctx())).plan.steps[0].tool).toBe('browser_submit')
    expect((await router.route('Wait for Claude to finish.', ctx())).plan.steps[0].tool).toBe(
      'browser_wait_for_completion'
    )

    const model = await router.route('Switch to Opus 4.8 if it is available.', ctx())
    expect(model.plan.steps[0]).toEqual({
      tool: 'browser_select_model',
      args: { model: 'Opus 4.8' },
      label: 'Select Opus 4.8 if available'
    })
  })

  it('carries conversational context across turns ("Open LinkedIn" -> "messages")', async () => {
    const context = ctx()
    const opened = await router.route('Open LinkedIn.', context)
    context.currentSite = opened.plan.steps[0].args.siteName as string

    // A bare noun like "messages" only resolves because we already know LinkedIn is open.
    const followUp = await router.route('messages', context)
    expect(followUp.understood).toBe(true)
    expect(followUp.plan.steps[0].tool).toBe('browser_navigate_section')
  })

  it('returns understood=false with a clarifying response for gibberish, without an LLM configured', async () => {
    const result = await router.route('asdkjfh qoiwjer', ctx())
    expect(result.understood).toBe(false)
    expect(result.response).toBeTruthy()
  })

  it('treats an empty utterance as not understood rather than crashing', async () => {
    const result = await router.route('   ', ctx())
    expect(result.understood).toBe(false)
  })

  it('parses the Good Morning routine trigger', async () => {
    const result = await router.route('Good morning, Friday.', ctx())
    expect(result.plan.steps[0].tool).toBe('morning_briefing')
  })
})
