// /api/prompts — the team's shared prompt pool.
//
// ACCESS: one shared code (PROMPT_WRITE_KEY), sent as x-prompt-code, plus a
// self-chosen display name in x-prompt-author. That is a shared password for
// three people who trust each other, not an auth system — deliberately. If
// this is ever opened beyond the team it needs real accounts and auth.
// The code is never logged.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { MAX_IMPORT_ROWS } from '@smoosh/protocol'
import { TokenBucket } from '../media/tokenBucket.ts'
import { getPromptStore as getStore } from './shared.ts'
import {
  MAX_AUTHOR_LENGTH,
  MAX_PROMPTS,
  PromptError,
  normalizeText,
  PromptModeSchema,
  PromptTextSchema,
} from './store.ts'

const MAX_BODY_BYTES = 128_000
const WRITES_PER_MINUTE = 30
// imports have their own allowance: a few in a row (fix a file, try again),
// then one every couple of minutes — and they don't use up single writes
const IMPORT_BURST = 5
const IMPORT_REFILL_MS = 2 * 60_000
const MAX_WRITERS_TRACKED = 10_000

export { setPromptStoreForTests } from './shared.ts'

export const PROMPT_CORS_HEADERS = 'X-Prompt-Code, X-Prompt-Author'

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function sendError(res: ServerResponse, status: number, error: string, message: string): void {
  sendJson(res, status, { error, message })
}

// constant-time comparison of the shared code (hashed first, so lengths match)
function codeMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

function header(req: IncomingMessage, name: string): string {
  const v = req.headers[name]
  return typeof v === 'string' ? v : ''
}

// names travel URI-encoded, so "Karolis Bilčius" survives an HTTP header
function authorOf(req: IncomingMessage): string | null {
  let name: string
  try {
    name = decodeURIComponent(header(req, 'x-prompt-author'))
  } catch {
    return null
  }
  name = name.trim().replace(/\s+/g, ' ')
  return name.length >= 1 && name.length <= MAX_AUTHOR_LENGTH ? name : null
}

function clientKey(req: IncomingMessage): string {
  const forwarded = header(req, 'x-forwarded-for').split(',')[0]?.trim()
  return forwarded || req.socket.remoteAddress || 'unknown'
}
function tokenTaker(capacity: number, refillPerMs: number) {
  const buckets = new Map<string, TokenBucket>()
  return (req: IncomingMessage): boolean => {
    const key = clientKey(req)
    let bucket = buckets.get(key)
    if (!bucket) {
      if (buckets.size >= MAX_WRITERS_TRACKED) buckets.clear()
      bucket = new TokenBucket(capacity, refillPerMs)
      buckets.set(key, bucket)
    }
    return bucket.tryTake()
  }
}
const takeWriteToken = tokenTaker(WRITES_PER_MINUTE, WRITES_PER_MINUTE / 60_000)
const takeImportToken = tokenTaker(IMPORT_BURST, 1 / IMPORT_REFILL_MS)

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        reject(new PromptError(413, 'too_large', 'That request is too big.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new PromptError(400, 'bad_request', "That request didn't make sense."))
      }
    })
    req.on('error', () => reject(new PromptError(400, 'bad_request', 'The request was cut off.')))
  })
}

// a zod failure as one plain sentence — the first issue's own message
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new PromptError(400, 'invalid', result.error.issues[0]?.message ?? "That doesn't look right.")
}

const CreateSchema = z.object({ text: PromptTextSchema, mode: PromptModeSchema })
const EditSchema = z
  .object({ text: PromptTextSchema.optional(), mode: PromptModeSchema.optional(), archived: z.boolean().optional() })
  .refine((v) => v.text !== undefined || v.mode !== undefined || v.archived !== undefined, 'Nothing to change.')
const VoteSchema = z.object({ vote: z.union([z.literal(1), z.literal(-1)]) })
const AuthorSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1, 'Every row needs an author.').max(MAX_AUTHOR_LENGTH, `Author names are at most ${MAX_AUTHOR_LENGTH} characters.`))
// the text is only normalised here: the store checks it against the rules,
// row by row, so a refusal can say which row
const ImportSchema = z.object({
  rows: z
    .array(z.object({ text: z.string().max(1000).transform(normalizeText), mode: PromptModeSchema, author: AuthorSchema }))
    .min(1, 'Nothing to import.')
    .max(MAX_IMPORT_ROWS, `At most ${MAX_IMPORT_ROWS} prompts in one import — split it into smaller batches.`),
})
const BulkSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_PROMPTS),
  action: z.enum(['archive', 'restore', 'delete']),
})

async function handle(req: IncomingMessage, res: ServerResponse, parts: string[]): Promise<void> {
  const expected = process.env.PROMPT_WRITE_KEY
  if (!expected) {
    sendError(res, 503, 'not_set_up', "The prompt list isn't set up on this server yet.")
    return
  }
  // every route, reads included, needs the code
  if (!codeMatches(header(req, 'x-prompt-code'), expected)) {
    sendError(res, 401, 'wrong_code', "That code isn't right.")
    return
  }

  const method = req.method ?? 'GET'
  const [id, action] = parts
  const s = getStore()

  if (method === 'GET' && id === undefined) {
    sendJson(res, 200, { prompts: await s.list() })
    return
  }

  const author = authorOf(req)
  if (!author) {
    sendError(res, 400, 'no_name', 'Tell us your name first.')
    return
  }
  if (method === 'POST' && id === 'import' && action === undefined) {
    if (!takeImportToken(req)) {
      sendError(res, 429, 'slow_down', "That's a lot of imports at once — wait a couple of minutes and try again.")
      return
    }
    const body = parse(ImportSchema, await readJson(req))
    const added = await s.import(body.rows)
    sendJson(res, 200, { prompts: await s.list(), added })
    return
  }
  if (!takeWriteToken(req)) {
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
      res.setHeader('Access-Control-Allow-Origin', '*')
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

// true when the path was ours (answered, one way or another)
export function handlePromptsRequest(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  const parts = url.pathname.split('/').filter(Boolean) // ['api', 'prompts', id?, action?]
  if (parts[0] !== 'api' || parts[1] !== 'prompts') return false
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
    // logs the error only — never the request headers, which carry the code
    console.error('[prompts] unhandled error:', err instanceof Error ? err.message : err)
    sendError(res, 500, 'internal', 'Something went wrong. Try again.')
  })
  return true
}
