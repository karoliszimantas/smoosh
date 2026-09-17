// Uploads cut.ts's output to Cloudflare R2 and rewrites the manifest with
// absolute URLs. Config comes from tools/.env via process.env — no dotenv
// dependency, same as fetch.ts's PIXABAY_KEY.

import { createHash } from 'node:crypto'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { S3Client, HeadObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { CATEGORIES } from './categories.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT_DIR, 'public')
const MANIFEST_PATH = path.join(PUBLIC_DIR, 'assets', 'manifest.json')
const RAW_DIR = path.join(__dirname, 'raw')

const UPLOAD_CONCURRENCY = 4
const MANIFEST_KEY = 'manifest.json'

// The key is the content's own hash, so an object at a given URL can never
// change — a changed file gets a new URL instead. That makes a year-long
// immutable cache unconditionally safe: there is never a stale copy to purge.
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

// The manifest itself is mutable (it's what lets the library update without
// a code deploy — see src/assets/localSource.ts), so it gets a short cache
// instead of the immutable one above.
const MANIFEST_CACHE_CONTROL = 'public, max-age=60, must-revalidate'

interface ManifestAsset {
  id: string
  c: string
  f: string
  t: string
  w: number
  h: number
  l: string
}

interface ManifestCategory {
  id: string
  label: string
  count: number
}

interface Manifest {
  version: number
  generated: string
  categories: ManifestCategory[]
  assets: ManifestAsset[]
}

interface Env {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  assetsBucket: string
  rawBucket: string
  publicUrl: string
}

interface Totals {
  uploaded: number
  skipped: number
  bytes: number
}

type UploadOutcome = { status: 'up' | 'skip'; size: number } | { status: 'fail' }

const REQUIRED_ENV_VARS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ASSETS_BUCKET',
  'R2_RAW_BUCKET',
  'R2_PUBLIC_URL',
] as const

function isManifestCategory(value: unknown): value is ManifestCategory {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.label === 'string' && typeof v.count === 'number'
}

function isManifestAsset(value: unknown): value is ManifestAsset {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.c === 'string' &&
    typeof v.f === 'string' &&
    typeof v.t === 'string' &&
    typeof v.w === 'number' &&
    typeof v.h === 'number' &&
    typeof v.l === 'string'
  )
}

function isManifest(value: unknown): value is Manifest {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.version === 'number' &&
    typeof v.generated === 'string' &&
    Array.isArray(v.categories) &&
    v.categories.every(isManifestCategory) &&
    Array.isArray(v.assets) &&
    v.assets.every(isManifestAsset)
  )
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function httpStatus(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode
}

function errorName(err: unknown): string | undefined {
  return err instanceof Error ? err.name : undefined
}

function isNotFound(err: unknown): boolean {
  return httpStatus(err) === 404 || errorName(err) === 'NotFound' || errorName(err) === 'NoSuchKey'
}

// Thrown by a bad key pair, a revoked token, or a wrong account ID — none of
// these are per-file problems, so they abort the whole run instead of being
// logged as a [FAIL] for one file.
function isCredentialError(err: unknown): boolean {
  const name = errorName(err)
  return (
    httpStatus(err) === 403 ||
    name === 'InvalidAccessKeyId' ||
    name === 'SignatureDoesNotMatch' ||
    name === 'AccessDenied' ||
    name === 'CredentialsProviderError' ||
    name === 'UnrecognizedClientException'
  )
}

function mimeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

function logResult(status: 'up' | 'skip', key: string, size: number): void {
  console.log(`[${status}] ${key} (${Math.round(size / 1024)}KB)`)
}

function loadEnv(): Env {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name])
  if (missing.length > 0) {
    console.error(`[FAIL] missing required environment variable(s): ${missing.join(', ')}`)
    console.error('set them in tools/.env (see tools/.env.example) — publish.ts reads them via process.env')
    process.exit(1)
  }

  return {
    accountId: process.env.R2_ACCOUNT_ID!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    assetsBucket: process.env.R2_ASSETS_BUCKET!,
    rawBucket: process.env.R2_RAW_BUCKET!,
    publicUrl: process.env.R2_PUBLIC_URL!.replace(/\/+$/, ''),
  }
}

function createClient(env: Env): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
  })
}

// A simple worker-pool limiter — small enough that pulling in p-limit isn't
// worth a dependency. A rejection (e.g. a credential error) propagates
// through Promise.all immediately, aborting the whole run.
async function runWithConcurrency<T>(limit: number, tasks: Array<() => Promise<T>>): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++
      if (i >= tasks.length) return
      const task = tasks[i]
      if (!task) continue
      results[i] = await task()
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
  await Promise.all(workers)
  return results
}

async function uploadIfMissing(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
  cacheControl?: string,
): Promise<'up' | 'skip'> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return 'skip'
  } catch (err) {
    if (!isNotFound(err)) throw err
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(cacheControl ? { CacheControl: cacheControl } : {}),
    }),
  )
  return 'up'
}

async function publishAssetFile(
  client: S3Client,
  bucket: string,
  publicUrl: string,
  localPath: string,
  label: string,
): Promise<{ key: string; url: string; result: UploadOutcome }> {
  const buffer = await readFile(localPath)
  const hash = createHash('sha256').update(buffer).digest('hex')
  const key = `a/${hash.slice(0, 2)}/${hash}.webp`
  const url = `${publicUrl}/${key}`

  try {
    const status = await uploadIfMissing(client, bucket, key, buffer, 'image/webp', IMMUTABLE_CACHE_CONTROL)
    logResult(status, key, buffer.length)
    return { key, url, result: { status, size: buffer.length } }
  } catch (err) {
    if (isCredentialError(err)) throw err
    console.error(`[FAIL] ${label} (${key}):`, errorMessage(err))
    return { key, url, result: { status: 'fail' } }
  }
}

async function loadLocalManifest(): Promise<Manifest> {
  let text: string
  try {
    text = await readFile(MANIFEST_PATH, 'utf8')
  } catch {
    console.error(`[FAIL] no manifest found at ${path.relative(ROOT_DIR, MANIFEST_PATH)} — run \`pnpm cut\` first`)
    process.exit(1)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    console.error('[FAIL] manifest.json is not valid JSON:', errorMessage(err))
    process.exit(1)
  }

  if (!isManifest(parsed)) {
    console.error('[FAIL] manifest.json has an unexpected shape')
    process.exit(1)
  }

  return parsed
}

function recomputeCategories(base: ManifestCategory[], assets: ManifestAsset[]): ManifestCategory[] {
  const counts = new Map<string, number>()
  for (const a of assets) counts.set(a.c, (counts.get(a.c) ?? 0) + 1)
  return base.map((c) => ({ ...c, count: counts.get(c.id) ?? 0 }))
}

async function publishAssets(
  client: S3Client,
  env: Env,
  manifest: Manifest,
): Promise<{ assets: ManifestAsset[]; totals: Totals; keys: Set<string> }> {
  const totals: Totals = { uploaded: 0, skipped: 0, bytes: 0 }
  const keys = new Set<string>()

  const tasks = manifest.assets.map((asset) => async (): Promise<ManifestAsset | null> => {
    const fullLocal = path.join(PUBLIC_DIR, asset.f)
    const thumbLocal = path.join(PUBLIC_DIR, asset.t)

    if (!existsSync(fullLocal) || !existsSync(thumbLocal)) {
      console.error(`[FAIL] ${asset.id}: local file missing — run \`pnpm cut\` first`)
      return null
    }

    const full = await publishAssetFile(client, env.assetsBucket, env.publicUrl, fullLocal, `${asset.id} full`)
    const thumb = await publishAssetFile(client, env.assetsBucket, env.publicUrl, thumbLocal, `${asset.id} thumb`)

    if (full.result.status === 'fail' || thumb.result.status === 'fail') return null

    for (const r of [full.result, thumb.result]) {
      if (r.status === 'up') totals.uploaded++
      else totals.skipped++
      totals.bytes += r.size
    }
    keys.add(full.key)
    keys.add(thumb.key)

    return { ...asset, f: full.url, t: thumb.url }
  })

  const results = await runWithConcurrency(UPLOAD_CONCURRENCY, tasks)
  const assets = results.filter((a): a is ManifestAsset => a !== null)
  return { assets, totals, keys }
}

async function syncRaw(client: S3Client, env: Env): Promise<Totals> {
  const totals: Totals = { uploaded: 0, skipped: 0, bytes: 0 }
  const tasks: Array<() => Promise<void>> = []

  for (const category of CATEGORIES) {
    const dir = path.join(RAW_DIR, category.id)
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') continue
      throw err
    }

    for (const filename of entries) {
      tasks.push(async () => {
        const key = `${category.id}/${filename}`
        const buffer = await readFile(path.join(dir, filename))
        try {
          // no CacheControl / public URL wired up for this bucket — it stays
          // private, reachable only with the R2 credentials above
          const status = await uploadIfMissing(client, env.rawBucket, key, buffer, mimeFor(filename))
          logResult(status, key, buffer.length)
          if (status === 'up') totals.uploaded++
          else totals.skipped++
          totals.bytes += buffer.length
        } catch (err) {
          if (isCredentialError(err)) throw err
          console.error(`[FAIL] ${key}:`, errorMessage(err))
        }
      })
    }
  }

  await runWithConcurrency(UPLOAD_CONCURRENCY, tasks)
  return totals
}

async function reportOrphans(client: S3Client, bucket: string, knownKeys: ReadonlySet<string>): Promise<void> {
  const orphans: string[] = []
  let continuationToken: string | undefined

  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: 'a/', ContinuationToken: continuationToken }),
    )
    for (const obj of res.Contents ?? []) {
      if (obj.Key && !knownKeys.has(obj.Key)) orphans.push(obj.Key)
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (continuationToken)

  if (orphans.length === 0) {
    console.log('\nno orphaned objects in the assets bucket')
    return
  }

  console.log(`\n[ORPHANED] ${orphans.length} object(s) in the assets bucket not referenced by the current manifest:`)
  orphans.forEach((k) => console.log(`  - ${k}`))
  console.log('(report only — nothing deleted)')
}

async function main(): Promise<void> {
  const env = loadEnv()
  const client = createClient(env)
  const manifest = await loadLocalManifest()

  console.log(`publishing ${manifest.assets.length} asset(s) to ${env.assetsBucket}...\n`)

  let assetsResult: { assets: ManifestAsset[]; totals: Totals; keys: Set<string> }
  try {
    assetsResult = await publishAssets(client, env, manifest)
  } catch (err) {
    if (isCredentialError(err)) {
      console.error(`\n[FAIL] R2 credential error, aborting: ${errorMessage(err)}`)
      process.exit(1)
    }
    throw err
  }

  console.log(`\nsyncing tools/raw/ to ${env.rawBucket} (private originals)...\n`)

  let rawTotals: Totals
  try {
    rawTotals = await syncRaw(client, env)
  } catch (err) {
    if (isCredentialError(err)) {
      console.error(`\n[FAIL] R2 credential error, aborting: ${errorMessage(err)}`)
      process.exit(1)
    }
    throw err
  }

  const publishedManifest: Manifest = {
    version: Date.now(),
    generated: new Date().toISOString(),
    categories: recomputeCategories(manifest.categories, assetsResult.assets),
    assets: assetsResult.assets,
  }

  const manifestJson = JSON.stringify(publishedManifest, null, 2)
  await writeFile(MANIFEST_PATH, manifestJson)

  await client.send(
    new PutObjectCommand({
      Bucket: env.assetsBucket,
      Key: MANIFEST_KEY,
      Body: Buffer.from(manifestJson, 'utf8'),
      ContentType: 'application/json',
      CacheControl: MANIFEST_CACHE_CONTROL,
    }),
  )
  const manifestUrl = `${env.publicUrl}/${MANIFEST_KEY}`

  const totalUploaded = assetsResult.totals.uploaded + rawTotals.uploaded
  const totalSkipped = assetsResult.totals.skipped + rawTotals.skipped
  const totalBytes = assetsResult.totals.bytes + rawTotals.bytes

  console.log(`\nuploaded ${totalUploaded}, skipped ${totalSkipped}, ${Math.round(totalBytes / 1024)}KB total`)
  console.log(`manifest: ${manifestUrl}`)

  await reportOrphans(client, env.assetsBucket, assetsResult.keys)
}

main().catch((err: unknown) => {
  console.error('fatal:', errorMessage(err))
  process.exitCode = 1
})
