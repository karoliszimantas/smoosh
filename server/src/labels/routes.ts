// The asset labels, two ways in:
//
//   /api/admin/labels — the /admin labels section, for whoever is signed in
//   (admin/routes.ts checks the session first). Edits are credited to the
//   signed-in account.
//     GET   /api/admin/labels             every row, and the file's version
//     PATCH /api/admin/labels/rows/:id    one asset's label, tags, remove flag, note
//
//   /api/labels/file — the laptop's pull and push (tools/labelsSync.ts),
//   machine to machine: an `Authorization: Bearer` key, LABELS_SYNC_KEY,
//   that no browser ever holds. No session is accepted here, and the key is
//   accepted nowhere else. Never logged.
//     GET   /api/labels/file              the file as text (pull)
//     PUT   /api/labels/file              the whole file (push)

import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { createPrivateBackend } from '../prompts/backends.ts'
import { answer, header, parse, readJson, secretMatches, sendError, sendJson, tokenTaker } from '../admin/http.ts'
import type { Actor } from '../admin/actor.ts'
import { labelsSyncKey } from '../admin/config.ts'
import { LabelStore } from './store.ts'

// labelling is a rhythm — a save every few seconds — so more than prompts
const WRITES_PER_MINUTE = 60
// and a ceiling per person per day, so a stuck script or a runaway tab
// can't churn the file
const WRITES_PER_PERSON_PER_DAY = 1500
// the whole file comes in on a push: room for a few thousand rows
const MAX_FILE_BYTES = 1_000_000
// pushes and pulls are a handful a day
const SYNCS_PER_MINUTE = 10
// what the laptop's pushes count against, in the daily cap
const LAPTOP = 'labels-sync'

let store: LabelStore | null = null
function getStore(): LabelStore {
  store ??= new LabelStore(createPrivateBackend('asset-labels.tsv', 'text/tab-separated-values; charset=utf-8'))
  return store
}
export function setLabelStoreForTests(s: LabelStore): void {
  store = s
}

// per account (or the laptop): everyone's signed in, so an address adds little
const takeWriteToken = tokenTaker(WRITES_PER_MINUTE, WRITES_PER_MINUTE / 60_000)
const takeSyncToken = tokenTaker(SYNCS_PER_MINUTE, SYNCS_PER_MINUTE / 60_000)

const writesToday = new Map<string, { day: string; count: number }>()
function underDailyCap(author: string): boolean {
  const day = new Date().toISOString().slice(0, 10)
  const key = author.toLowerCase()
  const entry = writesToday.get(key)
  if (!entry || entry.day !== day) {
    if (writesToday.size > 1000) writesToday.clear()
    writesToday.set(key, { day, count: 1 })
    return true
  }
  entry.count += 1
  return entry.count <= WRITES_PER_PERSON_PER_DAY
}

const EditSchema = z.object({
  category: z.string().min(1).max(40),
  label: z.string().max(80),
  tags: z.array(z.string().max(40)).max(40),
  remove: z.boolean(),
  note: z.string().max(300),
  // edited_at as the editor last saw it ("" for never) — see LabelStore.editRow
  seen: z.string().max(40).nullable(),
})
const FileSchema = z.object({ text: z.string().min(1), base: z.string().min(1).max(40) })

function writeAllowed(res: ServerResponse, who: string): boolean {
  if (!takeWriteToken(who)) {
    sendError(res, 429, 'slow_down', "You're going a bit fast — wait a minute and try again.")
    return false
  }
  if (!underDailyCap(who)) {
    sendError(res, 429, 'daily_cap', `That's ${WRITES_PER_PERSON_PER_DAY} saves today — the rest can wait for tomorrow.`)
    return false
  }
  return true
}

export async function handleLabels(req: IncomingMessage, res: ServerResponse, parts: string[], actor: Actor): Promise<void> {
  const method = req.method ?? 'GET'
  const [what, id, extra] = parts
  const s = getStore()

  if (method === 'GET' && what === undefined) {
    sendJson(res, 200, await s.snapshot())
    return
  }
  if (method === 'PATCH' && what === 'rows' && id && extra === undefined) {
    if (!writeAllowed(res, actor.email)) return
    const body = parse(EditSchema, await readJson(req))
    const row = await s.editRow(decodeURIComponent(id), body.category, body, actor.name, body.seen)
    sendJson(res, 200, { row })
    return
  }
  sendError(res, 404, 'not_found', 'not found')
}

// true when the path was ours (answered, one way or another)
export function handleLabelsSyncRequest(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  if (url.pathname !== '/api/labels/file') return false
  answer(res, 'labels', sync(req, res))
  return true
}

async function sync(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const key = labelsSyncKey()
  if (!key) {
    sendError(res, 503, 'not_set_up', 'Labels sync isn’t set up on this server — set LABELS_SYNC_KEY in server/.env.')
    return
  }
  const given = /^Bearer (.+)$/.exec(header(req, 'authorization'))?.[1] ?? ''
  if (!secretMatches(given, key)) {
    sendError(res, 401, 'wrong_key', 'That key isn’t right — LABELS_SYNC_KEY in tools/.env must match the server’s.')
    return
  }
  if (!takeSyncToken(LAPTOP)) {
    sendError(res, 429, 'slow_down', 'That’s a lot of syncs at once — wait a minute and try again.')
    return
  }
  const s = getStore()
  if (req.method === 'GET') {
    const { text, version } = await s.file()
    sendJson(res, 200, { text, version })
    return
  }
  if (req.method === 'PUT') {
    if (!writeAllowed(res, LAPTOP)) return
    const body = parse(FileSchema, await readJson(req, MAX_FILE_BYTES))
    sendJson(res, 200, await s.replaceFile(body.text, body.base))
    return
  }
  sendError(res, 405, 'method_not_allowed', 'GET to pull, PUT to push.')
}
