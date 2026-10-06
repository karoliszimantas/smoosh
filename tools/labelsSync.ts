// Keeps tools/asset-labels.tsv in step with the live copy the /labels tool
// edits (on the game server, in the private R2 bucket).
//
//   pnpm labels:pull   bring the live labels into the repo file
//   pnpm labels:push   send the repo file (your hand edits) live
//
// The live copy is where the tool's edits land; this file is where yours
// do. A push is refused if the live copy changed since your last pull, so
// nothing is overwritten unseen. A pull merges row by row against the copy
// you last synced (.labels-sync/base.tsv): rows only you changed keep your
// version, rows only the tool changed take theirs, and a row both changed
// takes the live one — yours is written to .labels-sync/conflicts.tsv to
// look at. Commit the file after a pull or push as usual.
//
// Needs in tools/.env:  SMOOSH_SERVER_URL=https://…   LABELS_CODE=<the shared code>

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLabels, serializeLabels, type LabelRow } from '@smoosh/protocol'
import { LABELS_TSV } from './assetLabels.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATE_DIR = path.join(__dirname, '.labels-sync')
const BASE = path.join(STATE_DIR, 'base.tsv')
const CONFLICTS = path.join(STATE_DIR, 'conflicts.tsv')

const SERVER = (process.env.SMOOSH_SERVER_URL ?? '').replace(/\/+$/, '')
const CODE = process.env.LABELS_CODE ?? ''
const WHO = process.env.LABELS_NAME ?? 'laptop'

function versionOf(text: string | null): string {
  return text === null ? 'empty' : createHash('sha256').update(text).digest('hex').slice(0, 16)
}

async function read(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

async function api(method: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${SERVER}/api/labels/file`, {
    method,
    headers: { 'x-prompt-code': CODE, 'x-prompt-author': encodeURIComponent(WHO), 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, data: (await res.json()) as Record<string, unknown> }
}

function rows(text: string | null): Map<string, LabelRow> {
  if (text === null) return new Map()
  return new Map(parseLabels(text).doc.rows.map((r) => [r.id, r]))
}
const same = (a: LabelRow | undefined, b: LabelRow | undefined) => JSON.stringify(a) === JSON.stringify(b)

async function pull(): Promise<void> {
  const { status, data } = await api('GET')
  if (status !== 200) throw new Error(String(data.message ?? `pull failed (${status})`))
  const live = typeof data.text === 'string' ? data.text : null
  if (live === null) {
    console.log('Nothing live yet — run pnpm labels:push to send this file up first.')
    return
  }
  const local = await read(LABELS_TSV)
  const base = await read(BASE)
  let next = live
  const conflicts: LabelRow[] = []
  if (local !== null && local !== base && local !== live) {
    // your file has edits the live copy hasn't seen: merge row by row
    const [b, l, r] = [rows(base), rows(local), rows(live)]
    const liveDoc = parseLabels(live).doc
    const merged = liveDoc.rows.map((remote) => {
      const mine = l.get(remote.id)
      const was = b.get(remote.id)
      const iChanged = mine !== undefined && !same(mine, was)
      const theyChanged = !same(remote, was)
      if (iChanged && !theyChanged) return mine
      if (iChanged && theyChanged && !same(mine, remote)) conflicts.push(mine)
      return remote
    })
    // rows you added that the live copy doesn't have
    for (const [id, mine] of l) if (!r.has(id) && !b.has(id)) merged.push(mine)
    next = serializeLabels({ ...liveDoc, preamble: parseLabels(local).doc.preamble, rows: merged })
  }
  await mkdir(STATE_DIR, { recursive: true })
  await writeFile(LABELS_TSV, next)
  await writeFile(BASE, live)
  if (conflicts.length > 0) {
    const doc = parseLabels(live).doc
    await writeFile(CONFLICTS, serializeLabels({ ...doc, rows: conflicts }))
    console.warn(
      base === null
        ? `No record of an earlier sync on this laptop, so ${conflicts.length} row(s) that differ from the live copy took the live version;`
        : `${conflicts.length} row(s) were changed both here and in the tool — the tool's version is in the file;`,
    )
    console.warn(`yours are in ${path.relative(process.cwd(), CONFLICTS)}: ${conflicts.map((c) => c.id).join(', ')}`)
  }
  const changed = local === null ? 'written' : next === local ? 'already up to date' : 'updated'
  console.log(`asset-labels.tsv ${changed} (${parseLabels(next).doc.rows.length} rows). Push to send any edits of yours.`)
}

async function push(): Promise<void> {
  const local = await read(LABELS_TSV)
  if (local === null) throw new Error('no asset-labels.tsv to push')
  const { problems } = parseLabels(local)
  if (problems.length > 0) {
    console.error('Fix these first — nothing was sent:')
    for (const p of problems.slice(0, 30)) console.error(`  ${p}`)
    process.exit(1)
  }
  const base = await read(BASE)
  const { status, data } = await api('PUT', { text: local, base: versionOf(base) })
  if (status === 409) {
    console.error(String(data.message ?? 'The live labels changed — pull first.'))
    process.exit(1)
  }
  if (status !== 200 || typeof data.text !== 'string') throw new Error(String(data.message ?? `push failed (${status})`))
  // the live copy, in the standard layout — this file matches it exactly
  await mkdir(STATE_DIR, { recursive: true })
  await writeFile(LABELS_TSV, data.text)
  await writeFile(BASE, data.text)
  console.log(`Pushed ${parseLabels(data.text).doc.rows.length} rows${data.text === local ? '' : ' (tidied into the standard layout)'}.`)
}

if (!SERVER || !CODE) {
  console.error('Set SMOOSH_SERVER_URL and LABELS_CODE in tools/.env (LABELS_NAME too, to be credited for pushes).')
  process.exit(1)
}
const command = process.argv[2]
if (command === 'pull') await pull()
else if (command === 'push') await push()
else console.error('usage: pnpm labels:pull | pnpm labels:push')
