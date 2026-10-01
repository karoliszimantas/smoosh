// HTTP surface for image search, the shared cut library, and reports.
// Everything here lives under /api/ — http.ts hands those paths over before
// its own /submissions routing.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  MAX_PAGE,
  MAX_QUERY_LENGTH,
  getImage,
  getKnownHit,
  normalizeQuery,
  recordSeen,
  rememberHits,
  search,
  sessionHasSeen,
  type ImageSize,
} from './pixabay.ts'
import { CutRejected, LOCAL_CUTS_DIR, lookupCut, storeCut, type CutUrls } from './cutStore.ts'
import { MAX_REASON_LENGTH, appendReport, isBlocked } from './moderation.ts'
import { TokenBucket } from './tokenBucket.ts'

const MAX_CUT_BYTES = 1_000_000
const MAX_REPORT_BYTES = 2_000
const MAX_LOOKUP_IDS = 100

// shared with http.ts's withCors — see the comment there
function withCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id')
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return
  withCors(res)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

// every error body has the same shape so the client can show `message` as-is
function sendError(res: ServerResponse, status: number, error: string, message: string, headers?: Record<string, string>): void {
  sendJson(res, status, { error, message }, headers)
}

function parseId(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,12}$/.test(raw)) return null
  const id = Number(raw)
  return id > 0 ? id : null
}

function sessionIdOf(req: IncomingMessage): string | null {
  const value = req.headers['x-session-id']
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : null
}

type BodyResult = { ok: true; body: Buffer } | { ok: false; reason: 'too_large' | 'error' }

function readBody(req: IncomingMessage, maxBytes: number): Promise<BodyResult> {
  return new Promise((resolve) => {
    if (Number(req.headers['content-length'] ?? 0) > maxBytes) {
      resolve({ ok: false, reason: 'too_large' })
      req.resume()
      return
    }
    const chunks: Buffer[] = []
    let total = 0
    let done = false
    req.on('data', (chunk: Buffer) => {
      if (done) return
      total += chunk.length
      if (total > maxBytes) {
        done = true
        resolve({ ok: false, reason: 'too_large' })
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (done) return
      done = true
      resolve({ ok: true, body: Buffer.concat(chunks) })
    })
    req.on('error', () => {
      if (done) return
      done = true
      resolve({ ok: false, reason: 'error' })
    })
  })
}

// ---------- GET /api/search

export type SearchHitDto = {
  id: number
  w: number
  h: number
  tags: string
  thumb: string
  full: string
  cut: CutUrls | null
}

export type SearchResponseDto = {
  query: string
  page: number
  totalHits: number
  stale: boolean
  hits: SearchHitDto[]
}

async function handleSearch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const rawQuery = url.searchParams.get('q') ?? ''
  const query = normalizeQuery(rawQuery)
  if (!query) {
    sendError(res, 400, 'bad_request', 'Type something to search for.')
    return
  }
  if (rawQuery.trim().length > MAX_QUERY_LENGTH) {
    sendError(res, 400, 'bad_request', `Search terms can be at most ${MAX_QUERY_LENGTH} characters.`)
    return
  }
  const page = Number(url.searchParams.get('page') ?? '1')
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    sendError(res, 400, 'bad_request', `page must be between 1 and ${MAX_PAGE}`)
    return
  }

  const outcome = await search(query, page)
  switch (outcome.kind) {
    case 'rate_limited': {
      const seconds = Math.max(1, Math.ceil(outcome.retryAfterMs / 1000))
      sendError(res, 503, 'rate_limited', 'Image search is busy right now — try again in a few seconds.', {
        'Retry-After': String(seconds),
      })
      return
    }
    case 'not_configured':
      sendError(res, 503, 'not_configured', "Image search isn't set up on this server.")
      return
    case 'upstream_error':
      sendError(res, 502, 'upstream_error', "Couldn't reach the image library. Try again.")
      return
    case 'ok':
      break
  }

  // blocklist is applied at response time, not cache time, so blocking an id
  // takes effect on the very next search even for cached queries
  const visible = outcome.response.hits.filter((h) => !isBlocked(h.id))
  rememberHits(visible)
  const sessionId = sessionIdOf(req)
  if (sessionId) recordSeen(sessionId, visible.map((h) => h.id))

  const body: SearchResponseDto = {
    query,
    page,
    totalHits: outcome.response.totalHits,
    stale: outcome.stale,
    hits: visible.map((h) => ({
      id: h.id,
      w: h.webformatWidth,
      h: h.webformatHeight,
      tags: h.tags,
      thumb: `/api/image/${h.id}?size=thumb`,
      full: `/api/image/${h.id}`,
      cut: lookupCut(h.id),
    })),
  }
  sendJson(res, 200, body)
}

// ---------- GET /api/image/:id

async function handleImage(res: ServerResponse, url: URL, rawId: string | undefined): Promise<void> {
  const id = parseId(rawId)
  if (id === null) {
    sendError(res, 400, 'bad_request', 'invalid image id')
    return
  }
  if (isBlocked(id)) {
    sendError(res, 404, 'not_found', 'This image is no longer available.')
    return
  }
  const hit = getKnownHit(id)
  if (!hit) {
    // ids are only resolvable after a search returned them (we need the
    // source URL Pixabay gave us) — after a server restart the client just
    // has to search again
    sendError(res, 404, 'not_found', 'Image expired — search again.')
    return
  }
  const size: ImageSize = url.searchParams.get('size') === 'thumb' ? 'thumb' : 'full'

  let image
  try {
    image = await getImage(hit, size)
  } catch (err) {
    console.error(`[pixabay] image ${id} (${size}) failed:`, err instanceof Error ? err.message : err)
    sendError(res, 502, 'upstream_error', "Couldn't load this image.")
    return
  }
  if (res.headersSent) return
  withCors(res)
  res.writeHead(200, {
    'Content-Type': image.contentType,
    'Content-Length': image.bytes.length,
    'Cache-Control': 'public, max-age=86400',
    // the client draws these into a canvas and exports it — CORS (above) is
    // what keeps that canvas untainted; CORP lets them load under COEP too
    'Cross-Origin-Resource-Policy': 'cross-origin',
  })
  res.end(image.bytes)
}

// ---------- GET /api/cuts?ids=…

function handleCutLookup(res: ServerResponse, url: URL): void {
  const raw = url.searchParams.get('ids') ?? ''
  const ids = raw
    .split(',')
    .map((s) => parseId(s.trim()))
    .filter((id): id is number => id !== null)
  if (ids.length > MAX_LOOKUP_IDS) {
    sendError(res, 400, 'bad_request', `at most ${MAX_LOOKUP_IDS} ids per lookup`)
    return
  }
  const cuts: Record<string, CutUrls> = {}
  for (const id of ids) {
    if (isBlocked(id)) continue
    const urls = lookupCut(id)
    if (urls) cuts[String(id)] = urls
  }
  sendJson(res, 200, { cuts })
}

// ---------- POST /api/cuts/:id

async function handleCutUpload(req: IncomingMessage, res: ServerResponse, rawId: string | undefined): Promise<void> {
  const id = parseId(rawId)
  if (id === null) {
    sendError(res, 400, 'bad_request', 'invalid image id')
    req.resume()
    return
  }
  if (req.headers['content-type'] !== 'image/webp') {
    sendError(res, 415, 'unsupported_media_type', 'expected Content-Type: image/webp')
    req.resume()
    return
  }
  const sessionId = sessionIdOf(req)
  if (!sessionId || !sessionHasSeen(sessionId, id)) {
    sendError(res, 403, 'forbidden', 'This image did not come from one of your searches.')
    req.resume()
    return
  }
  if (isBlocked(id)) {
    sendError(res, 410, 'blocked', 'This image has been removed.')
    req.resume()
    return
  }

  const body = await readBody(req, MAX_CUT_BYTES)
  if (!body.ok) {
    if (body.reason === 'too_large') sendError(res, 413, 'too_large', 'Cut is too large (max 1MB).')
    else sendError(res, 400, 'bad_request', 'upload failed')
    return
  }

  const hit = getKnownHit(id)
  if (!hit) {
    sendError(res, 409, 'expired', 'Search results expired — search again.')
    return
  }

  try {
    const { urls, created } = await storeCut(id, body.body, async () => (await getImage(hit, 'full')).bytes)
    sendJson(res, created ? 201 : 200, { id, created, ...urls })
  } catch (err) {
    if (err instanceof CutRejected) {
      sendError(res, 422, 'rejected', err.message)
      return
    }
    console.error(`[cuts] storing ${id} failed:`, err)
    sendError(res, 500, 'internal', 'Could not store the cut.')
  }
}

// ---------- GET /api/cut-files/:name (local dev backend only)

async function handleLocalCutFile(res: ServerResponse, name: string | undefined): Promise<void> {
  const match = /^(\d{1,12})(-thumb)?\.webp$/.exec(name ?? '')
  const id = parseId(match?.[1])
  if (!match || id === null || isBlocked(id)) {
    sendError(res, 404, 'not_found', 'not found')
    return
  }
  let bytes: Buffer
  try {
    bytes = await readFile(path.join(LOCAL_CUTS_DIR, match[0]))
  } catch {
    sendError(res, 404, 'not_found', 'not found')
    return
  }
  if (res.headersSent) return
  withCors(res)
  res.writeHead(200, {
    'Content-Type': 'image/webp',
    'Content-Length': bytes.length,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  })
  res.end(bytes)
}

// ---------- POST /api/report

// no auth on reports, so each client gets a small allowance; the reports
// file also has a hard size cap (moderation.ts) as the real backstop
const REPORTS_PER_MINUTE = 10
const MAX_REPORTERS_TRACKED = 10_000
const reportBuckets = new Map<string, TokenBucket>()

function reporterKey(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined
  return first || req.socket.remoteAddress || 'unknown'
}

function takeReportToken(key: string): boolean {
  let bucket = reportBuckets.get(key)
  if (!bucket) {
    if (reportBuckets.size >= MAX_REPORTERS_TRACKED) reportBuckets.clear()
    bucket = new TokenBucket(REPORTS_PER_MINUTE, REPORTS_PER_MINUTE / 60_000)
    reportBuckets.set(key, bucket)
  }
  return bucket.tryTake()
}

function isReportBody(value: unknown): value is { pixabayId: number; reason: string } {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.pixabayId === 'number' &&
    Number.isSafeInteger(v.pixabayId) &&
    v.pixabayId > 0 &&
    typeof v.reason === 'string' &&
    v.reason.trim().length > 0 &&
    v.reason.length <= MAX_REASON_LENGTH
  )
}

async function handleReport(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!takeReportToken(reporterKey(req))) {
    sendError(res, 429, 'rate_limited', 'Too many reports — try again in a minute.')
    req.resume()
    return
  }
  const body = await readBody(req, MAX_REPORT_BYTES)
  if (!body.ok) {
    sendError(res, 400, 'bad_request', 'invalid report')
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body.body.toString('utf8'))
  } catch {
    parsed = null
  }
  if (!isReportBody(parsed)) {
    sendError(res, 400, 'bad_request', `a report needs a pixabayId and a reason (max ${MAX_REASON_LENGTH} chars)`)
    return
  }
  const outcome = await appendReport(parsed.pixabayId, parsed.reason.trim())
  if (outcome === 'full') {
    sendError(res, 503, 'unavailable', 'Reports are temporarily unavailable.')
    return
  }
  sendJson(res, 202, { ok: true })
}

// ---------- dispatch

// returns true when the path belonged to us (handled, or answered with an
// error) so http.ts can stop routing
export function handleMediaRequest(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  if (!url.pathname.startsWith('/api/')) return false
  const parts = url.pathname.split('/').slice(2) // ['search'] | ['image', id] | …
  const [route, param, extra] = parts
  const method = req.method ?? 'GET'

  const run = (task: Promise<void>) =>
    task.catch((err: unknown) => {
      console.error('[api] unhandled error', err)
      sendError(res, 500, 'internal', 'Something went wrong.')
    })

  if (extra !== undefined) {
    sendError(res, 404, 'not_found', 'not found')
  } else if (route === 'search' && param === undefined && method === 'GET') {
    void run(handleSearch(req, res, url))
  } else if (route === 'image' && param !== undefined && method === 'GET') {
    void run(handleImage(res, url, param))
  } else if (route === 'cuts' && param === undefined && method === 'GET') {
    handleCutLookup(res, url)
  } else if (route === 'cuts' && param !== undefined && method === 'POST') {
    void run(handleCutUpload(req, res, param))
  } else if (route === 'cut-files' && param !== undefined && method === 'GET') {
    void run(handleLocalCutFile(res, param))
  } else if (route === 'report' && param === undefined && method === 'POST') {
    void run(handleReport(req, res))
  } else {
    sendError(res, 404, 'not_found', 'not found')
  }
  return true
}
