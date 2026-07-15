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

describe('CommandRouter - conversation open + ask phrasing (Phase 3)', () => {
  it('parses "Open my Regrade conversation." with no site prefix', async () => {
    const result = await router.route('Open my Regrade conversation.', ctx())
    expect(result.plan.steps).toEqual([
      {
        tool: 'browser_open_conversation',
        args: { title: 'Regrade' },
        label: 'Open "Regrade"'
      }
    ])
  })

  it('parses "Open Claude\'s Regrade project." into an open-site + open-conversation plan', async () => {
    const result = await router.route("Open Claude's Regrade project.", ctx())
    expect(result.plan.steps).toEqual([
      {
        tool: 'browser_open_url',
        args: { url: 'https://claude.ai', siteName: 'claude' },
        label: 'Open claude'
      },
      { tool: 'browser_open_conversation', args: { title: 'Regrade' }, label: 'Open "Regrade"' }
    ])
  })

  it('parses "Ask ChatGPT to create a prompt for fixing the Regrade agents." as type+submit', async () => {
    const result = await router.route(
      'Ask ChatGPT to create a prompt for fixing the Regrade agents.',
      ctx()
    )
    expect(result.plan.steps).toEqual([
      {
        tool: 'browser_type',
        args: { text: 'create a prompt for fixing the Regrade agents' },
        label: 'Type "create a prompt for fixing the Regrade agents"'
      },
      { tool: 'browser_submit', args: {}, label: 'Submit' }
    ])
  })

  it('parses broadened wait/read phrasing', async () => {
    expect((await router.route('Wait until it finishes.', ctx())).plan.steps[0].tool).toBe(
      'browser_wait_for_completion'
    )
    expect((await router.route('Read me the result.', ctx())).plan.steps[0].tool).toBe(
      'browser_read'
    )
    expect((await router.route('Summarize what Claude changed.', ctx())).plan.steps[0].tool).toBe(
      'browser_summarize'
    )
  })
})

describe('CommandRouter - multi-clause composite commands', () => {
  it('chains the full ChatGPT-to-Claude workflow paragraph into one plan', async () => {
    const utterance =
      'Open ChatGPT. Open my Regrade conversation. Ask it to create a prompt for fixing the Regrade agents. ' +
      'Wait until it finishes. Copy the final prompt. Open Claude. Open my Regrade project. ' +
      'Select Opus 4.8 if available. Paste the prompt. Run it. Wait until it finishes. Read me the result.'
    const result = await router.route(utterance, ctx())
    expect(result.understood).toBe(true)
    const tools = result.plan.steps.map((s) => s.tool)
    expect(tools).toEqual([
      'browser_open_url', // Open ChatGPT
      'browser_open_conversation', // Open my Regrade conversation
      'browser_type', // Ask it to create a prompt...
      'browser_submit',
      'browser_wait_for_completion',
      'browser_copy_response', // Copy the final prompt
      'browser_open_url', // Open Claude
      'browser_open_conversation', // Open my Regrade project
      'browser_select_model', // Select Opus 4.8 if available
      'browser_paste',
      'browser_submit', // Run it
      'browser_wait_for_completion',
      'browser_read' // Read me the result
    ])
  })

  it('falls through to "not understood" (rather than a broken partial plan) if one clause fails', async () => {
    const result = await router.route('Fribbleflorp the whatsit. Open YouTube.', ctx())
    expect(result.understood).toBe(false)
  })
})

describe('CommandRouter - calendar commands (Phase 4)', () => {
  it('parses "What is on my Google Calendar today?"', async () => {
    const result = await router.route('What is on my Google Calendar today?', ctx())
    expect(result.plan.steps[0]).toEqual({
      tool: 'calendar_read_events',
      args: { day: 'today' },
      label: "Read today's calendar events"
    })
  })

  it('parses "Read my next meeting."', async () => {
    const result = await router.route('Read my next meeting.', ctx())
    expect(result.plan.steps[0].tool).toBe('calendar_next_meeting')
  })

  it('parses "Find free time."', async () => {
    const result = await router.route('Find free time.', ctx())
    expect(result.plan.steps[0].tool).toBe('calendar_find_free_time')
  })

  it('parses "Create an event called Design review at 3pm for 30 minutes."', async () => {
    const result = await router.route(
      'Create an event called Design review at 3pm for 30 minutes.',
      ctx()
    )
    expect(result.plan.steps[0].tool).toBe('calendar_create_event')
    const args = result.plan.steps[0].args as { title: string; start: string; end: string }
    expect(args.title).toBe('Design review')
    expect(new Date(args.start).getHours()).toBe(15)
    expect(new Date(args.end).getTime() - new Date(args.start).getTime()).toBe(30 * 60000)
  })
})

describe('CommandRouter - news and pending-list navigation (Phase 5)', () => {
  it('parses "Tell me what happened today."', async () => {
    const result = await router.route('Tell me what happened today.', ctx())
    expect(result.plan.steps[0].tool).toBe('news_briefing')
  })

  it('routes "next" to queue_next only when there is a pending queue', async () => {
    const withoutQueue = await router.route('next', ctx())
    expect(withoutQueue.understood).toBe(false)

    const withQueue = await router.route('next', ctx({ queue: ['a story'] }))
    expect(withQueue.plan.steps[0].tool).toBe('queue_next')
  })

  it('parses "Go back."', async () => {
    const result = await router.route('Go back.', ctx())
    expect(result.plan.steps[0].tool).toBe('browser_go_back')
  })
})
