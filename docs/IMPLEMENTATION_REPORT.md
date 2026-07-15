# Implementation Report

## Scope of this pass

The first pass (PR #1, in git history) delivered a complete, working Phase 1 + Phase 2 vertical
slice (voice/app/browser control) plus the tool-level building blocks for Phase 3 and part of
Phase 4. This pass finishes what the spec calls "leave no features behind": real text
summarization, Phase 4 (Calendar reading/creation, LinkedIn message reading), Phase 5 (news
briefing, a fully composed Good Morning routine), and the single-utterance ChatGPT-to-Claude
workflow via a new multi-clause composite command parser. See `docs/LIMITATIONS.md` for exactly
what's untested vs unbuilt after this pass.

## What was added in this pass

- **Real summarization** (`src/main/agent/llmProvider.ts`): `OllamaProvider.summarize()` and the
  underlying `.complete()` method. `browser_summarize` and the new `browser_summarize_list` tool
  now actually summarize via the local model, with an honest raw-excerpt fallback (clearly
  labeled as such) when Ollama is unreachable - previously `browser_summarize` just echoed the
  full page text back, which wasn't a summary.
- **Calendar tools** (`src/main/tools/calendarTime.ts` + `BrowserController` methods in
  `browser.ts`): reading today's/tomorrow's events off calendar.google.com's day view (via
  `aria-label`/`data-eventid` scraping - role+label, the spec's preferred strategy), finding the
  next upcoming meeting, computing free time (pure interval-merging logic, unit tested), opening
  a visible meeting link, and creating an event via Google's documented quick-add URL scheme
  (`calendar_create_event`, sensitive/confirm-gated). All date/time logic is factored into pure,
  dependency-free functions specifically so it's unit-testable without a live browser.
- **LinkedIn section URLs** (`src/main/agent/sites.ts`): direct URLs for messaging and the
  invitation manager, used by `navigateSection` before falling back to fragile nav-label click
  matching (LinkedIn's actual nav label is "Messaging", not "messages" - the old approach would
  have silently failed on exactly the demo command from the spec). Added
  `browser_summarize_list` for "summarize unread messages."
- **News briefing** (`src/main/tools/news.ts`): searches Google News, deduplicates near-identical
  headlines from different outlets using Jaccard similarity over significant (non-stopword)
  tokens (a pure, unit-tested function), then reads stories one at a time via a small generic
  `queue_next` tool and `AgentContext.queue`, so "next"/"more"/"skip" page through results - this
  queue mechanism is generic, not news-specific, so it's reusable for any future one-at-a-time
  reading flow.
- **Composed Good Morning briefing** (`src/main/tools/briefing.ts`, rewritten): previously an
  honest stub that only reported the date/time. Now composes real calendar, LinkedIn, and news
  reads, each independently try/caught so one unreachable source doesn't block the others or get
  silently faked, then (if Ollama is available) asks the model to turn the composed facts into a
  short, natural spoken briefing.
- **ChatGPT/Claude conversation workflow** (`src/main/agent/rules.ts`, `browser.ts`): a new
  `browser_open_conversation` tool (find-by-title in a sidebar/list) plus router rules for
  "open my X conversation/project" (with or without a site prefix) and "ask [it/chatgpt/claude]
  to Y" (type + submit). Broadened the wait/read/summarize regexes to match the spec's actual
  example phrasing ("wait until it finishes", "read me the result", "summarize what Claude
  changed").
- **Multi-clause composite commands** (`src/main/agent/rules.ts`): the router now splits a
  multi-sentence utterance on sentence boundaries and parses each clause independently *before*
  trying any single-utterance rule (several of those rules greedily capture to the end of the
  string and would otherwise swallow a second sentence as part of their payload). If every clause
  parses, they're chained into one plan; if any clause fails, it falls through to normal
  single-utterance parsing on the full text, then the LLM. This is what makes the spec's full
  ChatGPT-to-Claude paragraph route correctly as one command instead of requiring 12 separate
  voice commands - verified end-to-end in `tests/router.test.ts` against the literal example
  paragraph from the product spec, asserting the exact 13-step tool sequence it should produce.

## Architecture decisions and why (this pass)

- **Dependency injection over concrete imports**, consistent with the existing codebase style:
  `createBrowserTools`/`createNewsTools`/`createMorningBriefingTool` all take an optional
  `Summarizer` (a narrow structural interface `OllamaProvider` satisfies) rather than importing
  `OllamaProvider` directly, so the browser/news/briefing logic stays testable without a real
  LLM and without Electron.
- **Pure functions for anything date/math/string-similarity related**
  (`calendarTime.ts`, `dedupeHeadlines` in `news.ts`) - these are exactly the parts that don't
  need a live browser or model to test, so they're fully covered even in a sandbox with no
  network path to the real sites. The DOM-scraping and URL-navigation parts stay thin wrappers
  around them.
- **Google's documented URL schemes over DOM form-filling** for calendar day views
  (`/calendar/r/day/YYYY/MM/DD`) and event creation (`/calendar/render?action=TEMPLATE&...`) -
  more stable across UI changes than clicking through a date picker or a multi-field create
  dialog, and it's the same mechanism "Add to Calendar" links across the web already use.
- **Generic queue mechanism instead of a news-specific one.** `AgentContext.queue` + the single
  `queue_next` tool means any future "read N things one at a time" feature (e.g. LinkedIn
  requests, search results) can reuse the same "next"/"more"/"skip" plumbing instead of each
  building its own pagination state.
- **Multi-clause splitting tried first, not last.** The initial implementation put this at the
  end of `parseWithRules` as a fallback; testing surfaced that several existing rules (the
  generic "open X" handler in particular) match `(.+)$`-style patterns that swallow an entire
  multi-sentence utterance as their own payload before the fallback is ever reached. Moving the
  split to the top of the function - try composite parsing first, fall through to normal
  single-utterance parsing only if a clause doesn't parse - fixed this and is now covered by a
  regression test (`falls through to "not understood"... if one clause fails`).

## Environment constraints this was actually built and tested under

Same as the first pass, unchanged: Linux container, no display server, no audio hardware, not
macOS, egress policy blocks GitHub/Electron-CDN binary downloads (worked around the same way:
`ELECTRON_SKIP_BINARY_DOWNLOAD=1` for `npm install`, then `npx node-gyp rebuild
--directory=node_modules/better-sqlite3` to get a working native module for the test run) and
blocks youtube.com/linkedin.com/chatgpt.com/claude.ai/calendar.google.com/news.google.com
directly.

## Commands actually run, and their results

```
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install    # succeeded (postinstall step still fails on the
                                                #   native-module network fetch; worked around below)
npx node-gyp rebuild --directory=node_modules/better-sqlite3   # succeeded
npm run typecheck                              # 0 errors (tsconfig.node.json + tsconfig.web.json)
npm run lint                                   # 0 errors, 0 warnings (eslint --fix applied for
                                                #   formatting-only warnings along the way)
npx vitest run                                 # 9 test files, 72 tests, all passing
npx electron-vite build                        # succeeded - out/main, out/preload, out/renderer
```

Not run (same reasons as the first pass): `npm run dev` interactively (no display), `npm run
build:mac` (no macOS / Electron binary blocked), any test against a live YouTube/LinkedIn/
ChatGPT/Claude/Calendar/News page (no network path), any microphone/speaker exercise (no audio
hardware).

## Next steps, in priority order

1. **Validate on a real Mac**: run `npm install && npm run dev`, walk through the exact demo
   sequence in the README/spec plus the new Phase 4/5 commands in `docs/SETUP.md` §7-8, and fix
   whatever the real Google Calendar/LinkedIn/News/ChatGPT/Claude DOM doesn't match.
2. **Wire up real macOS permission prompts** by actually granting them and confirming the
   Permissions tab reflects reality.
3. **Set up whisper.cpp and exercise push-to-talk** end-to-end with real speech, including
   saying the multi-clause ChatGPT-to-Claude workflow paragraph out loud and confirming
   transcription doesn't mangle the sentence boundaries the composite-command splitter relies on.
4. **Run the full ChatGPT-to-Claude workflow** against real accounts, both as separate commands
   and as the single composite utterance, and tighten completion-detection/model-selection/
   conversation-title-matching heuristics based on what actually breaks.
5. **Validate Calendar and LinkedIn against live accounts**: confirm the `aria-label` time-range
   parsing actually matches Google Calendar's current DOM, that free-time/next-meeting output is
   sensible, that the quick-add event URL creates what's expected, and that LinkedIn's messaging/
   invitation-manager URLs haven't changed.
6. **Package with `electron-builder`** for a real `.app`/DMG once the above is solid.
