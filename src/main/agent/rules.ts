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
  if (
    /^read (the )?(newest|latest|next) (message|response|request)$/.test(text) ||
    /^read (it|this|that)$/.test(text)
  ) {
    return {
      goal: 'Read content',
      steps: [step('browser_read', {}, 'Read the visible content aloud')]
    }
  }
  if (/^read (each|every) (request|message)s?( to me)?$/.test(text)) {
    return {
      goal: 'Read each item',
      steps: [step('browser_read_list', {}, 'Read each visible item')]
    }
  }
  if (/^(summarize|summarise)( it| this| the (video|page|conversation))?$/.test(text)) {
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
  if (
    /^wait(?: for (.+))? to finish$/.test(text) ||
    /^wait for (it|claude|chatgpt) to finish$/.test(text)
  ) {
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
