import type { ReactElement } from 'react'
import { FridaySettings } from '../../../shared/types'

export function SettingsPanel({
  settings,
  onChange
}: {
  settings: FridaySettings | null
  onChange: (partial: Partial<FridaySettings>) => void
}): ReactElement {
  if (!settings) return <div className="panel settings-panel">Loading settings…</div>

  return (
    <div className="panel settings-panel">
      <h2>Settings</h2>
      <label>
        Local model base URL
        <input value={settings.baseUrl} onChange={(e) => onChange({ baseUrl: e.target.value })} />
      </label>
      <label>
        Model
        <input value={settings.model} onChange={(e) => onChange({ model: e.target.value })} />
      </label>
      <label>
        Voice
        <input value={settings.voice} onChange={(e) => onChange({ voice: e.target.value })} />
      </label>
      <label>
        Speech rate (wpm)
        <input
          type="number"
          value={settings.speechRate}
          onChange={(e) => onChange({ speechRate: Number(e.target.value) })}
        />
      </label>
      <label>
        Global shortcut
        <input
          value={settings.globalShortcut}
          onChange={(e) => onChange({ globalShortcut: e.target.value })}
        />
      </label>
      <label>
        Whisper.cpp binary path
        <input
          value={settings.whisperBinaryPath}
          onChange={(e) => onChange({ whisperBinaryPath: e.target.value })}
        />
      </label>
      <label>
        Whisper model path
        <input
          value={settings.whisperModelPath}
          onChange={(e) => onChange({ whisperModelPath: e.target.value })}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.confirmBeforeSensitiveActions}
          onChange={(e) => onChange({ confirmBeforeSensitiveActions: e.target.checked })}
        />
        Confirm before sensitive actions
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.historyEnabled}
          onChange={(e) => onChange({ historyEnabled: e.target.checked })}
        />
        Keep local activity history
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.startOnLogin}
          onChange={(e) => onChange({ startOnLogin: e.target.checked })}
        />
        Start on login
      </label>
    </div>
  )
}
