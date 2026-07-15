# Friday

Friday is a local personal computer agent for **your own Mac**. You speak or type a command,
Friday figures out what you mean, drives your browser and native apps to do it, verifies the
result actually happened, and tells you what it did.

It is a desktop app (Electron + React), not a service. Everything - the local model connection,
browser automation, activity history, and settings - runs on your machine. There are no user
accounts, no cloud database, and no telemetry.

> Built and tested in a Linux sandbox with no display, no microphone, and no macOS. Everything
> platform-independent (command router, tool dispatch, SQLite memory, browser automation against
> a local test page) has automated test coverage and passes. Voice I/O, native macOS app control,
> and the site-specific browser selectors for YouTube/LinkedIn/ChatGPT/Claude are implemented but
> **not yet validated on a real Mac** - see `docs/LIMITATIONS.md` before you rely on them.

## What works today

- A command router that turns natural language into a verified action plan, entirely offline
  (no LLM required) for the core vocabulary in the product spec - see `tests/router.test.ts`.
  This includes **multi-clause composite commands**: a single utterance made of several
  sentences (e.g. the full ChatGPT-to-Claude workflow paragraph from the spec) gets split into
  clauses and chained into one plan, so the whole workflow routes as one command.
- A pluggable local-LLM fallback (Ollama) for anything the rule-based router doesn't recognize,
  and for real text summarization (`browser_summarize`, `browser_summarize_list`, the morning
  briefing, and news headlines) - with an honest non-LLM fallback (raw excerpt) if Ollama isn't
  reachable, never a fabricated summary.
- Browser control via Playwright: open a URL, search, open a result (with "prefer official"),
  read/summarize a page, click, type, scroll, submit, copy/paste, wait for AI responses to
  finish generating, select a model if visible, open a conversation/project by name, and
  control `<video>` playback.
- Native macOS app launching (`open -a`) with real verification, not just "the command ran."
- **Calendar (Phase 4)**: read today's/tomorrow's events, read the next meeting, find free time,
  open a meeting link, create an event (via Google Calendar's quick-add URL scheme, after
  confirmation) - all off calendar.google.com, no OAuth setup required.
- **LinkedIn (Phase 4)**: direct-URL navigation to messaging/invitations (not fragile nav-label
  clicking), read/summarize messages, read/accept connection requests (after confirmation).
- **News briefing (Phase 5)**: gathers headlines, deduplicates near-identical stories from
  different outlets (Jaccard similarity over significant tokens), and reads them one at a time
  with "next"/"more"/"skip" pagination.
- **Good Morning routine (Phase 5)**: a real composed briefing (time, calendar, LinkedIn,
  news) where each source degrades honestly and independently if it's unreachable.
- A visible task panel, conversation log, local activity history, settings, and a permissions
  status screen - all backed by a local SQLite database.
- Stop / Pause / Continue, including a "you need to log in manually, I've paused" flow.
- A confirmation dialog gate in front of sensitive actions (accepting requests, sending
  messages, submitting forms, creating events, deleting, purchasing, etc).

## What's stubbed or unbuilt

- Wake-word activation and screenshot-based visual fallback clicking.
- Whisper.cpp transcription is wired up but requires you to install the binary yourself.
- Per-article news summarization (the news briefing summarizes headlines, not full article
  bodies - opening and reading every article would be slow and fragile).
- "Go back" (one step) for a story queue - pagination is forward-only ("next"/"more"/"skip").

See `docs/LIMITATIONS.md` for the full, honest list.

## Quick start (on your Mac)

```bash
git clone <this repo>
cd Friday
npm install                 # downloads Electron + Playwright's Chromium normally on a Mac
npm run dev                 # launches the Friday desktop window
```

Full setup (permissions, Ollama, whisper.cpp) is in `docs/SETUP.md`.

## Project layout

```
src/
  main/            Electron main process = the agent runtime
    agent/         command router, rule-based parser, LLM fallback, agent loop, confirm gating
    tools/         browser control (Playwright), macOS app launch, speech I/O, transcription
    memory/        SQLite: settings, activity history, key-value memory
    permissions/   macOS permission status checks
    ipc/           IPC handlers exposed to the renderer
  preload/         contextBridge - the only surface the renderer can call into main through
  renderer/        React UI: orb, conversation, task panel, history, settings, permissions
  shared/          types shared between main and renderer (no Electron/Node imports)
tests/             vitest suite - router, tool registry, browser automation, memory, agent loop
docs/              setup, troubleshooting, limitations, implementation report
```

## Testing

```bash
npm test          # vitest - 72 tests, all offline / local (no live sites, no Ollama required)
npm run typecheck
npm run lint
```

## Documentation

- `docs/SETUP.md` - exact steps to get every feature running on a Mac
- `docs/TROUBLESHOOTING.md` - common failures and fixes
- `docs/LIMITATIONS.md` - what's untested or not yet built, and why
- `docs/IMPLEMENTATION_REPORT.md` - what was built, what was actually run and verified, next steps
