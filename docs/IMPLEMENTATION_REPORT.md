# Implementation Report

## Scope of this pass

The full product spec describes a five-phase build (voice+app control → browser control →
ChatGPT/Claude → LinkedIn/Calendar → morning briefing). This pass delivers a complete, working
Phase 1 + Phase 2 vertical slice, plus the tool-level building blocks for Phase 3 (ChatGPT/Claude)
and part of Phase 4 (LinkedIn accept-request), built and wired end-to-end rather than left as
scaffolding. See `docs/LIMITATIONS.md` for exactly what's untested vs unbuilt.

## What was built

- **Command router** (`src/main/agent/router.ts`, `rules.ts`, `sites.ts`) - deterministic,
  offline-first natural language → tool-call plan mapper, with an Ollama LLM fallback
  (`llmProvider.ts`) for anything outside the rule set.
- **Agent loop** (`src/main/agent/loop.ts`) - the actual Listen → Understand → Plan → Act →
  Verify → Continue/Recover → Speak loop from the spec, with instant stop, pause/continue (for
  manual login), and a confirmation gate in front of sensitive tools.
- **Tools** (`src/main/tools/`) - `browser.ts` (Playwright: navigation, search, click/type/scroll,
  read/summarize, media control, copy/paste, wait-for-completion, model selection, LinkedIn
  accept-request), `openApp.ts` (macOS `open -a` with real verification), `speak.ts` (macOS
  `say`), `transcribe.ts` (whisper.cpp integration), `briefing.ts` (honest morning briefing).
- **Local memory** (`src/main/memory/`) - SQLite-backed settings, activity history, and a
  key-value memory store, via `better-sqlite3`.
- **Permissions** (`src/main/permissions/macPermissions.ts`) - live macOS permission status via
  Electron's `systemPreferences`, with an honest `unsupported-platform`/`unknown` fallback where
  Electron has no API to check.
- **IPC + preload** (`src/main/ipc/handlers.ts`, `src/preload/`) - the full contract between the
  agent runtime and the UI, typed end-to-end via `src/shared/types.ts`.
- **Desktop UI** (`src/renderer/`) - orb (idle/listening/thinking/acting/speaking/paused/error),
  conversation panel, current-task panel with live step progress, activity history, settings,
  permissions status, and a confirmation dialog. Push-to-talk uses real `MediaRecorder` capture;
  a typed command bar is always available as a reliable fallback.

## Architecture decisions and why

- **Electron + React + TypeScript**, single app (no separate backend server/API) - the agent
  runtime lives in the Electron main process, the UI is the renderer, and they talk over typed
  IPC. This matches the spec's explicit "no REST APIs/database abstractions for architectural
  appearance" instruction while still being a real local desktop app.
- **Rule-based parser first, LLM second.** The product spec's example commands are a known,
  bounded vocabulary. A deterministic parser handles them with zero setup, zero latency, and zero
  flakiness, and is fully unit-testable without a live model. Ollama is a genuine fallback for
  open-ended phrasing, not the only path - this also means the "Definition of Done" requirement
  that command-router tests pass doesn't depend on a model being installed.
  **This deviates from the spec's structured tool-calling framing** ("The agent should use
  structured tool calls instead of freely generating arbitrary computer commands") in one
  specific way: it deviates *toward* more determinism, not away from it - the rule parser is
  itself a structured, closed-vocabulary tool-call generator, and the LLM fallback is still
  constrained to a fixed tool catalog with JSON-schema output. No commands are freely generated.
- **Playwright drives your real Chrome profile** (`launchPersistentContext` against a persistent
  user-data dir, `channel: 'chrome'`), not a throwaway browser - so your existing logins to
  YouTube/LinkedIn/ChatGPT/Claude carry over, matching "I will log into websites manually."
- **Generic-first tool primitives.** `BrowserController`'s core methods (click/type/read/scroll)
  use the spec's stated priority order (role+label → DOM text → form label → placeholder →
  selector) and work on any page. Site-specific tools are thin wrappers on top, so they degrade to
  "couldn't find X" instead of silently misfiring when a site's layout differs from what was
  assumed.
- **Interfaces over concrete classes for the agent loop's dependencies** (`RouterLike`,
  `ToolRegistryLike`, `HistoryLike` in `loop.ts`) - lets the loop's control-flow logic (the part
  most worth testing rigorously - stop/pause/confirm/verify-before-continue) be unit tested with
  lightweight fakes instead of a real database and a real browser.

## Environment constraints this was actually built and tested under

- Linux container, no display server, no audio hardware, not macOS.
- Egress policy blocked GitHub release/Electron-CDN binary downloads (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`
  was used to let `npm install` complete; this is irrelevant on a normal Mac) and blocked
  youtube.com/linkedin.com/chatgpt.com/claude.ai directly.
- A pre-provisioned headless Chromium was available at a fixed path, used for the Playwright test
  suite against a local static fixture page instead of live sites.

## Commands actually run, and their results

```
npm install                          # succeeded (with ELECTRON_SKIP_BINARY_DOWNLOAD=1; see above)
npx node-gyp rebuild --directory=node_modules/better-sqlite3   # succeeded (Node-ABI build for tests)
npm run typecheck                    # 0 errors (tsconfig.node.json + tsconfig.web.json)
npm run lint                         # 0 errors, 0 warnings after fixes
npm test  (vitest run)               # 7 test files, 42 tests, all passing
npx electron-vite build              # succeeded - out/main, out/preload, out/renderer all built
```

Not run: `npm run dev` interactively (no display), `npm run build:mac` (no macOS / Electron
binary blocked), any test against a live YouTube/LinkedIn/ChatGPT/Claude page (no network path),
any microphone/speaker exercise (no audio hardware).

## Next steps, in priority order

1. **Validate on a real Mac**: run `npm install && npm run dev`, walk through the exact demo
   sequence in the README/spec, and fix whatever the real YouTube/LinkedIn/ChatGPT/Claude DOM
   doesn't match in the site-specific selectors.
2. **Wire up real macOS permission prompts** by actually granting them and confirming the
   Permissions tab reflects reality.
3. **Set up whisper.cpp and exercise push-to-talk** end-to-end with real speech.
4. **Build out Phase 4/5**: Calendar reading (likely simplest via a local Google Calendar
   read-only integration or opening the web UI and reading it like any other site), LinkedIn
   message reading/summarizing, and news summarization, then fold them into the morning briefing.
5. **Run the full ChatGPT-to-Claude workflow** from the spec end-to-end against real accounts and
   tighten the completion-detection and model-selection heuristics based on what actually breaks.
6. **Package with `electron-builder`** for a real `.app`/DMG once the above is solid.
