import { AgentContext, Plan, ToolCall } from './types'
import { resolveAppName, resolveSiteUrl } from './sites'

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  ninety: 90
}

function parseNumber(text: string): number | undefined {
  const trimmed = text.trim().toLowerCase()
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10)
  if (trimmed in NUMBER_WORDS) return NUMBER_WORDS[trimmed]
  // "thirty seconds" style compounds like "twenty five"
  const parts = trimmed.split(/[\s-]+/)
  if (parts.length === 2 && parts[0] in NUMBER_WORDS && parts[1] in NUMBER_WORDS) {
    return NUMBER_WORDS[parts[0]] + NUMBER_WORDS[parts[1]]
  }
  return undefined
}

function step(tool: string, args: Record<string, unknown>, label: string): ToolCall {
  return { tool, args, label }
}

function ordinalToIndex(word: string): number {
  const map: Record<string, number> = {
    first: 0,
    second: 1,
    third: 2,
    fourth: 3,
    fifth: 4,
    next: 0,
    latest: 0,
    newest: 0
  }
  return map[word.toLowerCase()] ?? 0
}

/**
 * Deterministic, offline command parser. Covers the concrete verbs Friday must support
 * out of the box. Anything it can't confidently match falls through to the LLM router.
 */
export function parseWithRules(utteranceRaw: string, context: AgentContext): Plan | undefined {
  const utterance = utteranceRaw.trim()
  const text = utterance.toLowerCase().replace(/[.!?]+$/, '')
  // Original-case, punctuation-stripped form - used only where the captured payload's casing
  // matters (search queries, model names), so "Search for OpenAI" doesn't come out lowercased.
  const clean = utterance.replace(/[.!?]+$/, '')

  // --- multi-clause composite commands ----------------------------------
  // A single utterance made of several sentences (e.g. "Open ChatGPT. Ask it to summarize
  // this. Copy the answer.") gets split on sentence boundaries and each clause parsed
  // independently, then chained into one plan. This is how the spec's multi-step
  // ChatGPT-to-Claude workflow example routes as one command instead of requiring the whole
  // paragraph to match a single regex. Tried first, before any single-utterance rule below,
  // because several of those rules greedily capture everything up to the end of the string
  // (e.g. "open (.+)$") and would otherwise swallow a later sentence as part of their payload.
  // Falls through to normal single-utterance parsing (and then the LLM) if any clause fails
  // to parse, or if there's really only one sentence here.
  const clauses = utterance
    .split(/(?<=[.!?])\s+(?=\S)/)
    .map((c) => c.trim())
    .filter(Boolean)
  if (clauses.length > 1) {
    const steps: ToolCall[] = []
    const goals: string[] = []
    let allParsed = true
    for (const clause of clauses) {
      const sub = parseWithRules(clause, context)
      if (!sub) {
        allParsed = false
        break
      }
      steps.push(...sub.steps)
      goals.push(sub.goal)
    }
    if (allParsed) return { goal: goals.join(' — then — '), steps }
  }

  // --- control words -------------------------------------------------
  if (/^(stop|cancel|abort)$/i.test(text)) {
    return { goal: 'Stop current task', steps: [step('stop', {}, 'Stop everything immediately')] }
  }
  if (/^(pause|hold on|wait a second|let me take over)$/i.test(text)) {
    return { goal: 'Pause current task', steps: [step('pause', {}, 'Pause and wait')] }
  }
  if (/^(continue|resume|go ahead|keep going)$/i.test(text)) {
    return { goal: 'Continue paused task', steps: [step('continue', {}, 'Resume the task')] }
  }

  // --- good morning routine ------------------------------------------
  if (/^good morning[, ]*friday$/i.test(text) || /^good morning$/i.test(text)) {
    return {
      goal: 'Morning briefing',
      steps: [step('morning_briefing', {}, 'Give the morning briefing')]
    }
  }

  // --- open a numbered / official result (must be checked before the generic
  // "open X" handler below, which would otherwise swallow "open the first result") ---
  let m = text.match(/^open (?:the )?(first|second|third|fourth|fifth|next)?\s*(official )?result$/)
  if (m) {
    const index = ordinalToIndex(m[1] || 'first')
    const preferOfficial = !!m[2]
    return {
      goal: 'Open search result',
      steps: [
        step('browser_open_result', { index, preferOfficial }, 'Open the matching search result')
      ]
    }
  }

  // --- open a named conversation/project, optionally on a named site (must be checked
  // before the generic "open X" handler, which would otherwise treat "Regrade conversation"
  // as an unknown website to open) ---
  m = clean.match(
    /^open (?:(chatgpt|claude|youtube|linkedin)(?:['’]s|s) )?(?:my |the )?(.+?) (conversation|project)$/i
  )
  if (m) {
    const site = m[1]?.toLowerCase()
    const title = m[2].trim()
    const steps: ToolCall[] = []
    if (site) {
      const url = resolveSiteUrl(site)
      if (url) steps.push(step('browser_open_url', { url, siteName: site }, `Open ${site}`))
    }
    steps.push(step('browser_open_conversation', { title }, `Open "${title}"`))
    return { goal: `Open ${title}`, steps }
  }

  // --- ask the current AI assistant to do something (types + submits) -----------------
  m = clean.match(/^ask(?: (?:it|chatgpt|claude))? to (.+)$/i)
  if (m) {
    const message = m[1].trim()
    return {
      goal: `Ask: ${message}`,
      steps: [
        step('browser_type', { text: message }, `Type "${message}"`),
        step('browser_submit', {}, 'Submit')
      ]
    }
  }

  // --- open app or website --------------------------------------------
  m = text.match(/^open (?:my )?(.+?)$/)
  if (m) {
    const target = m[1].trim()
    const site = resolveSiteUrl(target)
    if (site) {
      return {
        goal: `Open ${target}`,
        steps: [step('browser_open_url', { url: site, siteName: target }, `Open ${target}`)]
      }
    }
    const app = resolveAppName(target)
    if (app) {
      return { goal: `Open ${target}`, steps: [step('open_app', { app }, `Open ${app}`)] }
    }
    // Unknown target: treat as a website search-and-open via the default browser.
    return {
      goal: `Open ${target}`,
      steps: [
        step(
          'browser_open_url',
          { url: `https://${target.replace(/\s+/g, '')}.com`, siteName: target },
          `Open ${target}`
        )
      ]
    }
  }

  // --- go to a section of the current site (context-aware) -----------
  m = text.match(/^go to (?:my )?(.+)$/)
  if (m) {
    const target = m[1].trim()
    return {
      goal: `Go to ${target}`,
      steps: [step('browser_navigate_section', { section: target }, `Go to ${target}`)]
    }
  }

  // --- search --------------------------------------------------------
  m = clean.match(/^search(?: for)? (.+)$/i)
  if (m) {
    const query = m[1].trim()
    return {
      goal: `Search for ${query}`,
      steps: [step('browser_search', { query }, `Search for "${query}"`)]
    }
  }

  // --- media controls ---------------------------------------------------
  if (/^(pause|pause the video|pause it)$/.test(text)) {
    return { goal: 'Pause media', steps: [step('media_pause', {}, 'Pause playback')] }
  }
  if (/^(play|resume the video|play it|unpause)$/.test(text)) {
    return { goal: 'Play media', steps: [step('media_play', {}, 'Resume playback')] }
  }
  m = text.match(/^skip (forward|back|backward) (.+?) seconds?$/)
  if (m) {
    const n = parseNumber(m[2]) ?? 10
    const delta = m[1] === 'forward' ? n : -n
    return {
      goal: `Skip ${m[1]} ${n} seconds`,
      steps: [step('media_seek', { deltaSeconds: delta }, `Skip ${m[1]} ${n} seconds`)]
    }
  }
  if (/^(toggle )?captions?( on| off)?$/.test(text)) {
    return {
      goal: 'Toggle captions',
      steps: [step('media_toggle_captions', {}, 'Toggle captions')]
    }
  }

  // --- reading / summarizing ------------------------------------------
  if (/^read (each|every) (request|message)s?( to me)?$/.test(text)) {
    return {
      goal: 'Read each item',
      steps: [step('browser_read_list', {}, 'Read each visible item')]
    }
  }
  if (/^summarize (my )?(unread )?messages$/.test(text)) {
    return {
      goal: 'Summarize messages',
      steps: [
        step(
          'browser_summarize_list',
          { instruction: 'Summarize these messages, noting which are unread and need a reply.' },
          'Summarize messages'
        )
      ]
    }
  }
  if (/^read (my )?(visible |unread )?messages$/.test(text)) {
    return { goal: 'Read messages', steps: [step('browser_read_list', {}, 'Read messages')] }
  }
  if (
    /^read( me)? (the )?(newest|latest|next|final)?\s*(message|response|request|result|answer)$/.test(
      text
    ) ||
    /^read (it|this|that)$/.test(text)
  ) {
    return {
      goal: 'Read content',
      steps: [step('browser_read', {}, 'Read the visible content aloud')]
    }
  }
  if (/^(summarize|summarise)\b/.test(text)) {
    return {
      goal: 'Summarize content',
      steps: [step('browser_summarize', {}, 'Summarize the visible content')]
    }
  }
  if (/^show me (my )?(connection requests|messages)$/.test(text)) {
    const target = /messages/.test(text) ? 'messages' : 'connection requests'
    return {
      goal: `Show ${target}`,
      steps: [step('browser_navigate_section', { section: target }, `Go to ${target}`)]
    }
  }

  // --- calendar ---------------------------------------------------------
  m = text.match(/^what(?:'s| is) on my (?:google )?calendar(?: (today|tomorrow))?\??$/)
  if (m) {
    const day = m[1] === 'tomorrow' ? 'tomorrow' : 'today'
    return {
      goal: `Read ${day}'s calendar`,
      steps: [step('calendar_read_events', { day }, `Read ${day}'s calendar events`)]
    }
  }
  if (/^(read|what(?:'s| is)) (my )?(next|tomorrow's) (meeting|event)s?\??$/.test(text)) {
    return {
      goal: 'Read next meeting',
      steps: [step('calendar_next_meeting', {}, 'Read the next meeting')]
    }
  }
  if (/^(find free time|when am i free|do i have any free time)\??$/.test(text)) {
    return {
      goal: 'Find free time',
      steps: [step('calendar_find_free_time', {}, 'Find free time today')]
    }
  }
  if (/^(open|join) the meeting(?: link)?$/.test(text)) {
    return {
      goal: 'Open meeting link',
      steps: [step('calendar_open_meeting_link', {}, 'Open the meeting link')]
    }
  }
  m = clean.match(
    /^create (?:an |a )?event (?:called |named |titled )?"?([^"]+?)"?\s+at (\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?(?: for (\d+) minutes?)?$/i
  )
  if (m) {
    const title = m[1].trim()
    let hour = parseInt(m[2], 10)
    const minute = m[3] ? parseInt(m[3], 10) : 0
    if (m[4]) {
      const isPm = /p/i.test(m[4])
      if (hour === 12) hour = isPm ? 12 : 0
      else if (isPm) hour += 12
    }
    const durationMin = m[5] ? parseInt(m[5], 10) : 30
    const start = new Date()
    start.setHours(hour, minute, 0, 0)
    const end = new Date(start.getTime() + durationMin * 60000)
    return {
      goal: `Create event ${title}`,
      steps: [
        step(
          'calendar_create_event',
          { title, start: start.toISOString(), end: end.toISOString() },
          `Create "${title}" at ${m[2]}${m[3] ? ':' + m[3] : ''}${m[4] ? ' ' + m[4] : ''}`
        )
      ]
    }
  }

  // --- news ---------------------------------------------------------------
  if (
    /^(tell me what happened today|what(?:'s| is) (the )?news|what happened today|read me the news)\??$/.test(
      text
    )
  ) {
    return { goal: 'News briefing', steps: [step('news_briefing', {}, "Get today's top stories")] }
  }

  // --- go back --------------------------------------------------------
  if (/^go back$/.test(text)) {
    return { goal: 'Go back', steps: [step('browser_go_back', {}, 'Go back')] }
  }

  // --- pending-list navigation ("next" story, "more", "skip") ------------
  if (/^(next|more|skip)$/.test(text) && context.queue && context.queue.length > 0) {
    return { goal: 'Next item', steps: [step('queue_next', {}, 'Read the next item')] }
  }

  // --- confirmation-required actions -----------------------------------
  if (/^accept (this|the) request$/.test(text) || text === 'accept') {
    return {
      goal: 'Accept connection request',
      steps: [step('linkedin_accept_request', {}, 'Accept the visible connection request')]
    }
  }
  if (/^(send|submit|run) (it|this|the prompt)?$/.test(text)) {
    return {
      goal: 'Submit prompt',
      steps: [step('browser_submit', {}, 'Submit the current input')]
    }
  }
  if (/^paste( the (prompt|it))?$/.test(text)) {
    return {
      goal: 'Paste clipboard',
      steps: [step('browser_paste', {}, 'Paste the clipboard contents')]
    }
  }
  if (/^copy( it| this| the (final )?(prompt|response|answer))?$/.test(text)) {
    return {
      goal: 'Copy content',
      steps: [step('browser_copy_response', {}, 'Copy the latest response')]
    }
  }
  if (/^wait\b.*\bfinish/.test(text)) {
    return {
      goal: 'Wait for generation',
      steps: [step('browser_wait_for_completion', {}, 'Wait until generation finishes')]
    }
  }

  // --- select a model ----------------------------------------------------
  m = clean.match(/^(switch to|select|choose|use) (.+?)(?: if (?:it is |it's )?available)?$/i)
  if (m && /opus|sonnet|haiku|gpt|claude|model/i.test(text)) {
    return {
      goal: `Select model ${m[2]}`,
      steps: [
        step('browser_select_model', { model: m[2].trim() }, `Select ${m[2].trim()} if available`)
      ]
    }
  }

  // context carry-over fallback: bare noun after we already have a site open
  if (
    context.currentSite &&
    /^(messages|inbox|requests|profile|notifications|settings)$/.test(text)
  ) {
    return {
      goal: `Go to ${text}`,
      steps: [step('browser_navigate_section', { section: text }, `Go to ${text}`)]
    }
  }

  return undefined
}
