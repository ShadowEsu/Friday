import Database from 'better-sqlite3'
import { ActivityEntry } from '../agent/types'

export class HistoryStore {
  constructor(private db: Database.Database) {}

  add(type: ActivityEntry['type'], message: string, data?: unknown): ActivityEntry {
    const timestamp = new Date().toISOString()
    const dataStr = data !== undefined ? JSON.stringify(data) : null
    const info = this.db
      .prepare('INSERT INTO history (timestamp, type, message, data) VALUES (?, ?, ?, ?)')
      .run(timestamp, type, message, dataStr)
    return {
      id: Number(info.lastInsertRowid),
      timestamp,
      type,
      message,
      data: dataStr ?? undefined
    }
  }

  list(limit = 200): ActivityEntry[] {
    const rows = this.db
      .prepare('SELECT id, timestamp, type, message, data FROM history ORDER BY id DESC LIMIT ?')
      .all(limit) as ActivityEntry[]
    return rows.reverse()
  }

  clear(): void {
    this.db.prepare('DELETE FROM history').run()
  }
}
