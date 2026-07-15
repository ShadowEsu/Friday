import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/memory/db'
import { SettingsStore } from '../../src/main/memory/settings'
import { HistoryStore } from '../../src/main/memory/history'
import { MemoryStore } from '../../src/main/memory/store'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'

describe('local memory (SQLite)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = openDatabase(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('settings round-trip with sensible defaults', () => {
    const settings = new SettingsStore(db)
    expect(settings.getAll()).toEqual(DEFAULT_SETTINGS)

    const updated = settings.set({ model: 'llama3.1:70b', confirmBeforeSensitiveActions: false })
    expect(updated.model).toBe('llama3.1:70b')
    expect(updated.confirmBeforeSensitiveActions).toBe(false)
    expect(updated.voice).toBe(DEFAULT_SETTINGS.voice) // untouched fields keep their default

    expect(settings.getAll().model).toBe('llama3.1:70b')
  })

  it('records and lists activity history in chronological order', () => {
    const history = new HistoryStore(db)
    history.add('command', 'Open YouTube')
    history.add('tool', 'Opened https://www.youtube.com', { url: 'https://www.youtube.com' })
    history.add('response', 'YouTube is open.')

    const entries = history.list()
    expect(entries.map((e) => e.message)).toEqual([
      'Open YouTube',
      'Opened https://www.youtube.com',
      'YouTube is open.'
    ])
    expect(entries[0].type).toBe('command')
  })

  it('clears history', () => {
    const history = new HistoryStore(db)
    history.add('system', 'test entry')
    expect(history.list().length).toBe(1)
    history.clear()
    expect(history.list().length).toBe(0)
  })

  it('stores, lists, and deletes local memory items', () => {
    const memory = new MemoryStore(db)
    memory.set('preferred-browser', 'chrome')
    memory.set('regrade-project-url', 'https://claude.ai/project/regrade')

    expect(memory.get('preferred-browser')).toBe('chrome')
    expect(memory.list().length).toBe(2)

    memory.delete('preferred-browser')
    expect(memory.get('preferred-browser')).toBeUndefined()
    expect(memory.list().length).toBe(1)

    memory.clearAll()
    expect(memory.list().length).toBe(0)
  })
})
