# Known Limitations

This build was done in a Linux cloud sandbox with **no display, no microphone/speaker, no macOS,
and a restrictive network egress policy** (no access to youtube.com, linkedin.com, chatgpt.com,
claude.ai, calendar.google.com, news.google.com, or GitHub/Electron binary CDNs). That shaped
what could actually be exercised versus what is implemented-but-unverified. This document is
deliberately specific about which is which, across both the original Phase 1+2 pass and this
pass (Phase 3/4/5 completion: real summarization, Calendar, LinkedIn messages, news, the
composed Good Morning briefing, and multi-clause composite commands).

## Verified by automated tests (72 tests, all passing)

- **Command router** (`tests/router.test.ts`): every command in the product spec's required list
  and demo script parses to the correct tool call, entirely offline, including the new
  conversation-open/ask/calendar/news rules and **multi-clause composite commands** - the full
  ChatGPT-to-Claude workflow paragraph from the spec is verified to split into 13 correctly
  ordered tool calls from one utterance, with a test confirming a failing clause falls back to
  "not understood" instead of a broken partial plan. Context carry-over and control words are
  also covered.
- **Agent loop** (`tests/agent/loop.test.ts`): multi-step plan execution, verify-before-continue,
  instant stop mid-plan, pause/continue gating, and the confirm-before-sensitive-action flow.
- **Tool registry** (`tests/tools/registry.test.ts`): dispatch, unknown-tool handling, abort-signal
  short-circuiting, exception containment.
- **Browser automation primitives** (`tests/tools/browser.test.ts`): real Playwright + headless
  Chromium against a local static fixture page - navigation+verification, reading text/list items,
  clicking, typing into a labeled field, submitting, scrolling, and `<video>` play/pause/seek.
- **Calendar time/date logic** (`tests/tools/calendarTime.test.ts`): aria-label time-range parsing,
  free-slot computation (including merging overlapping busy blocks), next-upcoming-meeting
  selection, day-view URL construction, and the quick-add event URL builder - all pure functions,
  fully covered without a live Google Calendar.
- **News dedup** (`tests/tools/news.test.ts`): Jaccard-similarity near-duplicate headline removal
  (keeps genuinely distinct stories, merges the same story from different outlets, respects the
  item cap, preserves order) - a pure function, fully covered without a live search.
- **Local memory** (`tests/memory/db.test.ts`) and **permissions** (`tests/permissions.test.ts`)
  as before.

## Implemented but NOT verified against real hardware/sites

These are real, non-stub implementations, but nothing in this sandbox could exercise them
end-to-end. Validate them yourself on your Mac before relying on them:

- **Voice I/O**, **native macOS app control beyond `open -a`**, **macOS permission status**, and
  **Electron packaging** - unchanged from the original pass; still unverified for the same
  reasons (no audio hardware, not macOS).
- **Site-specific browser selectors** for YouTube, LinkedIn, ChatGPT, Claude, **and now Google
  Calendar (`aria-label`/`data-eventid` scraping) and Google News (`article` element scraping)**
  were written from general knowledge of each site's DOM/URL structure, but could not be tested
  against the live sites - this sandbox still has no network path to them. The generic
  primitives underneath (click-by-role, type-by-label, read-visible-text, scroll) remain tested
  and solid; these site-specific heuristics are the highest-risk area to validate first on your
  Mac, in this order: calendar day-view event scraping, news article scraping, then LinkedIn
  messaging/invitation-manager direct URLs (these replaced fragile nav-label click-matching with
  direct URLs, which should be *more* reliable but is still unverified against the live site).
- **The Google Calendar quick-add event URL scheme** (`action=TEMPLATE&text=...&dates=...`) is a
  real, documented Google URL format, not something invented for this project - but the "click
  Save" step after navigating there was written against general knowledge of the create-event
  dialog's button and has not been observed against the live page.
- **Ollama-backed summarization** (`browser_summarize`, `browser_summarize_list`, the morning
  briefing, and news headline rewriting) is real, with a genuinely-tested honest fallback (raw
  excerpt, clearly labeled) when Ollama is unreachable - but the "good" path, an actual LLM
  producing a coherent summary, was never exercised against a live Ollama instance.
- **The composed Good Morning briefing** wires together calendar, LinkedIn, and news reads, each
  in its own try/catch so one failing source doesn't block the others - the composition logic is
  straightforward and the individual pieces are covered above, but the full composed flow has
  never run end-to-end against real accounts.

## Deliberately scoped down (not gaps, but explicit design choices)

- **Wake-word activation** ("Friday" hotword). Only push-to-talk and typed input are implemented,
  per the spec's own phased rollout ("wake word later").
- **Screenshot-based visual fallback clicking.** Listed in the spec as a last-resort fallback
  behind role/label/DOM-text/placeholder/selector matching - none of the built-in tools needed it.
- **Per-article news summarization.** The news briefing summarizes/reads headlines (deduplicated),
  not full article bodies - opening and reading every article would be slow and fragile for
  limited benefit. The morning briefing and `news_briefing` tool are honest about this scope.
- **Story-queue "go back."** Pagination through news stories is forward-only (`next`/`more`/
  `skip`); there's no "previous story." "Go back" instead means browser back-navigation, which
  is the more common interpretation and was previously unmapped entirely.
- **Free-time / event-creation NLP is intentionally simple.** `calendar_find_free_time` assumes
  a 9am-6pm working day (not user-configurable yet). `calendar_create_event`'s rule-based parser
  only handles one phrasing shape ("create an event called X at TIME [for N minutes]"); anything
  else falls through to the Ollama LLM fallback, which is itself unverified per above.

## Why this split instead of pretending it all works

The build instructions for this task were explicit: don't create fake success states, don't claim
something works when it wasn't actually exercised. A sandbox with no Mac, no audio hardware, and
no network to the target sites makes full end-to-end verification impossible from here. Rather
than mark everything "done," this document draws the line at what was actually observed to work.
