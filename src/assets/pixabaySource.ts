import type { Asset, AssetSource, Category, ImageVariant, PixabayHit, SearchPage } from './types'
import { getSessionId } from '../game/session'
import { labelFromTags } from './search'

// The second AssetSource: Pixabay search, proxied through our server (which
// holds the API key, caches, rate-limits, and filters the blocklist). There
// are no fixed categories here — a "category" is just a search term, so
// browse('goat') is a search for goat.

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

// the server hands back paths like /api/image/123 (and absolute R2 URLs for
// stored cuts) — both resolve correctly against the server's origin
export function resolveServerUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl, SERVER_URL).toString()
}

// a failed request with a message the server wrote for players to read
export class SearchError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function isVariant(value: unknown): value is ImageVariant {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.full === 'string' && typeof v.thumb === 'string'
}

function isHit(value: unknown): value is PixabayHit {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'number' &&
    typeof v.w === 'number' &&
    typeof v.h === 'number' &&
    typeof v.tags === 'string' &&
    typeof v.thumb === 'string' &&
    typeof v.full === 'string' &&
    (v.cut === null || isVariant(v.cut))
  )
}

function isSearchPage(value: unknown): value is SearchPage {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.query === 'string' &&
    typeof v.page === 'number' &&
    typeof v.totalHits === 'number' &&
    Array.isArray(v.hits) &&
    v.hits.every(isHit)
  )
}

function resolveVariant(v: ImageVariant): ImageVariant {
  return { full: resolveServerUrl(v.full), thumb: resolveServerUrl(v.thumb) }
}

async function errorFrom(res: Response): Promise<SearchError> {
  try {
    const body: unknown = await res.json()
    if (typeof body === 'object' && body !== null) {
      const { error, message } = body as Record<string, unknown>
      if (typeof error === 'string' && typeof message === 'string') return new SearchError(error, message)
    }
  } catch {
    // not JSON — fall through
  }
  // every /api/* error from our server is JSON — a bare 404 means the game
  // server predates image search (deployed client, un-updated server)
  if (res.status === 404) return new SearchError('unavailable', "Image search isn't available on this server yet.")
  return new SearchError('http_error', `Request failed (${res.status}).`)
}

export class PixabayAssetSource implements AssetSource {
  readonly id = 'pixabay'

  async listCategories(): Promise<Category[]> {
    return []
  }

  async browse(categoryId: string): Promise<Asset[]> {
    const page = await this.search(categoryId, 1)
    return page.hits.map((hit) => {
      const image = hit.cut ?? { full: hit.full, thumb: hit.thumb }
      return {
        id: `pixabay-${hit.id}`,
        category: categoryId,
        full: image.full,
        thumb: image.thumb,
        w: hit.w,
        h: hit.h,
        label: labelFromTags(hit.tags),
      }
    })
  }

  async search(query: string, page: number, signal?: AbortSignal): Promise<SearchPage> {
    const params = new URLSearchParams({ q: query, page: String(page) })
    let res: Response
    try {
      res = await fetch(`${SERVER_URL}/api/search?${params.toString()}`, {
        headers: { 'X-Session-Id': getSessionId() },
        signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      throw new SearchError('network', "Couldn't reach the server. Check your connection.")
    }
    if (!res.ok) throw await errorFrom(res)
    const json: unknown = await res.json()
    if (!isSearchPage(json)) throw new SearchError('bad_response', 'Search returned something unexpected.')
    return {
      ...json,
      hits: json.hits.map((h) => ({
        ...h,
        thumb: resolveServerUrl(h.thumb),
        full: resolveServerUrl(h.full),
        cut: h.cut ? resolveVariant(h.cut) : null,
      })),
    }
  }

  // which of these ids have a shared cut now — used to refresh results the
  // client already has, since another player may have cut one since
  async lookupCuts(ids: readonly number[]): Promise<Map<number, ImageVariant>> {
    const found = new Map<number, ImageVariant>()
    if (ids.length === 0) return found
    const res = await fetch(`${SERVER_URL}/api/cuts?ids=${ids.join(',')}`)
    if (!res.ok) throw await errorFrom(res)
    const json: unknown = await res.json()
    const cuts = typeof json === 'object' && json !== null ? (json as Record<string, unknown>).cuts : null
    if (typeof cuts !== 'object' || cuts === null) return found
    for (const [key, value] of Object.entries(cuts)) {
      const id = Number(key)
      if (Number.isSafeInteger(id) && isVariant(value)) found.set(id, resolveVariant(value))
    }
    return found
  }

  async uploadCut(pixabayId: number, webp: Blob): Promise<ImageVariant> {
    const res = await fetch(`${SERVER_URL}/api/cuts/${pixabayId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/webp', 'X-Session-Id': getSessionId() },
      body: webp,
    })
    if (!res.ok) throw await errorFrom(res)
    const json: unknown = await res.json()
    if (!isVariant(json)) throw new SearchError('bad_response', 'Upload returned something unexpected.')
    return resolveVariant(json)
  }

  async report(pixabayId: number, reason: string): Promise<void> {
    const res = await fetch(`${SERVER_URL}/api/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pixabayId, reason }),
    })
    if (!res.ok) throw await errorFrom(res)
  }
}

// one instance for the page — the search sheet, the canvas's report control,
// and background uploads all share it
export const pixabaySource = new PixabayAssetSource()
