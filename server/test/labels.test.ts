import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { parseLabels } from '@smoosh/protocol'
import type { PoolBackend } from '../src/prompts/store.ts'
import { LabelStore, versionOf } from '../src/labels/store.ts'
import { handleLabelsRequest, setLabelStoreForTests } from '../src/labels/routes.ts'

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

let base = ''
let server: http.Server
let mem = memory(REAL)
beforeAll(async () => {
  process.env.PROMPT_WRITE_KEY = 'letmein'
  server = http.createServer((req, res) => {
    handleLabelsRequest(req, res, new URL(req.url ?? '/', 'http://localhost'))
  })
  await new Promise<void>((r) => server.listen(0, r))
  base = `http://localhost:${(server.address() as AddressInfo).port}/api/labels`
})
afterAll(() => server.close())
beforeEach(() => {
  mem = memory(REAL)
  setLabelStoreForTests(new LabelStore(mem.backend))
})

let ip = 0
const call = (method: string, path: string, body?: unknown, author = 'Ana') =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      'x-prompt-code': 'letmein',
      'x-prompt-author': author,
      'x-forwarded-for': `10.1.0.${++ip}`,
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
const edit = (id: string, category: string, patch: Partial<{ label: string; tags: string[]; remove: boolean; note: string; seen: string | null }>, author = 'Ana') =>
  call('PATCH', `/rows/${encodeURIComponent(id)}`, { category, label: '', tags: [], remove: false, note: '', seen: null, ...patch }, author)

describe('/api/labels', () => {
  it('serves every row; a wrong code is refused', async () => {
    const res = await call('GET', '')
    const data = (await res.json()) as { rows: unknown[]; version: string }
    expect(data.rows).toHaveLength(552)
    expect(data.version).toBe(versionOf(REAL))
    const wrong = await fetch(base, { headers: { 'x-prompt-code': 'nope' } })
    expect(wrong.status).toBe(401)
  })

  it('an edit round-trips: the saved file still reads, and only that row changed — attributed', async () => {
    const res = await edit('animals-alpaca-7313977', 'animals', { label: 'Alpaca', tags: ['alpaca', 'llama', 'fluffy'] })
    expect(res.status).toBe(200)
    const { doc, problems } = parseLabels(mem.state.text ?? '')
    expect(problems).toEqual([])
    const changed = doc.rows.filter((r, i) => JSON.stringify(r) !== JSON.stringify(parseLabels(REAL).doc.rows[i]))
    expect(changed.map((r) => [r.id, r.editedBy])).toEqual([['animals-alpaca-7313977', 'Ana']])
  })

  it('two people editing different assets at once both land', async () => {
    const [a, b] = await Promise.all([
      edit('animals-alpaca-7313977', 'animals', { label: 'Alpaca A', tags: ['alpaca'] }, 'Ana'),
      edit('animals-animal-6756619', 'animals', { label: 'Goat B', tags: ['goat'] }, 'Ben'),
    ])
    expect([a.status, b.status]).toEqual([200, 200])
    const rows = parseLabels(mem.state.text ?? '').doc.rows
    expect(rows.find((r) => r.id === 'animals-alpaca-7313977')?.label).toBe('Alpaca A')
    expect(rows.find((r) => r.id === 'animals-animal-6756619')?.label).toBe('Goat B')
  })

  it('the same asset saved twice from what each saw: the second is asked to look again', async () => {
    await edit('animals-alpaca-7313977', 'animals', { label: 'One', tags: ['a'], seen: '' }, 'Ana')
    const second = await edit('animals-alpaca-7313977', 'animals', { label: 'Two', tags: ['b'], seen: '' }, 'Ben')
    expect(second.status).toBe(409)
    expect(((await second.json()) as { message: string }).message).toMatch(/Ana changed this a moment ago/)
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
    const push = await call('PUT', '/file', { text: REAL, base: 'empty' })
    expect(push.status).toBe(200)
    expect(mem.state.text).toBe(REAL)
  })

  it('a push from a laptop that is behind is refused; one in step lands, in the standard layout', async () => {
    await edit('animals-alpaca-7313977', 'animals', { label: 'Live edit', tags: ['x'] })
    const behind = await call('PUT', '/file', { text: REAL, base: versionOf(REAL) })
    expect(behind.status).toBe(409)
    const { text: live, version } = (await (await call('GET', '/file')).json()) as { text: string; version: string }
    const handEdited = live.replace('\tLive edit\tx\t', '\tLive edit\tx,y\t') // typed without the space
    const res = await call('PUT', '/file', { text: handEdited, base: version })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { text: string }).text).toContain('\tLive edit\tx, y\t')
  })
})
