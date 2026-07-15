# Known Limitations

This build was done in a Linux cloud sandbox with **no display, no microphone/speaker, no macOS,
and a restrictive network egress policy** (no access to youtube.com, linkedin.com, chatgpt.com,
claude.ai, or GitHub/Electron binary CDNs). That shaped what could actually be exercised versus
what is implemented-but-unverified. This document is deliberately specific about which is which.

## Verified by automated tests (42 tests, all passing)

- **Command router** (`tests/router.test.ts`): every command in the product spec's required list
  and demo script parses to the correct tool call, entirely offline. Context carry-over
  ("Open LinkedIn" → "messages") and control words are covered.
- **Agent loop** (`tests/agent/loop.test.ts`): multi-step plan execution, verify-before-continue
  (a failed step honestly stops the plan instead of continuing), instant stop mid-plan, pause/
  continue gating, and the confirm-before-sensitive-action flow (both approve and decline paths).
- **Tool registry** (`tests/tools/registry.test.ts`): dispatch, unknown-tool handling, abort-signal
  short-circuiting, exception containment.
- **Browser automation primitives** (`tests/tools/browser.test.ts`): real Playwright + headless
  Chromium against a local static fixture page - navigation+verification, reading text/list items,
  clicking, typing into a labeled field, submitting, scrolling, and `<video>` play/pause/seek with
  real state verification (not just "the call didn't throw").
- **Local memory** (`tests/memory/db.test.ts`): SQLite-backed settings, activity history, and
  key-value memory round-trip correctly via `better-sqlite3`.
- **Permissions module** (`tests/permissions.test.ts`): returns `unsupported-platform` cleanly on
  non-macOS without touching the Electron API.

## Implemented but NOT verified against real hardware/sites

These are real, non-stub implementations, but nothing in this sandbox could exercise them
end-to-end. Validate them yourself on your Mac before relying on them:

- **Voice I/O.** `usePushToTalk` uses the real `MediaRecorder`/`getUserMedia` browser APIs, and
  `WhisperCppProvider` shells out to a real whisper.cpp binary. Neither has been run against
  actual microphone input, because this sandbox has no audio hardware. `SpeechOutput` calls
  macOS's `say` command - never executed, because this sandbox isn't macOS.
- **Native macOS app control.** `open_app` calls `open -a` and verifies via `osascript`; this
  logic is straightforward but has never run on macOS. Accessibility-API-based control beyond
  `open -a` (reading/clicking arbitrary native UI controls) is **not implemented** - the spec's
  "macOS Accessibility APIs" section is scoped down to just app launching in this first pass.
- **Site-specific browser selectors** for YouTube ("official" result detection), LinkedIn
  (messages/connection-request navigation, accept-request), ChatGPT and Claude (response
  extraction, completion detection, model selection) were written against each site's DOM
  structure from general knowledge, but **could not be tested against the live sites** - this
  sandbox has no network path to them. The generic primitives underneath (click-by-role,
  type-by-label, read-visible-text, scroll) are tested and solid; the site-specific heuristics
  built on top of them are the highest-risk area to validate first on your Mac.
- **macOS permission status.** `getPermissionStatus()` calls real Electron `systemPreferences`
  APIs (mic/screen/accessibility), but only compiles/type-checks here - it returns
  `unsupported-platform` in this sandbox by design and was never observed reading real macOS TCC
  state.
- **Ollama LLM fallback.** `OllamaProvider` is a real HTTP client with a real prompt/schema, but
  no Ollama instance was reachable to test it against. If it's unreachable, the router degrades
  gracefully (says it doesn't understand) rather than crashing - that fallback path *is* tested.
- **Electron packaging** (`npm run build:mac`, code signing, DMG creation). Never run - this
  sandbox can't build for macOS and the Electron binary download itself is blocked here.
- **Global keyboard shortcut** for push-to-talk registers via Electron's `globalShortcut` API;
  compiles, never exercised interactively.

## Not built at all (explicitly out of scope for this pass)

- **Phase 4/5 of the spec**: Calendar reading, LinkedIn message/request *reading* (accepting a
  visible request is implemented; proactively reading and summarizing unread messages is not),
  and news summarization. The "Good Morning" briefing tool exists and correctly reports the
  date/time, and says outright that calendar/message/news integration isn't connected yet -
  it does not fabricate calendar events or messages.
- **Wake-word activation** ("Friday" hotword). Only push-to-talk (hold a button / shortcut) and
  typed input are implemented, per the spec's own phased rollout ("wake word later").
- **Screenshot-based visual fallback clicking.** The spec lists this as a last-resort fallback
  behind role/label/DOM-text/placeholder/selector matching - none of the built-in tools needed it,
  so it wasn't built. If a future site defeats all the text-based strategies, this would be the
  next thing to add.
- **ChatGPT-to-Claude end-to-end workflow** as a single scripted flow. Every individual step it
  needs (open site, find conversation, submit prompt, wait for completion, copy response, switch
  site, select model, paste, submit, wait, summarize) exists as a tool and is routable from
  natural language, but the full 15-step chain from the spec has not been run start-to-finish
  against real ChatGPT/Claude accounts.

## Why this split instead of pretending it all works

The build instructions for this task were explicit: don't create fake success states, don't claim
something works when it wasn't actually exercised. A sandbox with no Mac, no audio hardware, and
no network to the target sites makes full end-to-end verification impossible from here. Rather
than mark everything "done," this document draws the line at what was actually observed to work.
