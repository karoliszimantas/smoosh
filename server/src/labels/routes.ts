// /api/labels — the asset labels, for the /labels tool and the laptop's
// pull/push (tools/labelsSync.ts).
//
// ACCESS: the same as /api/prompts — one shared code (LABELS_WRITE_KEY, or
// PROMPT_WRITE_KEY when that isn't set) plus a self-chosen name. A shared
// password for three people who trust each other, not an auth system: before
// this goes anywhere public it needs real accounts and auth. The code is
// never logged.
//
//   GET   /api/labels             every row, and the file's version
//   PATCH /api/labels/rows/:id    one asset's label, tags, remove flag, note
//   GET   /api/labels/file        the file as text (the laptop's pull)
//   PUT   /api/labels/file        the whole file, from the laptop (push)

import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { PromptError } from '../prompts/store.ts'
import { createPrivateBackend } from '../prompts/backends.ts'
import { authorOf, codeMatches, header, parse, readJson, sendError, sendJson, tokenTaker } from '../prompts/routes.ts'
import { LabelStore } from './store.ts'

// labelling is a rhythm — a save every few seconds — so more than prompts
const WRITES_PER_MINUTE = 60
// and a ceiling per person per day, so a stuck script or a runaway tab
// can't churn the file
const WRITES_PER_PERSON_PER_DAY = 1500
// the whole file comes in on a push: room for a few thousand rows
const MAX_FILE_BYTES = 1_000_000

let store: LabelStore | null = null
function getStore(): LabelStore {
  store ??= new LabelStore(createPrivateBackend('asset-labels.tsv', 'text/tab-separated-values; charset=utf-8'))
  return store
}
export function setLabelStoreForTests(s: LabelStore): void {
  store = s
}

const takeWriteToken = tokenTaker(WRITES_PER_MINUTE, WRITES_PER_MINUTE / 60_000)

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

async function handle(req: IncomingMessage, res: ServerResponse, parts: string[]): Promise<void> {
  const expected = process.env.LABELS_WRITE_KEY || process.env.PROMPT_WRITE_KEY
  if (!expected) {
    sendError(res, 503, 'not_set_up', "The labels tool isn't set up on this server yet.")
    return
  }
  if (!codeMatches(header(req, 'x-prompt-code'), expected)) {
    sendError(res, 401, 'wrong_code', "That code isn't right.")
    return
  }
  const method = req.method ?? 'GET'
  const [what, id] = parts
  const s = getStore()

  if (method === 'GET' && what === undefined) {
    sendJson(res, 200, await s.snapshot())
    return
  }
  if (method === 'GET' && what === 'file' && id === undefined) {
    const { text, version } = await s.file()
    sendJson(res, 200, { text, version })
    return
  }

  const author = authorOf(req)
  if (!author) {
    sendError(res, 400, 'no_name', 'Tell us your name first.')
    return
  }
  if (!takeWriteToken(req)) {
    sendError(res, 429, 'slow_down', "You're going a bit fast — wait a minute and try again.")
    return
  }
  if (!underDailyCap(author)) {
    sendError(res, 429, 'daily_cap', `That's ${WRITES_PER_PERSON_PER_DAY} saves today — the rest can wait for tomorrow.`)
    return
  }

  if (method === 'PATCH' && what === 'rows' && id) {
    const body = parse(EditSchema, await readJson(req))
    const row = await s.editRow(decodeURIComponent(id), body.category, body, author, body.seen)
    sendJson(res, 200, { row })
    return
  }
  if (method === 'PUT' && what === 'file' && id === undefined) {
    const body = parse(FileSchema, await readJson(req, MAX_FILE_BYTES))
    sendJson(res, 200, await s.replaceFile(body.text, body.base))
    return
  }
  sendError(res, 404, 'not_found', 'not found')
}

export function handleLabelsRequest(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  const parts = url.pathname.split('/').filter(Boolean) // ['api', 'labels', what?, id?]
  if (parts[0] !== 'api' || parts[1] !== 'labels') return false
  const rest = parts.slice(2)
  if (rest.length > 2) {
    sendError(res, 404, 'not_found', 'not found')
    return true
  }
  handle(req, res, rest).catch((err: unknown) => {
    if (err instanceof PromptError) {
      sendError(res, err.status, err.code, err.message)
      return
    }
    console.error('[labels] unhandled error:', err instanceof Error ? err.message : err)
    sendError(res, 500, 'internal', 'Something went wrong. Try again.')
  })
  return true
}
