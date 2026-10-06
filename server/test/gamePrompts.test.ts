import { describe, it, expect, vi, afterEach } from 'vitest'
import { PromptStore, type PoolBackend } from '../src/prompts/store.ts'
import { setPromptStoreForTests } from '../src/prompts/shared.ts'
import { gamePrompts } from '../src/prompts/gamePrompts.ts'
import { PROMPT_POOL } from '../src/game/promptPool.ts'

const backend = (json: string | null, fail = false): PoolBackend => ({
  name: 'memory',
  load: async () => {
    if (fail) throw new Error('unreachable')
    return json
  },
  save: async () => {},
})
const prompt = (text: string, mode: 'guess' | 'gallery' | 'both') => ({
  id: text, text, mode, author: 'Ana', createdAt: '2026-10-01T00:00:00Z', archived: false, votes: {}, buildCount: 0,
})

describe('game prompts', () => {
  afterEach(() => vi.restoreAllMocks())

  it('come from the team list', async () => {
    const s = new PromptStore(backend(JSON.stringify({ version: 1, prompts: [prompt('Goat on a Unicycle', 'guess')] })))
    await s.list()
    setPromptStoreForTests(s)
    expect(gamePrompts('guess')).toEqual(['Goat on a Unicycle'])
  })

  it('fall back to the generated pool when the list is unreachable or has none for the mode', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setPromptStoreForTests(new PromptStore(backend(null, true)))
    expect(gamePrompts('guess')).toBe(PROMPT_POOL)

    const s = new PromptStore(backend(JSON.stringify({ version: 1, prompts: [prompt('Goat on a Unicycle', 'guess')] })))
    await s.list()
    setPromptStoreForTests(s)
    expect(gamePrompts('gallery')).toBe(PROMPT_POOL)
  })
})
