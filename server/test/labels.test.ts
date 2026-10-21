import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type http from 'node:http'
import { readFileSync } from 'node:fs'
import { parseLabels, serializeLabels } from '@smoosh/protocol'
import type { PoolBackend } from '../src/prompts/store.ts'
import { LabelStore, versionOf } from '../src/labels/store.ts'
import { setLabelStoreForTests } from '../src/labels/routes.ts'
import { adminEnv, sessionCookie, startAdminServer, SYNC_KEY } from './adminHelpers.ts'

const REAL = readFileSync(new URL('../../tools/asset-labels.tsv', import.meta.url), 'utf8')

function memory(initial: string | null = null) {
  const state = { text: initial, saves: 0 }
  const backend: PoolBackend = {
    name: 'memory',
    load: async () => state.text,
    save: async (text) => {
      await new Promise((r) => setTimeout(r, 3)) // slow enough to interleave
      state.text = text
      state.saves++
    },
  }
  return { backend, state }
}

let origin = ''
let base = ''
let server: http.Server
let mem = memory(REAL)
beforeAll(async () => {
  adminEnv()
  ;({ server, origin } = await startAdminServer())
  base = `${origin}/api/admin/labels`
})
afterAll(() => server.close())
beforeEach(() => {
  mem = memory(REAL)
  setLabelStoreForTests(new LabelStore(mem.backend))
})

// as the signed-in page sends it
const call = (method: string, path: string, body?: unknown, who = 'ana') =>
  fetch(`${base}${path}`, {
    method,
    headers: { cookie: sessionCookie(`${who}@example.com`), origin, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
// as the laptop sends it
const sync = (method: string, body?: unknown, key = SYNC_KEY) =>
  fetch(`${origin}/api/labels/file`, {
    method,
    headers: { authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
const edit = (id: string, category: string, patch: Partial<{ label: string; tags: string[]; remove: boolean; note: string; seen: string | null }>, who = 'ana') =>
  call('PATCH', `/rows/${encodeURIComponent(id)}`, { category, label: '', tags: [], remove: false, note: '', seen: null, ...patch }, who)

describe('/api/admin/labels', () => {
  it('serves every row; without a session it is refused', async () => {
    const res = await call('GET', '')
    const data = (await res.json()) as { rows: unknown[]; version: string }
    expect(data.rows).toHaveLength(552)
    expect(data.version).toBe(versionOf(REAL))
    expect((await fetch(base)).status).toBe(401)
    // the old shared code does nothing now
    expect((await fetch(base, { headers: { 'x-prompt-code': 'letmein', 'x-prompt-author': 'Ana' } })).status).toBe(401)
  })

  it('an edit round-trips: the saved file still reads, and only that row changed — credited to the account', async () => {
    const res = await edit('animals-alpaca-7313977', 'animals', { label: 'Alpaca', tags: ['alpaca', 'llama', 'fluffy'] })
    expect(res.status).toBe(200)
    const { doc, problems } = parseLabels(mem.state.text ?? '')
    expect(problems).toEqual([])
    const changed = doc.rows.filter((r, i) => JSON.stringify(r) !== JSON.stringify(parseLabels(REAL).doc.rows[i]))
    expect(changed.map((r) => [r.id, r.editedBy])).toEqual([['animals-alpaca-7313977', '@ana']])
  })

  it('two people editing different assets at once both land', async () => {
    const [a, b] = await Promise.all([
      edit('animals-alpaca-7313977', 'animals', { label: 'Alpaca A', tags: ['alpaca'] }, 'ana'),
      edit('animals-animal-6756619', 'animals', { label: 'Goat B', tags: ['goat'] }, 'ben'),
    ])
    expect([a.status, b.status]).toEqual([200, 200])
    const rows = parseLabels(mem.state.text ?? '').doc.rows
    expect(rows.find((r) => r.id === 'animals-alpaca-7313977')?.label).toBe('Alpaca A')
    expect(rows.find((r) => r.id === 'animals-animal-6756619')?.label).toBe('Goat B')
  })

  it('the same asset saved twice from what each saw: the second is asked to look again', async () => {
    await edit('animals-alpaca-7313977', 'animals', { label: 'One', tags: ['a'], seen: '' }, 'ana')
    const second = await edit('animals-alpaca-7313977', 'animals', { label: 'Two', tags: ['b'], seen: '' }, 'ben')
    expect(second.status).toBe(409)
    expect(((await second.json()) as { message: string }).message).toMatch(/@ana changed this a moment ago/)
  })

  it('a tab inside a cell is refused in plain words', async () => {
    const res = await edit('animals-alpaca-7313977', 'animals', { label: 'Alp\taca', tags: ['alpaca'] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toMatch(/tab or line break in it/)
  })

  it('remove round-trips, and restore brings it back', async () => {
    await edit('animals-alpaca-7313977', 'animals', { label: 'Alpaca', tags: ['alpaca'], remove: true })
    expect(parseLabels(mem.state.text ?? '').doc.rows.find((r) => r.id === 'animals-alpaca-7313977')?.remove).toBe(true)
    await edit('animals-alpaca-7313977', 'animals', { label: 'Alpaca', tags: ['alpaca'], remove: false })
    expect(parseLabels(mem.state.text ?? '').doc.rows.find((r) => r.id === 'animals-alpaca-7313977')?.remove).toBe(false)
  })

  it('a new asset gets its first row; an id from another category is refused', async () => {
    expect((await edit('animals-crab-123', 'animals', { label: 'Crab', tags: ['crab', 'crustacean'] })).status).toBe(200)
    expect((await edit('props-crab-124', 'animals', { label: 'Crab', tags: ['crab'] })).status).toBe(400)
  })

  it('nothing is edited until the laptop has pushed the file once', async () => {
    mem = memory(null)
    setLabelStoreForTests(new LabelStore(mem.backend))
    const res = await edit('animals-alpaca-7313977', 'animals', { label: 'Alpaca', tags: [] })
    expect(res.status).toBe(409)
    // the first push seeds it
    const push = await sync('PUT', { text: REAL, base: 'empty' })
    expect(push.status).toBe(200)
    expect(mem.state.text).toBe(REAL)
  })

  it('a push from a laptop that is behind is refused; one in step lands, in the standard layout', async () => {
    await edit('animals-alpaca-7313977', 'animals', { label: 'Live edit', tags: ['x'] })
    const behind = await sync('PUT', { text: REAL, base: versionOf(REAL) })
    expect(behind.status).toBe(409)
    const { text: live, version } = (await (await sync('GET')).json()) as { text: string; version: string }
    const handEdited = live.replace('\tLive edit\tx\t', '\tLive edit\tx,y\t') // typed without the space
    const res = await sync('PUT', { text: handEdited, base: version })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { text: string }).text).toContain('\tLive edit\tx, y\t')
  })
})

describe('/api/labels/file — the laptop', () => {
  it('takes the sync key and nothing else', async () => {
    expect((await sync('GET')).status).toBe(200)
    expect((await sync('GET', undefined, 'wrong'.repeat(10))).status).toBe(401)
    // a signed-in browser's cookie is no use here…
    const withCookie = await fetch(`${origin}/api/labels/file`, { headers: { cookie: sessionCookie('ana@example.com') } })
    expect(withCookie.status).toBe(401)
    // …and the key is no use in the browser's routes
    expect((await fetch(base, { headers: { authorization: `Bearer ${SYNC_KEY}` } })).status).toBe(401)
  })

  it('leaves rows written under a typed name exactly as they were', async () => {
    const doc = parseLabels(REAL).doc
    const withOld = { ...doc, rows: doc.rows.map((r) => (r.id === 'animals-animal-6756619' ? { ...r, editedBy: 'Karolis', editedAt: '2026-09-01T10:00:00.000Z' } : r)) }
    const seeded = serializeLabels(withOld)
    mem = memory(seeded)
    setLabelStoreForTests(new LabelStore(mem.backend))
    await edit('animals-alpaca-7313977', 'animals', { label: 'Alpaca', tags: ['alpaca'] })
    const rows = parseLabels(mem.state.text ?? '').doc.rows
    expect(rows.find((r) => r.id === 'animals-animal-6756619')).toMatchObject({ editedBy: 'Karolis', editedAt: '2026-09-01T10:00:00.000Z' })
    expect(rows.find((r) => r.id === 'animals-alpaca-7313977')?.editedBy).toBe('@ana')
    // and a pull hands the laptop back the same old row, byte for byte
    const { text } = (await (await sync('GET')).json()) as { text: string }
    const oldLine = seeded.split('\n').find((l) => l.startsWith('animals-animal-6756619\t'))
    expect(text.split('\n')).toContain(oldLine)
  })
})
