// Moderation for the shared cut library. Runs on the machine the game server
// runs on — it reads and writes the same data dir (server/data by default,
// or MEDIA_DATA_DIR). The server re-reads blocklist.json within a couple of
// seconds of it changing, so no restart is needed after `block`.
//
//   pnpm moderate list              reports grouped by image, most-reported first
//   pnpm moderate block <id> [...]  blocklist ids and delete their stored cuts
//   pnpm moderate unblock <id> [...]
//
// Deleting from R2 needs the same R2_* variables as publish.ts (tools/.env).
// Without them, `block` still blocks — it just can't remove the R2 object,
// and says so.

import { readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.MEDIA_DATA_DIR ?? path.join(__dirname, '..', 'server', 'data')
const BLOCKLIST_PATH = path.join(DATA_DIR, 'blocklist.json')
const REPORTS_PATH = path.join(DATA_DIR, 'reports.jsonl')
const LOCAL_CUTS_DIR = path.join(DATA_DIR, 'cuts')

interface Report {
  at: string
  pixabayId: number
  reason: string
}

function isReport(value: unknown): value is Report {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.at === 'string' && typeof v.pixabayId === 'number' && typeof v.reason === 'string'
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function loadBlocklist(): Promise<Set<number>> {
  let text: string
  try {
    text = await readFile(BLOCKLIST_PATH, 'utf8')
  } catch {
    return new Set()
  }
  const parsed: unknown = JSON.parse(text)
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'number' && Number.isSafeInteger(v))) {
    throw new Error(`${BLOCKLIST_PATH} must be a JSON array of integer ids — fix it by hand before continuing`)
  }
  return new Set(parsed as number[])
}

// write-then-rename so the server's watcher never reads a half-written file
async function saveBlocklist(ids: Set<number>): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  const tmp = `${BLOCKLIST_PATH}.tmp-${process.pid}`
  await writeFile(tmp, `${JSON.stringify([...ids].sort((a, b) => a - b), null, 2)}\n`)
  await rename(tmp, BLOCKLIST_PATH)
}

async function loadReports(): Promise<Report[]> {
  let text: string
  try {
    text = await readFile(REPORTS_PATH, 'utf8')
  } catch {
    return []
  }
  const reports: Report[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (isReport(parsed)) reports.push(parsed)
    } catch {
      // a torn last line from a crash mid-append — skip it
    }
  }
  return reports
}

function parseIds(args: string[]): number[] {
  const ids: number[] = []
  for (const arg of args) {
    const id = Number(arg)
    if (!Number.isSafeInteger(id) || id <= 0) {
      console.error(`[ERROR] not a Pixabay id: "${arg}"`)
      process.exit(1)
    }
    ids.push(id)
  }
  if (ids.length === 0) {
    console.error('[ERROR] give at least one id')
    process.exit(1)
  }
  return ids
}

async function list(): Promise<void> {
  const [reports, blocked] = await Promise.all([loadReports(), loadBlocklist()])
  if (reports.length === 0) {
    console.log('no reports')
    return
  }

  const byId = new Map<number, Report[]>()
  for (const r of reports) {
    const group = byId.get(r.pixabayId) ?? []
    group.push(r)
    byId.set(r.pixabayId, group)
  }

  const rows = [...byId.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [id, group] of rows) {
    const reasons = new Map<string, number>()
    for (const r of group) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1)
    const last = group.map((r) => r.at).sort().at(-1) ?? ''
    const status = blocked.has(id) ? '[BLOCKED]' : ''
    console.log(`${id}  ${group.length} report(s), last ${last.slice(0, 16).replace('T', ' ')} ${status}`)
    console.log(`     https://pixabay.com/photos/id-${id}/`)
    for (const [reason, count] of reasons) console.log(`     - ${reason}${count > 1 ? ` (x${count})` : ''}`)
  }
  console.log(`\n${reports.length} report(s) across ${rows.length} image(s). Block with: pnpm moderate block <id>`)
}

function createR2Client(): { client: S3Client; bucket: string } | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ASSETS_BUCKET } = process.env
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ASSETS_BUCKET) return null
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  })
  return { client, bucket: R2_ASSETS_BUCKET }
}

async function deleteStoredCuts(ids: number[]): Promise<void> {
  // dev-mode local store — harmless no-op when the files don't exist
  for (const id of ids) {
    await rm(path.join(LOCAL_CUTS_DIR, `${id}.webp`), { force: true })
    await rm(path.join(LOCAL_CUTS_DIR, `${id}-thumb.webp`), { force: true })
  }

  const r2 = createR2Client()
  if (!r2) {
    console.warn('[WARN] R2_* not set — blocked, but any cut already in R2 was NOT deleted.')
    console.warn('       Its public URL keeps working until you rerun this with tools/.env configured.')
    return
  }
  const keys = ids.flatMap((id) => [`cuts/${id}.webp`, `cuts/${id}-thumb.webp`])
  const res = await r2.client.send(
    new DeleteObjectsCommand({ Bucket: r2.bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }),
  )
  for (const err of res.Errors ?? []) console.error(`[FAIL] delete ${err.Key}: ${err.Message}`)
  console.log(`deleted from R2 (if present): ${keys.join(', ')}`)
  console.log('note: browsers that already cached a cut keep their copy (it was served as immutable)')
}

async function block(ids: number[]): Promise<void> {
  const blocked = await loadBlocklist()
  for (const id of ids) blocked.add(id)
  await saveBlocklist(blocked)
  console.log(`blocked: ${ids.join(', ')} (server picks this up within a few seconds)`)
  await deleteStoredCuts(ids)
}

async function unblock(ids: number[]): Promise<void> {
  const blocked = await loadBlocklist()
  for (const id of ids) blocked.delete(id)
  await saveBlocklist(blocked)
  console.log(`unblocked: ${ids.join(', ')}`)
  console.log('its stored cut (if any) was deleted when blocked — the next player to cut it re-creates it,')
  console.log('but restart the server first so its cut index forgets the deleted object')
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2).filter((a) => a !== '--')
  switch (command) {
    case 'list':
      await list()
      return
    case 'block':
      await block(parseIds(rest))
      return
    case 'unblock':
      await unblock(parseIds(rest))
      return
    default:
      console.log('usage: pnpm moderate list | block <id> [...] | unblock <id> [...]')
      console.log(`data dir: ${DATA_DIR}`)
      process.exitCode = command ? 1 : 0
  }
}

main().catch((err: unknown) => {
  console.error('fatal:', errorMessage(err))
  process.exitCode = 1
})
