# Troubleshooting

## `npm install` fails downloading Electron or Playwright's Chromium

You're behind a restrictive proxy or firewall. Electron and Playwright both download large
binaries from GitHub releases / CDN on install. On a normal Mac with unrestricted internet this
should just work. If you're behind a corporate proxy, set `HTTPS_PROXY`/`ELECTRON_MIRROR` /
`PLAYWRIGHT_DOWNLOAD_HOST` as appropriate for your network.

## Friday says "I didn't understand that command"

The rule-based router handles a fixed vocabulary (see `src/main/agent/rules.ts`). If your phrasing
doesn't match and Ollama isn't reachable at the configured base URL, Friday will say so rather
than guess. Either rephrase closer to the example commands in the README, or get Ollama running
(`ollama serve`) and confirm the base URL/model in Settings.

## Push-to-talk shows "Speech-to-text is not configured"

You haven't set a whisper.cpp binary + model path in Settings. See `docs/SETUP.md` step 5. Typed
commands in the command bar work with zero configuration.

## Friday can't open native macOS apps

`open_app` uses `open -a "<App Name>"` and then verifies the app is actually running via
AppleScript. This only works on macOS - on any other platform it returns a clear failure message
rather than pretending. If it fails on a real Mac, check the app name matches what's in
`src/main/agent/sites.ts` (`KNOWN_APPS`), or that macOS itself can find the app by that name
(`open -a "Exact App Name"` in Terminal should succeed first).

## Browser actions fail on a site Friday hasn't been tuned for

The generic tools (`browser_click`, `browser_type`, `browser_read`, etc.) work on any page using
accessible role/label matching. The site-specific heuristics (YouTube "official result", LinkedIn
connection requests, ChatGPT/Claude response extraction) are pattern-matched against those sites'
DOM structure as of when this was built and **have not been validated against the live sites**
(no network access to them in the build sandbox - see `docs/LIMITATIONS.md`). If a site changes
its layout or the selectors don't match, the affected tool will report `ok: false` with a
specific message rather than silently doing the wrong thing - check the Activity History for what
it actually tried.

## "Summarize" just reads back the raw page text instead of a real summary

Real summarization needs Ollama reachable at the configured base URL (Settings → Local model). If
it's unreachable, `browser_summarize`/`browser_summarize_list`/the morning briefing/news headlines
fall back to an honest raw excerpt - Friday will say "Local model isn't connected..." or "I
couldn't reach the local model..." rather than silently returning unsummarized text. Run
`ollama serve` and confirm the model in Settings is pulled (`ollama pull llama3.1`).

## Calendar/LinkedIn/News commands say they couldn't reach the page

These read the live web UI (calendar.google.com, linkedin.com, news.google.com) in Friday's
persistent Chrome profile - they need you to already be logged in there (Friday never logs in for
you) and a working network connection. Try opening the site manually first (`Open LinkedIn.`) and
confirm you're logged in, then retry the command.

## Confirmation dialog never appears / sensitive action ran without asking

Check Settings → "Confirm before sensitive actions" is enabled. The sensitive-tool list lives in
`src/main/agent/confirm.ts` - if you add a new tool that performs an external/destructive action,
add it there.

## "Stop" doesn't feel instant

`AgentLoop.stop()` aborts the current step's `AbortSignal` and rejects any pending confirmation,
but a tool step that doesn't check `ctx.signal.aborted` between async operations will finish its
current in-flight operation (e.g. a Playwright action already submitted to the browser) before the
abort is observed. All built-in tools are short single actions, so this should be sub-second in
practice; if you add a long-running custom tool, make it poll `ctx.signal.aborted`.

## Tests fail with a Playwright/Chromium launch error

The test suite (`tests/tools/browser.test.ts`) launches Chromium directly - Playwright needs a
matching browser binary installed. Run `npx playwright install chromium` if `npm test` reports a
missing executable. (The sandbox this was built in used a pre-provisioned Chromium at a fixed
path passed via `executablePath` - see the test file if you need that pattern for a locked-down
CI environment.)

## `better-sqlite3` fails to load / native module version mismatch

`better-sqlite3` is a native addon and must be built against the same runtime that loads it. Two
different rebuilds are needed for two different consumers:

- **Running the actual app** (`npm run dev` / packaged app): `electron-builder install-app-deps`
  rebuilds it against Electron's Node ABI - this runs automatically via the `postinstall` script.
- **Running tests** (`npm test`, plain Node via vitest): it needs the plain-Node build. If you see
  a "NODE_MODULE_VERSION mismatch" error, run `npx node-gyp rebuild --directory=node_modules/better-sqlite3`
  to rebuild it for your local Node version, or delete `node_modules` and reinstall.
