import Database from 'better-sqlite3'
import { FridaySettings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/defaults'

export class SettingsStore {
  constructor(private db: Database.Database) {}

  getAll(): FridaySettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as {
      key: string
      value: string
    }[]
    const stored: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        stored[row.key] = JSON.parse(row.value)
      } catch {
        stored[row.key] = row.value
      }
    }
    return { ...DEFAULT_SETTINGS, ...stored }
  }

  set(partial: Partial<FridaySettings>): FridaySettings {
    const insert = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    const tx = this.db.transaction((entries: [string, unknown][]) => {
      for (const [key, value] of entries) insert.run(key, JSON.stringify(value))
    })
    tx(Object.entries(partial))
    return this.getAll()
  }
}
