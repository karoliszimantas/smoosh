import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

// moderation.ts and cutStore.ts read MEDIA_DATA_DIR at import time
const dataDir = await mkdtemp(path.join(tmpdir(), 'smoosh-media-'))
process.env.MEDIA_DATA_DIR = dataDir

const { TokenBucket } = await import('../src/media/tokenBucket.ts')
const { ByteLru } = await import('../src/media/byteLru.ts')
const pixabay = await import('../src/media/pixabay.ts')
const cutStore = await import('../src/media/cutStore.ts')
const moderation = await import('../src/media/moderation.ts')

describe('TokenBucket', () => {
  it('allows capacity takes, then refuses until refilled', () => {
    let now = 0
    const bucket = new TokenBucket(3, 1 / 1000, () => now)
    expect([bucket.tryTake(), bucket.tryTake(), bucket.tryTake(), bucket.tryTake()]).toEqual([true, true, true, false])
    expect(bucket.msUntilNext()).toBe(1000)
    now = 1000
    expect(bucket.tryTake()).toBe(true)
  })
})

describe('ByteLru', () => {
  it('evicts least-recently-used entries past the byte cap', () => {
    const lru = new ByteLru<{ bytes: Buffer }>(10)
    lru.set('a', { bytes: Buffer.alloc(4) })
    lru.set('b', { bytes: Buffer.alloc(4) })
    lru.get('a') // a is now most recent
    lru.set('c', { bytes: Buffer.alloc(4) })
    expect(lru.get('b')).toBeUndefined()
    expect(lru.get('a')).toBeDefined()
    expect(lru.get('c')).toBeDefined()
    expect(lru.size).toBe(8)
  })
})

function fakeHit(id: number) {
  return {
    id,
    tags: 'goat, animal',
    previewURL: `https://cdn.pixabay.com/photo/x/${id}_150.jpg`,
    webformatURL: `https://pixabay.com/get/${id}_640.jpg`,
    webformatWidth: 640,
    webformatHeight: 427,
  }
}

describe('search', () => {
  beforeEach(() => {
    pixabay._resetForTests()
    process.env.PIXABAY_KEY = 'test-key'
  })
  afterEach(() => vi.unstubAllGlobals())

  it('caches by query+page and only calls Pixabay once', async () => {
    const fetchMock = vi.fn(async () => Response.json({ totalHits: 1, hits: [fakeHit(1)] }))
    vi.stubGlobal('fetch', fetchMock)
    const a = await pixabay.search('goat', 1)
    const b = await pixabay.search('goat', 1)
    expect(a.kind).toBe('ok')
    expect(b.kind).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a response with the wrong shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ hits: 'nope' })))
    const outcome = await pixabay.search('goat', 1)
    expect(outcome.kind).toBe('upstream_error')
  })

  it('returns rate_limited after 60 uncached searches in a burst', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ totalHits: 0, hits: [] })))
    const outcomes = []
    for (let i = 0; i < 70; i++) outcomes.push(await pixabay.search(`term ${i}`, 1))
    expect(outcomes.filter((o) => o.kind === 'ok')).toHaveLength(60)
    expect(outcomes.filter((o) => o.kind === 'rate_limited')).toHaveLength(10)
  })

  it('serves a stale cached response when the bucket is empty', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ totalHits: 1, hits: [fakeHit(7)] })))
      await pixabay.search('stale', 1)
      vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000) // past the 24h TTL — and the bucket has refilled
      for (let i = 0; i < 60; i++) await pixabay.search(`drain ${i}`, 1)
      const outcome = await pixabay.search('stale', 1)
      expect(outcome).toMatchObject({ kind: 'ok', stale: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('tracks which ids each session has seen', () => {
    pixabay.recordSeen('s1', [1, 2])
    expect(pixabay.sessionHasSeen('s1', 2)).toBe(true)
    expect(pixabay.sessionHasSeen('s1', 3)).toBe(false)
    expect(pixabay.sessionHasSeen('s2', 1)).toBe(false)
  })
})

describe('blocklist', () => {
  it('picks up ids written to blocklist.json', async () => {
    await writeFile(path.join(dataDir, 'blocklist.json'), JSON.stringify([42]))
    await moderation.initModeration()
    expect(moderation.isBlocked(42)).toBe(true)
    expect(moderation.isBlocked(43)).toBe(false)
  })
})

// A 64x48 photo-ish source: a red square subject on a blue background.
async function makeSource(): Promise<Buffer> {
  const w = 64
  const h = 48
  const px = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const subject = x >= 16 && x < 48 && y >= 12 && y < 36
      px[i] = subject ? 220 : 30
      px[i + 1] = subject ? 40 + x : 60
      px[i + 2] = subject ? 30 : 200
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer()
}

// What the device would upload: the source with everything but the subject
// made transparent. `recolor` simulates someone uploading a different image.
async function makeCut(source: Buffer, recolor = false): Promise<Buffer> {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4
      const subject = x >= 16 && x < 48 && y >= 12 && y < 36
      data[i + 3] = subject ? 255 : 0
      if (recolor && subject) {
        data[i] = 20
        data[i + 1] = 220
        data[i + 2] = 20
      }
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .webp({ quality: 85 })
    .toBuffer()
}

describe('storeCut', () => {
  beforeEach(() => cutStore._resetForTests())

  it('accepts a genuine cut, re-encodes it, trims it, and indexes it', async () => {
    const source = await makeSource()
    const result = await cutStore.storeCut(101, await makeCut(source), async () => source)
    expect(result.created).toBe(true)
    expect(cutStore.lookupCut(101)).toEqual(result.urls)
  })

  it('keeps the first cut and discards later uploads for the same id', async () => {
    const source = await makeSource()
    await cutStore.storeCut(102, await makeCut(source), async () => source)
    const second = await cutStore.storeCut(102, await makeCut(source), async () => source)
    expect(second.created).toBe(false)
  })

  it('rejects an image that does not match the source', async () => {
    const source = await makeSource()
    await expect(cutStore.storeCut(103, await makeCut(source, true), async () => source)).rejects.toBeInstanceOf(
      cutStore.CutRejected,
    )
    expect(cutStore.lookupCut(103)).toBeNull()
  })

  it('rejects non-WebP bytes and images without alpha', async () => {
    const source = await makeSource()
    await expect(cutStore.storeCut(104, source, async () => source)).rejects.toThrow(/WebP/)
    const opaque = await sharp(source).webp().toBuffer()
    await expect(cutStore.storeCut(105, opaque, async () => source)).rejects.toThrow(/transparent/)
  })
})
