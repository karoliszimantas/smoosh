// The moderation floor for the shared cut library: a blocklist file and an
// append-only reports file, both plain JSON on disk next to the server.
// tools/moderate.ts is the only intended writer of blocklist.json — the
// server re-reads it whenever it changes, so blocking takes effect without a
// restart.

import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { watchFile } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const DATA_DIR = process.env.MEDIA_DATA_DIR ?? path.join(__dirname, '..', '..', 'data')
const BLOCKLIST_PATH = path.join(DATA_DIR, 'blocklist.json')
const REPORTS_PATH = path.join(DATA_DIR, 'reports.jsonl')

// reports need no auth, so the file is capped rather than trusted to stay
// small — once full, new reports are refused until an admin clears it
const MAX_REPORTS_BYTES = 5 * 1024 * 1024
export const MAX_REASON_LENGTH = 200

let blocked: ReadonlySet<number> = new Set()

function parseBlocklist(value: unknown): Set<number> | null {
  if (!Array.isArray(value)) return null
  const ids = new Set<number>()
  for (const v of value) {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) return null
    ids.add(v)
  }
  return ids
}

async function reloadBlocklist(): Promise<void> {
  let text: string
  try {
    text = await readFile(BLOCKLIST_PATH, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      blocked = new Set()
      return
    }
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // keep the previous list rather than unblocking everything because of a
    // half-written or hand-mangled file
    console.error('[moderation] blocklist.json is not valid JSON — keeping previous list')
    return
  }
  const ids = parseBlocklist(parsed)
  if (!ids) {
    console.error('[moderation] blocklist.json must be an array of positive integer ids — keeping previous list')
    return
  }
  blocked = ids
  console.log(`[moderation] blocklist loaded: ${ids.size} id(s)`)
}

export async function initModeration(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  await reloadBlocklist()
  // polling rather than fs.watch: survives the file being replaced by an
  // atomic rename (which is how moderate.ts writes it)
  watchFile(BLOCKLIST_PATH, { interval: 2000 }, () => {
    reloadBlocklist().catch((err: unknown) => console.error('[moderation] reload failed', err))
  })
}

export function isBlocked(pixabayId: number): boolean {
  return blocked.has(pixabayId)
}

export type ReportRecord = {
  at: string
  pixabayId: number
  reason: string
}

export type ReportOutcome = 'ok' | 'full'

export async function appendReport(pixabayId: number, reason: string): Promise<ReportOutcome> {
  try {
    const { size } = await stat(REPORTS_PATH)
    if (size >= MAX_REPORTS_BYTES) return 'full'
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  const record: ReportRecord = { at: new Date().toISOString(), pixabayId, reason }
  await appendFile(REPORTS_PATH, `${JSON.stringify(record)}\n`)
  return 'ok'
}
