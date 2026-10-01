// Server-side Pixabay proxy. Pixabay forbids hotlinking and its key must
// never reach a phone, so every search and every image byte goes through
// here. Search responses are cached for 24h (Pixabay's terms require it) and
// API calls are metered by one process-wide token bucket, because the
// 100 req/min limit belongs to the key, not to any one player.

import { TokenBucket } from './tokenBucket.ts'
import { ByteLru } from './byteLru.ts'

const API_URL = 'https://pixabay.com/api/'
export const PER_PAGE = 20
// Pixabay serves at most 500 hits per query regardless of totalHits
export const MAX_PAGE = Math.ceil(500 / PER_PAGE)
export const MAX_QUERY_LENGTH = 100

const SEARCH_TTL_MS = 24 * 60 * 60 * 1000
const MAX_SEARCH_ENTRIES = 5000
const MAX_HITS_REMEMBERED = 50_000

// 60/min leaves 40/min of the key's 100 for retries, the curation tool, and
// any clock skew between our bucket and Pixabay's window
const newBucket = () => new TokenBucket(60, 60 / 60_000)
let bucket = newBucket()

const IMAGE_CACHE_BYTES = 200 * 1024 * 1024
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// ---------- response validation (same hand-written guard as tools/fetch.ts)

type PixabayHit = {
  id: number
  tags: string
  previewURL: string
  webformatURL: string
  webformatWidth: number
  webformatHeight: number
}

type PixabayResponse = {
  totalHits: number
  hits: PixabayHit[]
}

function isPixabayHit(value: unknown): value is PixabayHit {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'number' &&
    Number.isSafeInteger(v.id) &&
    typeof v.tags === 'string' &&
    typeof v.previewURL === 'string' &&
    typeof v.webformatURL === 'string' &&
    typeof v.webformatWidth === 'number' &&
    typeof v.webformatHeight === 'number'
  )
}

function isPixabayResponse(value: unknown): value is PixabayResponse {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.totalHits === 'number' && Array.isArray(v.hits) && v.hits.every(isPixabayHit)
}

function isPixabayHost(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  return url.protocol === 'https:' && (url.hostname === 'pixabay.com' || url.hostname.endsWith('.pixabay.com'))
}

// ---------- search

type CachedSearch = { fetchedAt: number; response: PixabayResponse }

const searchCache = new Map<string, CachedSearch>()
const inFlightSearches = new Map<string, Promise<PixabayResponse>>()

export type SearchOutcome =
  | { kind: 'ok'; response: PixabayResponse; stale: boolean }
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'upstream_error'; message: string }
  | { kind: 'not_configured' }

export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH)
}

function cacheKey(query: string, page: number): string {
  return `${page}:${query}`
}

function rememberSearch(key: string, response: PixabayResponse): void {
  searchCache.delete(key)
  searchCache.set(key, { fetchedAt: Date.now(), response })
  while (searchCache.size > MAX_SEARCH_ENTRIES) {
    const oldest = searchCache.keys().next()
    if (oldest.done) break
    searchCache.delete(oldest.value)
  }
}

class RateLimitedError extends Error {}

async function fetchFromPixabay(apiKey: string, query: string, page: number): Promise<PixabayResponse> {
  const params = new URLSearchParams({
    key: apiKey,
    q: query,
    image_type: 'photo',
    safesearch: 'true',
    per_page: String(PER_PAGE),
    page: String(page),
  })
  const res = await fetch(`${API_URL}?${params.toString()}`, { signal: AbortSignal.timeout(8000) })
  if (res.status === 429) throw new RateLimitedError('pixabay returned 429')
  if (!res.ok) throw new Error(`pixabay returned ${res.status}`)
  const json: unknown = await res.json()
  if (!isPixabayResponse(json)) throw new Error('unexpected response shape from pixabay')
  return json
}

export async function search(query: string, page: number): Promise<SearchOutcome> {
  const key = cacheKey(query, page)
  const cached = searchCache.get(key)
  if (cached && Date.now() - cached.fetchedAt < SEARCH_TTL_MS) {
    return { kind: 'ok', response: cached.response, stale: false }
  }

  const apiKey = process.env.PIXABAY_KEY
  if (!apiKey) return { kind: 'not_configured' }

  // identical searches already on their way to Pixabay share one request
  // (and one token) — four players opening the same prompt tab at once is
  // the common case, not the exception
  const fallback = (outcome: Exclude<SearchOutcome, { kind: 'ok' }>): SearchOutcome =>
    cached ? { kind: 'ok', response: cached.response, stale: true } : outcome

  const inFlight = inFlightSearches.get(key)
  if (inFlight) {
    try {
      return { kind: 'ok', response: await inFlight, stale: false }
    } catch {
      // the request we piggybacked on already logged its failure
      return fallback({ kind: 'upstream_error', message: 'shared request failed' })
    }
  }

  if (!bucket.tryTake()) {
    return fallback({ kind: 'rate_limited', retryAfterMs: bucket.msUntilNext() })
  }

  const request = fetchFromPixabay(apiKey, query, page)
  inFlightSearches.set(key, request)
  try {
    const response = await request
    rememberSearch(key, response)
    return { kind: 'ok', response, stale: false }
  } catch (err) {
    if (err instanceof RateLimitedError) return fallback({ kind: 'rate_limited', retryAfterMs: 60_000 })
    const message = err instanceof Error ? err.message : String(err)
    console.error('[pixabay] search failed:', message)
    return fallback({ kind: 'upstream_error', message })
  } finally {
    inFlightSearches.delete(key)
  }
}

// ---------- hits we've served, so /api/image can find their source URLs

export type KnownHit = {
  id: number
  tags: string
  previewURL: string
  webformatURL: string
  width: number
  height: number
}

const knownHits = new Map<number, KnownHit>()

export function rememberHits(hits: readonly PixabayHit[]): void {
  for (const h of hits) {
    knownHits.delete(h.id)
    knownHits.set(h.id, {
      id: h.id,
      tags: h.tags,
      previewURL: h.previewURL,
      webformatURL: h.webformatURL,
      width: h.webformatWidth,
      height: h.webformatHeight,
    })
  }
  while (knownHits.size > MAX_HITS_REMEMBERED) {
    const oldest = knownHits.keys().next()
    if (oldest.done) break
    knownHits.delete(oldest.value)
  }
}

export function getKnownHit(id: number): KnownHit | undefined {
  return knownHits.get(id)
}

// ---------- which ids each player session has actually been shown
//
// POST /api/cuts only accepts ids that the uploading session received from a
// real search. That keeps the shared library keyed to genuine Pixabay ids and
// stops a client from squatting arbitrary ids it was never shown.

const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const MAX_SESSIONS = 10_000
const MAX_IDS_PER_SESSION = 5_000

type SessionSeen = { ids: Set<number>; touchedAt: number }
const seenBySession = new Map<string, SessionSeen>()

export function recordSeen(sessionId: string, ids: readonly number[]): void {
  let entry = seenBySession.get(sessionId)
  if (!entry) {
    entry = { ids: new Set(), touchedAt: 0 }
  }
  seenBySession.delete(sessionId)
  seenBySession.set(sessionId, entry)
  entry.touchedAt = Date.now()
  for (const id of ids) {
    if (entry.ids.size >= MAX_IDS_PER_SESSION) break
    entry.ids.add(id)
  }
  while (seenBySession.size > MAX_SESSIONS) {
    const oldest = seenBySession.keys().next()
    if (oldest.done) break
    seenBySession.delete(oldest.value)
  }
}

export function sessionHasSeen(sessionId: string, id: number): boolean {
  const entry = seenBySession.get(sessionId)
  if (!entry || Date.now() - entry.touchedAt > SESSION_TTL_MS) return false
  return entry.ids.has(id)
}

// ---------- image bytes

export type ImageSize = 'thumb' | 'full'
export type CachedImage = { bytes: Buffer; contentType: string }

const imageCache = new ByteLru<CachedImage>(IMAGE_CACHE_BYTES)
const inFlightImages = new Map<string, Promise<CachedImage>>()

// Pixabay documents swapping the "_640" suffix of a webformatURL for "_340"
// (or _180/_960) to get other sizes. previewURL (150px) is too soft for a
// result card on a 3x phone screen; 340px is the smallest that isn't.
function sourceUrlFor(hit: KnownHit, size: ImageSize): string {
  if (size === 'full') return hit.webformatURL
  return /_640\.(jpe?g|png)$/i.test(hit.webformatURL) ? hit.webformatURL.replace(/_640\./, '_340.') : hit.previewURL
}

async function readBounded(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_IMAGE_BYTES) throw new Error(`image too large: ${declared} bytes`)
  const reader = res.body?.getReader()
  if (!reader) throw new Error('response has no body')
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel()
      throw new Error('image exceeded size cap while downloading')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

async function downloadImage(url: string): Promise<CachedImage> {
  if (!isPixabayHost(url)) throw new Error(`refusing to fetch non-Pixabay URL: ${url}`)
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`image fetch failed: HTTP ${res.status}`)
  const contentType = res.headers.get('content-type') ?? ''
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) throw new Error(`unexpected content-type "${contentType}"`)
  return { bytes: await readBounded(res), contentType }
}

export async function getImage(hit: KnownHit, size: ImageSize): Promise<CachedImage> {
  const key = `${hit.id}:${size}`
  const cached = imageCache.get(key)
  if (cached) return cached

  let pending = inFlightImages.get(key)
  if (!pending) {
    pending = downloadImage(sourceUrlFor(hit, size))
    inFlightImages.set(key, pending)
    pending.then(
      (img) => imageCache.set(key, img),
      () => {},
    )
    pending.finally(() => inFlightImages.delete(key)).catch(() => {})
  }
  return pending
}

// test-only: reset module state between cases
export function _resetForTests(): void {
  bucket = newBucket()
  searchCache.clear()
  inFlightSearches.clear()
  knownHits.clear()
  seenBySession.clear()
}
