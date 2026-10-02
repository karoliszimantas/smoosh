import { describe, it, expect } from 'vitest'
import { PromptStore, PromptTextSchema, score, type PoolBackend } from '../src/prompts/store.ts'

// a backend with a deliberately slow, interleavable save — the worst case
// for two people writing at once
function memoryBackend(initial: string | null = null) {
  const state = { json: initial, saves: 0, failSave: false, failLoad: false }
  const backend: PoolBackend = {
    name: 'memory',
    async load() {
      if (state.failLoad) throw new Error('unreachable')
      return state.json
    },
    async save(json) {
      await new Promise((r) => setTimeout(r, 5))
      if (state.failSave) throw new Error('write failed')
      state.json = json
      state.saves++
    },
  }
  return { backend, state }
}

let n = 0
const store = (b: PoolBackend) => new PromptStore(b, () => new Date('2026-10-02T12:00:00Z'), () => `id${++n}`)

describe('prompt store', () => {
  it('normalises text: trims and collapses whitespace', () => {
    expect(PromptTextSchema.parse('  Llama   in a\tLaundromat ')).toBe('Llama in a Laundromat')
    expect(PromptTextSchema.safeParse('  hi ').success).toBe(false)
    expect(PromptTextSchema.safeParse('x'.repeat(121)).success).toBe(false)
  })

  it('keeps both of two concurrent writes, and persists both', async () => {
    const { backend, state } = memoryBackend()
    const s = store(backend)
    await Promise.all([s.add('Goat on a Unicycle', 'both', 'Ana'), s.add('Owl at the Dentist', 'guess', 'Ben')])
    expect((await s.list()).map((p) => p.text).sort()).toEqual(['Goat on a Unicycle', 'Owl at the Dentist'])
    expect(JSON.parse(state.json!).prompts).toHaveLength(2)
  })

  it('rejects a case-insensitive duplicate, naming who wrote it', async () => {
    const s = store(memoryBackend().backend)
    await s.add('Goat on a Unicycle', 'both', 'Ana')
    await expect(s.add('goat ON a unicycle', 'guess', 'Ben')).rejects.toThrow(/Ana wrote it/)
  })

  it('archive then restore returns the prompt unchanged', async () => {
    const s = store(memoryBackend().backend)
    const p = await s.add('Goat on a Unicycle', 'gallery', 'Ana')
    await s.vote(p.id, 'Ben', 1)
    const before = structuredClone((await s.list())[0])
    await s.edit(p.id, { archived: true })
    await s.edit(p.id, { archived: false })
    expect((await s.list())[0]).toEqual(before)
  })

  it('only deletes archived prompts, single or bulk', async () => {
    const s = store(memoryBackend().backend)
    const a = await s.add('Goat on a Unicycle', 'both', 'Ana')
    const b = await s.add('Owl at the Dentist', 'both', 'Ana')
    await expect(s.remove(a.id)).rejects.toThrow(/Archive it first/)
    await s.bulk([b.id], 'archive')
    expect(await s.bulk([a.id, b.id], 'delete')).toBe(1)
    expect((await s.list()).map((p) => p.id)).toEqual([a.id])
  })

  it('one vote per person, changeable; a downvote never archives', async () => {
    const s = store(memoryBackend().backend)
    const p = await s.add('Goat on a Unicycle', 'both', 'Ana')
    await s.vote(p.id, 'Ben', -1)
    await s.vote(p.id, 'ben ', 1) // same person, different casing
    await s.vote(p.id, 'Cy', -1)
    await s.vote(p.id, 'Ana', -1)
    const after = (await s.list())[0]!
    expect(Object.keys(after.votes)).toHaveLength(3)
    expect(score(after)).toBe(-1)
    expect(after.archived).toBe(false)
  })

  it('a failed save leaves the pool exactly as it was', async () => {
    const { backend, state } = memoryBackend()
    const s = store(backend)
    await s.add('Goat on a Unicycle', 'both', 'Ana')
    state.failSave = true
    await expect(s.add('Owl at the Dentist', 'both', 'Ben')).rejects.toThrow()
    state.failSave = false
    expect(await s.list()).toHaveLength(1)
    // and the queue keeps working after a failure
    await s.add('Owl at the Dentist', 'both', 'Ben')
    expect(await s.list()).toHaveLength(2)
  })

  it('an unreachable store is never treated as empty — no write can overwrite it', async () => {
    const existing = JSON.stringify({ version: 1, prompts: [] })
    const { backend, state } = memoryBackend(existing)
    state.failLoad = true
    const s = store(backend)
    await expect(s.add('Goat on a Unicycle', 'both', 'Ana')).rejects.toThrow(/can't be reached/)
    expect(state.saves).toBe(0)
    state.failLoad = false // recovers on the next request
    await s.add('Goat on a Unicycle', 'both', 'Ana')
    expect(await s.list()).toHaveLength(1)
  })

  it('caps the pool', async () => {
    const prompts = Array.from({ length: 2000 }, (_, i) => ({
      id: `p${i}`, text: `Prompt number ${i}`, mode: 'both', author: 'Ana',
      createdAt: '2026-10-01T00:00:00Z', archived: false, votes: {}, buildCount: 0,
    }))
    const s = store(memoryBackend(JSON.stringify({ version: 1, prompts })).backend)
    await expect(s.add('One too many', 'both', 'Ana')).rejects.toThrow(/full/)
  })
})
