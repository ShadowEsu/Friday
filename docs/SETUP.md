# Setup Guide (macOS)

These steps assume a Mac, since Friday is built to control macOS specifically (Accessibility
APIs, `open -a`, the `say` command, macOS permission dialogs).

## 1. Prerequisites

- macOS 13+ (Ventura or later recommended)
- Node.js 20+ and npm
- [Ollama](https://ollama.com) if you want the LLM fallback for commands the rule-based router
  doesn't recognize (the built-in router already covers the spec's core vocabulary without it)
- Google Chrome installed (Friday drives your real Chrome profile via Playwright so your existing
  logins carry over - it does not use a separate throwaway browser)
- (Optional) [whisper.cpp](https://github.com/ggml-org/whisper.cpp) built locally, with a ggml
  model downloaded, if you want push-to-talk voice input

## 2. Install and run

```bash
git clone <this repo>
cd Friday
npm install
npm run dev
```

`npm install` will download Electron's binary and Playwright's Chromium build - both require
normal internet access (no restrictive proxy), which the sandbox this project was built in did
not have. This should work without any special configuration on your Mac.

`npm run dev` opens the Friday desktop window with hot reload.

## 3. Grant macOS permissions

Open the **Permissions** tab in the Friday window. It will show the live status of:

- **Microphone** - required for push-to-talk. macOS will prompt the first time you try to record.
- **Accessibility** - required for any future native-app control beyond `open -a` launching.
  System Settings → Privacy & Security → Accessibility → enable Friday (or your terminal/Electron
  process, depending on how you're running it in dev mode).
- **Screen Recording** - only needed if/when a screenshot-based fallback is added; not required
  for the current feature set.
- **Notifications** / **Calendar** - Electron doesn't expose a queryable permission API for these,
  so the panel will say "Check System Settings" rather than guess. Grant them there if a future
  feature needs them.

## 4. Connect a local model (optional but recommended)

```bash
ollama pull llama3.1
ollama serve   # usually already running as a background service after install
```

In the Friday **Settings** tab, confirm:

- Base URL: `http://localhost:11434`
- Model: `llama3.1` (or whatever you pulled)

The command router tries the deterministic rule-based parser first (works with zero setup) and
only falls back to Ollama for phrasing it doesn't recognize. If Ollama isn't running, Friday will
say it didn't understand rather than guessing.

## 5. Enable voice input (optional)

1. Build whisper.cpp and download a model, e.g.:
   ```bash
   git clone https://github.com/ggml-org/whisper.cpp
   cd whisper.cpp && make
   ./models/download-ggml-model.sh base.en
   ```
2. In Friday's Settings tab, set:
   - **Whisper.cpp binary path**: full path to the compiled `main` (or `whisper-cli`) binary
   - **Whisper model path**: full path to the `.bin` model file
3. Hold the "Hold to talk" button in the command bar, or bind the global shortcut in Settings.

Without this configured, push-to-talk will surface a clear "speech-to-text is not configured"
message - it will not silently fail. Typed commands always work regardless.

## 6. Try the demo sequence

With the app running, type (or speak) these one at a time:

1. `Open YouTube.`
2. `Search for OpenAI Build Week.`
3. `Open the first official result.`
4. `Pause.`
5. `Open ChatGPT.`
6. `Stop.`

Watch the **Current Task** panel to see each step verified, and the **Activity History** tab for
a full log.

## 7. Packaging (optional)

```bash
npm run build:mac
```

This was not run as part of this build (no macOS available in the sandbox) - see
`docs/LIMITATIONS.md`.
