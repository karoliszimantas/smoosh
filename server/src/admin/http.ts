// The plumbing every admin route shares: JSON in and out, plain-language
// errors, and the per-key rate limit. Moved here from prompts/routes.ts,
// which /api/labels used to borrow it from.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { z } from 'zod'
import { TokenBucket } from '../media/tokenBucket.ts'
import { PromptError } from '../prompts/store.ts'

const MAX_BODY_BYTES = 128_000
const MAX_KEYS_TRACKED = 10_000

// No CORS headers: the admin pages reach this server through the page's own
// origin (the Worker in production, Vite's proxy in dev), so a browser on
// any other origin gets nothing it can read.
export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

export function sendError(res: ServerResponse, status: number, error: string, message: string): void {
  sendJson(res, status, { error, message })
}

export function redirect(res: ServerResponse, location: string, cookies: string[] = []): void {
  if (res.headersSent) return
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...(cookies.length > 0 ? { 'Set-Cookie': cookies } : {}) })
  res.end()
}

export function header(req: IncomingMessage, name: string): string {
  const v = req.headers[name]
  return typeof v === 'string' ? v : ''
}

// constant-time comparison of a secret (hashed first, so lengths match)
export function secretMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

// The Worker (and Vite's proxy) put the phone's address first. A request
// straight to the game server can claim any address here — which is why
// nothing that matters is limited by address alone.
export function clientIp(req: IncomingMessage): string {
  const forwarded = header(req, 'x-forwarded-for').split(',')[0]?.trim()
  return forwarded || req.socket.remoteAddress || 'unknown'
}

// One token bucket per key — an account, an address, or one shared key for
// everyone. True when the caller may go ahead.
export function tokenTaker(capacity: number, refillPerMs: number): (key: string) => boolean {
  const buckets = new Map<string, TokenBucket>()
  return (key) => {
    let bucket = buckets.get(key)
    if (!bucket) {
      if (buckets.size >= MAX_KEYS_TRACKED) buckets.clear()
      bucket = new TokenBucket(capacity, refillPerMs)
      buckets.set(key, bucket)
    }
    return bucket.tryTake()
  }
}

export function readJson(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
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
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new PromptError(400, 'invalid', result.error.issues[0]?.message ?? "That doesn't look right.")
}

// A route's work, with its refusals answered as plain sentences and anything
// else logged (the error only — never headers, which carry cookies and keys)
export function answer(res: ServerResponse, tag: string, work: Promise<void>): void {
  work.catch((err: unknown) => {
    if (err instanceof PromptError) {
      sendError(res, err.status, err.code, err.message)
      return
    }
    console.error(`[${tag}] unhandled error:`, err instanceof Error ? err.message : err)
    sendError(res, 500, 'internal', 'Something went wrong. Try again.')
  })
}
