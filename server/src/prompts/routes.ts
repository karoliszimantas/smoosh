// /api/admin/prompts — the team's shared prompt pool, for whoever is signed
// in to /admin (admin/routes.ts checks the session before anything here).
// Every edit is credited to the signed-in account.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { MAX_IMPORT_ROWS, MAX_PROMPT_AUTHOR_LENGTH } from '@smoosh/protocol'
import { parse, readJson, sendError, sendJson, tokenTaker } from '../admin/http.ts'
import type { Actor } from '../admin/actor.ts'
import { getPromptStore as getStore } from './shared.ts'
import { MAX_PROMPTS, normalizeText, PromptModeSchema, PromptTextSchema } from './store.ts'

const WRITES_PER_MINUTE = 30
// imports have their own allowance: a few in a row (fix a file, try again),
// then one every couple of minutes — and they don't use up single writes
const IMPORT_BURST = 5
const IMPORT_REFILL_MS = 2 * 60_000

export { setPromptStoreForTests } from './shared.ts'

// per account: an address means little when everyone is signed in
const takeWriteToken = tokenTaker(WRITES_PER_MINUTE, WRITES_PER_MINUTE / 60_000)
const takeImportToken = tokenTaker(IMPORT_BURST, 1 / IMPORT_REFILL_MS)

const CreateSchema = z.object({ text: PromptTextSchema, mode: PromptModeSchema })
const EditSchema = z
  .object({ text: PromptTextSchema.optional(), mode: PromptModeSchema.optional(), archived: z.boolean().optional() })
  .refine((v) => v.text !== undefined || v.mode !== undefined || v.archived !== undefined, 'Nothing to change.')
const VoteSchema = z.object({ vote: z.union([z.literal(1), z.literal(-1)]) })
// An import credits each prompt to whoever wrote it — often someone outside
// the team, typed in a spreadsheet's author column — or to the importer. A
// typed name can't contain "@": that's how a signed-in account's credit is
// told apart (attributionOf in the protocol package).
function importSchema(actor: Actor) {
  const author = z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, ' '))
    .pipe(
      z
        .string()
        .min(1, 'Every row needs an author.')
        .refine((a) => a === actor.name || !a.includes('@'), 'Author names can’t contain @ — that marks a signed-in account.')
        .refine(
          (a) => a === actor.name || a.length <= MAX_PROMPT_AUTHOR_LENGTH,
          `Author names are at most ${MAX_PROMPT_AUTHOR_LENGTH} characters.`,
        ),
    )
  // the text is only normalised here: the store checks it against the rules,
  // row by row, so a refusal can say which row
  return z.object({
    rows: z
      .array(z.object({ text: z.string().max(1000).transform(normalizeText), mode: PromptModeSchema, author }))
      .min(1, 'Nothing to import.')
      .max(MAX_IMPORT_ROWS, `At most ${MAX_IMPORT_ROWS} prompts in one import — split it into smaller batches.`),
  })
}
const BulkSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_PROMPTS),
  action: z.enum(['archive', 'restore', 'delete']),
})

export async function handlePrompts(req: IncomingMessage, res: ServerResponse, parts: string[], actor: Actor): Promise<void> {
  if (parts.length > 2) {
    sendError(res, 404, 'not_found', 'not found')
    return
  }
  const method = req.method ?? 'GET'
  const [id, action] = parts
  const s = getStore()
  const author = actor.name

  if (method === 'GET' && id === undefined) {
    sendJson(res, 200, { prompts: await s.list() })
    return
  }

  if (method === 'POST' && id === 'import' && action === undefined) {
    if (!takeImportToken(actor.email)) {
      sendError(res, 429, 'slow_down', "That's a lot of imports at once — wait a couple of minutes and try again.")
      return
    }
    const body = parse(importSchema(actor), await readJson(req))
    const added = await s.import(body.rows)
    sendJson(res, 200, { prompts: await s.list(), added })
    return
  }
  if (!takeWriteToken(actor.email)) {
    sendError(res, 429, 'slow_down', "You're going a bit fast — wait a minute and try again.")
    return
  }

  if (method === 'POST' && id === undefined) {
    const body = parse(CreateSchema, await readJson(req))
    await s.add(body.text, body.mode, author)
  } else if (method === 'POST' && id === 'bulk' && action === undefined) {
    const body = parse(BulkSchema, await readJson(req))
    await s.bulk(body.ids, body.action)
  } else if (method === 'PATCH' && id && action === undefined) {
    await s.edit(id, parse(EditSchema, await readJson(req)))
  } else if (method === 'DELETE' && id && action === undefined) {
    await s.remove(id)
  } else if (method === 'POST' && id && action === 'built') {
    // fire and forget from the client — nothing to send back
    await s.built(id)
    if (!res.headersSent) {
      res.writeHead(204)
      res.end()
    }
    return
  } else if (method === 'POST' && id && action === 'vote') {
    await s.vote(id, author, parse(VoteSchema, await readJson(req)).vote)
  } else {
    sendError(res, 404, 'not_found', 'not found')
    return
  }
  // every change answers with the whole pool, so each phone sees everyone
  // else's edits too, without a second request
  sendJson(res, 200, { prompts: await s.list() })
}
