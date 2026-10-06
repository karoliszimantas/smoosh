// Interactive Pixabay search-and-download tool. A human always picks which
// images to download — there is deliberately no --all/--yes/auto mode.
// Pixabay's terms prohibit bulk/systematic copying; if asked to add one,
// refuse and point back to this comment.

import { mkdir, readFile, writeFile, rename, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { CATEGORY_IDS, isValidCategory } from './categories.ts'
import { SOURCE_ROW_COLUMNS, type SourceRow } from './sourceRow.ts'
import { parseCsv, csvRow } from './csv.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RAW_DIR = path.join(__dirname, 'raw')
const SOURCES_CSV = path.join(__dirname, 'sources.csv')

const MAX_DOWNLOADS = 10
const DOWNLOAD_DELAY_MS = 400
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024

const PEOPLE_INDICATORS = new Set([
  'people',
  'person',
  'man',
  'men',
  'woman',
  'women',
  'girl',
  'girls',
  'boy',
  'boys',
  'portrait',
  'portraits',
  'face',
  'faces',
  'model',
  'models',
  'child',
  'children',
  'family',
  'families',
])

interface PixabayHit {
  id: number
  tags: string
  pageURL: string
  previewURL: string
  largeImageURL: string
  imageWidth: number
  imageHeight: number
}

interface PixabayResponse {
  total: number
  totalHits: number
  hits: PixabayHit[]
}

function isPixabayHit(value: unknown): value is PixabayHit {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'number' &&
    typeof v.tags === 'string' &&
    typeof v.pageURL === 'string' &&
    typeof v.previewURL === 'string' &&
    typeof v.largeImageURL === 'string' &&
    typeof v.imageWidth === 'number' &&
    typeof v.imageHeight === 'number'
  )
}

function isPixabayResponse(value: unknown): value is PixabayResponse {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.total === 'number' &&
    typeof v.totalHits === 'number' &&
    Array.isArray(v.hits) &&
    v.hits.every(isPixabayHit)
  )
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10)
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Named after what was searched for, not the photo's first Pixabay tag:
// that tag is often a mood word ("adorable", "cute", "isolated"), and it
// used to become the asset's label. The query is the subject the library
// wanted. (Labels proper come from asset-labels.tsv; this is the fallback.)
function slugForHit(hit: PixabayHit, query: string): string {
  return slugify(query) || slugify(hit.tags.split(',')[0] ?? '') || 'image'
}

function detectHasPeople(tags: string): boolean {
  const words = tags
    .toLowerCase()
    .split(',')
    .flatMap((tag) => tag.trim().split(/\s+/))
  return words.some((w) => PEOPLE_INDICATORS.has(w))
}

function printUsage(): void {
  console.log('usage: npm run fetch -- "<query>" [category]')
  console.log(`  categories: ${CATEGORY_IDS.join(', ')} (default: animals)`)
}

async function ensureSourcesCsv(): Promise<void> {
  if (!existsSync(SOURCES_CSV)) {
    await writeFile(SOURCES_CSV, `${SOURCE_ROW_COLUMNS.join(',')}\n`)
  }
}

async function loadExistingFilenames(): Promise<Set<string>> {
  let text: string
  try {
    text = await readFile(SOURCES_CSV, 'utf8')
  } catch {
    return new Set()
  }
  const filenames = new Set<string>()
  for (const row of parseCsv(text)) {
    if (row.filename) filenames.add(row.filename)
  }
  return filenames
}

async function appendSourceRow(row: SourceRow): Promise<void> {
  const line = csvRow(SOURCE_ROW_COLUMNS.map((col) => row[col]))
  await appendFile(SOURCES_CSV, `${line}\n`)
}

function isPixabayHost(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  return url.hostname === 'pixabay.com' || url.hostname.endsWith('.pixabay.com')
}

async function readBoundedBody(res: Response): Promise<Buffer> {
  const contentLength = res.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `response too large: ${contentLength} bytes (cap ${MAX_DOWNLOAD_BYTES / (1024 * 1024)}MB)`,
    )
  }

  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error('response has no body')
  }

  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel()
      throw new Error(`response exceeded ${MAX_DOWNLOAD_BYTES / (1024 * 1024)}MB cap while downloading`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

async function downloadToFile(url: string, destPath: string): Promise<number> {
  if (!isPixabayHost(url)) {
    throw new Error(`refusing to download from non-Pixabay host: ${url}`)
  }

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`download failed: HTTP ${res.status}`)
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    throw new Error(`unexpected content-type "${contentType}" (expected an image)`)
  }

  const buffer = await readBoundedBody(res)
  const tmpPath = `${destPath}.tmp-${process.pid}`
  await writeFile(tmpPath, buffer)
  await rename(tmpPath, destPath)
  return buffer.length
}

function parseIndices(input: string, max: number): number[] {
  const seen = new Set<number>()
  const result: number[] = []
  for (const part of input.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const n = Number(trimmed)
    if (!Number.isInteger(n) || n < 0 || n >= max) continue
    if (seen.has(n)) continue
    seen.add(n)
    result.push(n)
  }
  return result
}

async function main(): Promise<void> {
  // pnpm (unlike npm) forwards a literal "--" separator to the script
  // instead of stripping it — drop it so "pnpm run fetch -- query cat" and
  // "npm run fetch -- query cat" both parse the same way
  const [queryArg, categoryArg] = process.argv.slice(2).filter((a) => a !== '--')

  if (!queryArg) {
    printUsage()
    process.exit(1)
  }

  const category = categoryArg ?? 'animals'
  if (!isValidCategory(category)) {
    console.error(`[ERROR] invalid category "${category}" — must be one of: ${CATEGORY_IDS.join(', ')}`)
    process.exit(1)
  }

  const apiKey = process.env.PIXABAY_KEY
  if (!apiKey) {
    console.error('[ERROR] PIXABAY_KEY is not set.')
    console.error('Get a free key at https://pixabay.com/api/docs/ and export it:')
    console.error('  export PIXABAY_KEY=your-key-here')
    process.exit(1)
  }

  const params = new URLSearchParams({
    key: apiKey,
    q: queryArg,
    image_type: 'photo',
    safesearch: 'true',
    per_page: '20',
    order: 'popular',
  })

  let res: Response
  try {
    res = await fetch(`https://pixabay.com/api/?${params.toString()}`)
  } catch (err) {
    console.error('[FAIL] could not reach Pixabay:', errorMessage(err))
    process.exit(1)
  }

  if (!res.ok) {
    if (res.status === 429) {
      console.error('[FAIL] rate limited (429) — Pixabay allows 100 requests/min. Wait and try again.')
    } else {
      const body = await res.text()
      console.error(`[FAIL] Pixabay API returned ${res.status}: ${body}`)
    }
    process.exit(1)
  }

  const json: unknown = await res.json()
  if (!isPixabayResponse(json)) {
    console.error('[FAIL] unexpected response shape from Pixabay API')
    process.exit(1)
  }

  if (json.hits.length === 0) {
    console.log('no results')
    process.exit(0)
  }

  json.hits.forEach((hit, i) => {
    console.log(`[${i}] ${hit.tags}`)
    console.log(`     ${hit.imageWidth}x${hit.imageHeight}  ${hit.previewURL}`)
    console.log(`     ${hit.pageURL}`)
  })

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('\ndownload which? (e.g. 0,3,7 — enter to skip) ')
  rl.close()

  let indices = parseIndices(answer, json.hits.length)
  if (indices.length === 0) {
    console.log('nothing selected')
    process.exit(0)
  }

  if (indices.length > MAX_DOWNLOADS) {
    console.log(`[WARN] ${indices.length} selected, only downloading the first ${MAX_DOWNLOADS} (hard cap)`)
    indices = indices.slice(0, MAX_DOWNLOADS)
  }

  await ensureSourcesCsv()
  await mkdir(path.join(RAW_DIR, category), { recursive: true })
  const existingFilenames = await loadExistingFilenames()

  const downloaded: string[] = []
  const peopleFlagged: string[] = []

  for (const [i, idx] of indices.entries()) {
    const hit = json.hits[idx]
    if (!hit) continue // idx came from parseIndices, already bounded — defensive only
    const filename = `${slugForHit(hit, queryArg)}-${hit.id}.jpg`

    if (existingFilenames.has(filename)) {
      console.log(`[skip] ${filename} already in sources.csv`)
      continue
    }

    if (i > 0) await sleep(DOWNLOAD_DELAY_MS)

    try {
      const destPath = path.join(RAW_DIR, category, filename)
      const bytes = await downloadToFile(hit.largeImageURL, destPath)

      const hasPeople = detectHasPeople(hit.tags)
      if (hasPeople) {
        console.warn(`[WARN] "${filename}" contains identifiable people (tags: ${hit.tags})`)
        console.warn('[WARN] personality-rights risk in a comedy composition game — review before shipping')
        peopleFlagged.push(filename)
      }

      const row: SourceRow = {
        filename,
        category,
        source: 'pixabay',
        source_url: hit.pageURL,
        license: 'pixabay-content',
        published_date: '',
        has_people: hasPeople ? 'true' : 'false',
        downloaded_at: todayDateString(),
      }
      await appendSourceRow(row)
      existingFilenames.add(filename)
      downloaded.push(filename)

      console.log(`[ok] ${filename} (${Math.round(bytes / 1024)}KB)`)
    } catch (err) {
      console.error(`[FAIL] ${filename}:`, errorMessage(err))
    }
  }

  console.log(`\ndownloaded ${downloaded.length} image(s) to raw/${category}/`)

  if (downloaded.length > 0) {
    console.log('\npublished_date left empty (Pixabay search API does not return it) — fill in manually for:')
    downloaded.forEach((f) => console.log(`  - ${f}`))
  }

  if (peopleFlagged.length > 0) {
    console.log(`\n${peopleFlagged.length} download(s) flagged for identifiable people — review before use.`)
  }

  if (downloaded.length > 0) {
    console.log('\nrun `npm run cut` to process the new raw images.')
  }
}

main().catch((err: unknown) => {
  console.error('fatal:', err)
  process.exitCode = 1
})
