// The shared cut library. Cuts are produced on players' devices, uploaded
// once, and then served to everyone who later finds the same Pixabay image.
// There is no database: the object store IS the index. At boot we list it
// once into an in-memory Set and keep that Set current on every upload, so a
// lookup is a Set.has() — never a HEAD request per id.

import { mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp, { type Metadata } from 'sharp'
import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3'
import { DATA_DIR } from './moderation.ts'

const CUT_PREFIX = 'cuts/'
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

const FULL_SIZE = 1024
const THUMB_SIZE = 256
// a 1024px cut needs ~1M pixels; anything far past that is not something our
// client produced and might be a decompression bomb
const MAX_INPUT_PIXELS = 2048 * 2048

export type CutUrls = { full: string; thumb: string }

interface CutBackend {
  readonly name: string
  listIds(): Promise<number[]>
  put(id: number, full: Buffer, thumb: Buffer): Promise<void>
  urlsFor(id: number): CutUrls
}

function idFromKey(key: string): number | null {
  const match = /^(\d+)\.webp$/.exec(key)
  if (!match?.[1]) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) ? id : null
}

// ---------- R2 (production)

class R2Backend implements CutBackend {
  readonly name = 'r2'
  private readonly client: S3Client

  constructor(
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
    private readonly bucket: string,
    private readonly publicUrl: string,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })
  }

  async listIds(): Promise<number[]> {
    const ids: number[] = []
    let token: string | undefined
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: CUT_PREFIX, ContinuationToken: token }),
      )
      for (const obj of res.Contents ?? []) {
        const id = obj.Key ? idFromKey(obj.Key.slice(CUT_PREFIX.length)) : null
        if (id !== null) ids.push(id)
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (token)
    return ids
  }

  async put(id: number, full: Buffer, thumb: Buffer): Promise<void> {
    // thumb first: the index (and listIds) keys off the full image, so a
    // failure between the two leaves an orphan thumb rather than a cut whose
    // thumbnail 404s
    for (const [key, body] of [
      [`${CUT_PREFIX}${id}-thumb.webp`, thumb],
      [`${CUT_PREFIX}${id}.webp`, full],
    ] as const) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: 'image/webp',
          CacheControl: IMMUTABLE_CACHE_CONTROL,
        }),
      )
    }
  }

  urlsFor(id: number): CutUrls {
    return {
      full: `${this.publicUrl}/${CUT_PREFIX}${id}.webp`,
      thumb: `${this.publicUrl}/${CUT_PREFIX}${id}-thumb.webp`,
    }
  }
}

// ---------- local disk (dev without R2 credentials)

export const LOCAL_CUTS_DIR = path.join(DATA_DIR, 'cuts')

class LocalBackend implements CutBackend {
  readonly name = 'local'

  async listIds(): Promise<number[]> {
    await mkdir(LOCAL_CUTS_DIR, { recursive: true })
    const entries = await readdir(LOCAL_CUTS_DIR)
    return entries.map(idFromKey).filter((id): id is number => id !== null)
  }

  async put(id: number, full: Buffer, thumb: Buffer): Promise<void> {
    await mkdir(LOCAL_CUTS_DIR, { recursive: true })
    for (const [name, body] of [
      [`${id}-thumb.webp`, thumb],
      [`${id}.webp`, full],
    ] as const) {
      const dest = path.join(LOCAL_CUTS_DIR, name)
      await writeFile(`${dest}.tmp`, body)
      await rename(`${dest}.tmp`, dest)
    }
  }

  // relative — the client resolves these against the server's own origin,
  // and http.ts serves them from LOCAL_CUTS_DIR
  urlsFor(id: number): CutUrls {
    return { full: `/api/cut-files/${id}.webp`, thumb: `/api/cut-files/${id}-thumb.webp` }
  }
}

function createBackend(): CutBackend {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ASSETS_BUCKET, R2_PUBLIC_URL } = process.env
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_ASSETS_BUCKET && R2_PUBLIC_URL) {
    return new R2Backend(
      R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY,
      R2_ASSETS_BUCKET,
      R2_PUBLIC_URL.replace(/\/+$/, ''),
    )
  }
  return new LocalBackend()
}

// ---------- index

let backend: CutBackend = new LocalBackend()
const index = new Set<number>()
const inFlight = new Map<number, Promise<CutUrls>>()

export async function initCutStore(): Promise<void> {
  backend = createBackend()
  const ids = await backend.listIds()
  for (const id of ids) index.add(id)
  console.log(`[cuts] ${backend.name} store: ${index.size} cut(s) indexed`)
}

export function lookupCut(id: number): CutUrls | null {
  return index.has(id) ? backend.urlsFor(id) : null
}

// ---------- upload validation + re-encode

export class CutRejected extends Error {}

const VERIFY_SIZE = 32
// alpha above this counts as "definitely subject" for the comparison below
const OPAQUE_ALPHA = 240
// mean per-channel difference allowed between the cut's opaque pixels and the
// same pixels of the source photo — loose enough for lossy WebP and
// resampling, far too tight for an unrelated image
const MAX_MEAN_DIFF = 24
const MIN_OPAQUE_FRACTION = 0.01

// The uploader could send anything with this id on it. Every pixel the
// background-remover keeps is copied straight from the source, so a genuine
// cut's opaque pixels match the source photo; a swapped-in image doesn't.
async function verifyAgainstSource(cut: Buffer, source: Buffer): Promise<void> {
  const cutMeta = await sharp(cut, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
  const srcMeta = await sharp(source, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
  if (!cutMeta.width || !cutMeta.height || !srcMeta.width || !srcMeta.height) {
    throw new CutRejected('could not read image dimensions')
  }
  const cutRatio = cutMeta.width / cutMeta.height
  const srcRatio = srcMeta.width / srcMeta.height
  if (Math.abs(cutRatio - srcRatio) / srcRatio > 0.03) {
    throw new CutRejected('cut does not match the source image dimensions')
  }

  const resize = { width: VERIFY_SIZE, height: VERIFY_SIZE, fit: 'fill' as const }
  const cutPx = await sharp(cut).ensureAlpha().resize(resize).raw().toBuffer()
  const srcPx = await sharp(source).removeAlpha().resize(resize).raw().toBuffer()

  let opaque = 0
  let diffSum = 0
  for (let i = 0; i < VERIFY_SIZE * VERIFY_SIZE; i++) {
    const a = cutPx[i * 4 + 3] ?? 0
    if (a < OPAQUE_ALPHA) continue
    opaque++
    for (let c = 0; c < 3; c++) {
      diffSum += Math.abs((cutPx[i * 4 + c] ?? 0) - (srcPx[i * 3 + c] ?? 0))
    }
  }
  if (opaque < VERIFY_SIZE * VERIFY_SIZE * MIN_OPAQUE_FRACTION) {
    throw new CutRejected('cut is empty — no subject was found')
  }
  if (diffSum / (opaque * 3) > MAX_MEAN_DIFF) {
    throw new CutRejected('cut does not match the source image')
  }
}

// Re-encode everything: the bytes we store are produced by sharp from decoded
// pixels, never the bytes the client sent. That drops any metadata payload and
// any polyglot trailing data in one move (sharp strips metadata by default —
// .withMetadata() is deliberately never called).
async function reencode(cut: Buffer): Promise<{ full: Buffer; thumb: Buffer }> {
  const trimmed = await sharp(cut, { limitInputPixels: MAX_INPUT_PIXELS }).trim({ threshold: 10 }).toBuffer()
  const variant = (size: number, quality: number) =>
    sharp(trimmed)
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, alphaQuality: 90 })
      .toBuffer()
  return { full: await variant(FULL_SIZE, 82), thumb: await variant(THUMB_SIZE, 80) }
}

async function validateFormat(cut: Buffer): Promise<void> {
  let meta: Metadata
  try {
    meta = await sharp(cut, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
  } catch {
    throw new CutRejected('not a decodable image')
  }
  if (meta.format !== 'webp') throw new CutRejected('expected a WebP image')
  if (!meta.hasAlpha) throw new CutRejected('a cut must have a transparent background')
}

export type StoreResult = { urls: CutUrls; created: boolean }

// First cut wins: if the id is already stored (or being stored right now) the
// upload is discarded and the existing URLs come back.
export async function storeCut(id: number, cut: Buffer, source: () => Promise<Buffer>): Promise<StoreResult> {
  if (index.has(id)) return { urls: backend.urlsFor(id), created: false }
  const pending = inFlight.get(id)
  if (pending) return { urls: await pending, created: false }

  const work = (async () => {
    await validateFormat(cut)
    await verifyAgainstSource(cut, await source())
    const { full, thumb } = await reencode(cut)
    await backend.put(id, full, thumb)
    index.add(id)
    return backend.urlsFor(id)
  })()
  inFlight.set(id, work)
  try {
    return { urls: await work, created: true }
  } finally {
    inFlight.delete(id)
  }
}

// test-only
export function _resetForTests(): void {
  backend = new LocalBackend()
  index.clear()
  inFlight.clear()
}
