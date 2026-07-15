import Database from 'better-sqlite3'

export interface MemoryItem {
  key: string
  value: string
  updatedAt: string
}

/** Simple local key-value memory: preferred apps, named projects, reusable workflows, etc. */
export class MemoryStore {
  constructor(private db: Database.Database) {}

  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM memory WHERE key = ?').get(key) as
      { value: string } | undefined
    return row?.value
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO memory (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt'
      )
      .run(key, value, new Date().toISOString())
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM memory WHERE key = ?').run(key)
  }

  list(): MemoryItem[] {
    return this.db
      .prepare('SELECT key, value, updatedAt FROM memory ORDER BY key')
      .all() as MemoryItem[]
  }

  clearAll(): void {
    this.db.prepare('DELETE FROM memory').run()
  }
}
