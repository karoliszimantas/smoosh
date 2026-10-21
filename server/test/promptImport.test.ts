import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type http from 'node:http'
import { PromptStore, type PoolBackend } from '../src/prompts/store.ts'
import { setPromptStoreForTests } from '../src/prompts/routes.ts'
import { adminEnv, sessionCookie, startAdminServer } from './adminHelpers.ts'

function memoryBackend() {
  const state = { json: null as string | null, saves: 0, failSave: false }
  const backend: PoolBackend = {
    name: 'memory',
    load: async () => state.json,
    save: async (json) => {
      if (state.failSave) throw new Error('write failed')
      state.json = json
      state.saves++
    },
  }
  return { backend, state }
}

const row = (text: string, mode: 'guess' | 'gallery' | 'both' = 'guess', author = 'Ana') => ({ text, mode, author })
// distinct, short, guess-legal: "Prompt Number 17"
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(`Prompt Number ${i}`))

describe('importing into the store', () => {
  it('adds every row, keeping each row’s author', async () => {
    const s = new PromptStore(memoryBackend().backend)
    const added = await s.import([row('Goat on a Bike', 'guess', 'Ben'), row('Owl at Noon', 'both', 'generated')])
    expect(added).toHaveLength(2)
    expect((await s.list()).map((p) => [p.text, p.author])).toEqual([
      ['Goat on a Bike', 'Ben'],
      ['Owl at Noon', 'generated'],
    ])
  })

  it('one bad row and nothing lands — rules, pool duplicates and duplicates within the import', async () => {
    const { backend, state } = memoryBackend()
    const s = new PromptStore(backend)
    await s.add('Owl at Noon', 'guess', 'Ben')
    const before = state.json
    await expect(s.import([row('Goat on a Bike'), row('A Very Long Prompt That Goes On')])).rejects.toThrow(
      /Row 2.*5 words.*Nothing was imported/,
    )
    await expect(s.import([row('Goat on a Bike'), row('owl  AT noon')])).rejects.toThrow(/Ben wrote it/)
    await expect(s.import([row('Goat on a Bike'), row('Goat on a bike')])).rejects.toThrow(/Row 2.*already/)
    await expect(s.import([row('Sloth Napping.')])).rejects.toThrow(/full stop/)
    expect(state.json).toBe(before)
    expect(await s.list()).toHaveLength(1)
  })

  it('a failed save leaves the pool as it was', async () => {
    const { backend, state } = memoryBackend()
    const s = new PromptStore(backend)
    state.failSave = true
    await expect(s.import([row('Goat on a Bike')])).rejects.toThrow()
    expect(await s.list()).toHaveLength(0)
  })

  it('single adds and edits follow the same rules', async () => {
    const s = new PromptStore(memoryBackend().backend)
    await expect(s.add('A Very Long Prompt That Goes On', 'both', 'Ana')).rejects.toThrow(/5 words/)
    const p = await s.add('A Very Long Prompt That Goes On', 'gallery', 'Ana')
    await expect(s.edit(p.id, { mode: 'guess' })).rejects.toThrow(/5 words/)
    await s.edit(p.id, { archived: true }) // untouched rules don't block other changes
  })
})

describe('POST /api/admin/prompts/import', () => {
  let server: http.Server
  let origin = ''
  let base = ''
  beforeAll(async () => {
    adminEnv()
    // rate limits are per account: one each, so they don't carry over
    process.env.ADMIN_EMAILS = Array.from({ length: 20 }, (_, i) => `writer${i}@example.com`).join(',')
    ;({ server, origin } = await startAdminServer())
    base = `${origin}/api/admin/prompts`
  })
  afterAll(() => server.close())
  beforeEach(() => setPromptStoreForTests(new PromptStore(memoryBackend().backend)))

  let account = 0
  const post = (path: string, body: unknown, who = `writer${++account}@example.com`) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { cookie: sessionCookie(who), origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('200 rows in one request', async () => {
    const res = await post('/import', { rows: rows(200) })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { prompts: unknown[]; added: string[] }
    expect(data.added).toHaveLength(200)
    expect(data.prompts).toHaveLength(200)
  })

  it('201 is refused, with a plain message, and nothing is written', async () => {
    const res = await post('/import', { rows: rows(201) })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toBe(
      'At most 200 prompts in one import — split it into smaller batches.',
    )
    const list = await fetch(base, { headers: { cookie: sessionCookie('writer0@example.com') } })
    expect(((await list.json()) as { prompts: unknown[] }).prompts).toHaveLength(0)
  })

  it('checks again on the server — a client that skipped the preview gets refused', async () => {
    const res = await post('/import', { rows: [row('Fine Prompt'), row('Ends With A Stop.')] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toMatch(/Row 2.*full stop/)
  })

  it('imports have their own rate limit, apart from single writes', async () => {
    const who = 'writer19@example.com'
    for (let i = 0; i < 5; i++) expect((await post('/import', { rows: [row(`Batch Prompt ${i}`)] }, who)).status).toBe(200)
    expect((await post('/import', { rows: [row('One More Batch')] }, who)).status).toBe(429)
    // single writes from the same person still go through
    expect((await post('', { text: 'Single Prompt', mode: 'guess' }, who)).status).toBe(200)
  })

  it('credits a typed author as typed, the importer as their account — and refuses an @ in a typed one', async () => {
    const who = 'writer18@example.com'
    const res = await post('/import', { rows: [{ ...row('From A Friend'), author: 'Mia' }, { ...row('From Me'), author: '@writer18' }] }, who)
    expect(res.status).toBe(200)
    const { prompts } = (await res.json()) as { prompts: { text: string; author: string }[] }
    expect(prompts.map((p) => [p.text, p.author])).toEqual([
      ['From A Friend', 'Mia'],
      ['From Me', '@writer18'],
    ])
    const forged = await post('/import', { rows: [{ ...row('Pretending'), author: '@writer17' }] }, who)
    expect(forged.status).toBe(400)
    expect(((await forged.json()) as { message: string }).message).toMatch(/can’t contain @/)
  })
})
