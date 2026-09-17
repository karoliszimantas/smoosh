import { readdir, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { removeBackground } from '@imgly/background-removal-node'
import { CATEGORIES } from './categories.ts'
import type { SourceRow } from './sourceRow.ts'
import { parseCsv } from './csv.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const RAW_DIR = path.join(__dirname, 'raw')
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets')
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json')
// not served to players — this is a build artifact for the asset curator
const PROVENANCE_PATH = path.join(__dirname, 'provenance.json')
const SOURCES_CSV = path.join(__dirname, 'sources.csv')

const FULL_SIZE = 800
const THUMB_SIZE = 160
// guard against decompression bombs in raw input files
const MAX_INPUT_PIXELS = 40_000_000
const IMAGE_RE = /\.(jpe?g|png|webp)$/i

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

interface ProvenanceEntry {
  filename: string
  category: string
  source: string
  source_url: string
  license: string
  published_date: string
  has_people: boolean
  downloaded_at: string
}

type Provenance = Record<string, ProvenanceEntry>

interface ProcessResult {
  id: string
  w: number
  h: number
}

interface Dimensions {
  w: number
  h: number
}

function isDimensionedAsset(value: unknown): value is { id: string; w: number; h: number } {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.w === 'number' && typeof v.h === 'number'
}

function isManifestShape(value: unknown): value is { assets: unknown[] } {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.assets)
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function mimeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

function slugify(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function humanize(filename: string): string {
  const base = filename
    .replace(/\.[^.]+$/, '') // strip extension
    .replace(/-\d+$/, '') // strip a trailing "-<id>" segment, e.g. fetch.ts's "-2295436"
    .replace(/[-_]+/g, ' ')
    .trim()
  return base.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1))
}

async function loadSources(): Promise<Map<string, SourceRow>> {
  let text: string
  try {
    text = await readFile(SOURCES_CSV, 'utf8')
  } catch {
    console.warn(`no sources.csv found at ${SOURCES_CSV} — all raw files will be skipped`)
    return new Map()
  }

  const map = new Map<string, SourceRow>()
  for (const row of parseCsv(text)) {
    if (!row.filename || !row.category) continue
    const sourceRow: SourceRow = {
      filename: row.filename,
      category: row.category,
      source: row.source ?? '',
      source_url: row.source_url ?? '',
      license: row.license ?? '',
      published_date: row.published_date ?? '',
      has_people: row.has_people ?? '',
      downloaded_at: row.downloaded_at ?? '',
    }
    map.set(`${sourceRow.category}/${sourceRow.filename}`, sourceRow)
  }
  return map
}

async function loadPreviousDimensions(): Promise<Map<string, Dimensions>> {
  const map = new Map<string, Dimensions>()

  let text: string
  try {
    text = await readFile(MANIFEST_PATH, 'utf8')
  } catch {
    return map
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return map
  }

  if (!isManifestShape(parsed)) return map
  for (const asset of parsed.assets) {
    if (isDimensionedAsset(asset)) map.set(asset.id, { w: asset.w, h: asset.h })
  }
  return map
}

async function reportOrphanedOutputs(knownIds: ReadonlySet<string>): Promise<void> {
  const orphans: string[] = []

  for (const category of CATEGORIES) {
    const dir = path.join(OUT_DIR, category.id)
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') continue
      throw err
    }

    for (const entry of entries) {
      const match = /^(.+)-(?:full|thumb)\.webp$/.exec(entry)
      const id = match?.[1]
      if (id && !knownIds.has(id)) {
        orphans.push(path.join(category.id, entry))
      }
    }
  }

  if (orphans.length > 0) {
    console.log(`\n[ORPHANED] ${orphans.length} output file(s) with no matching manifest entry:`)
    orphans.forEach((f) => console.log(`  - ${f}`))
  }
}

async function listRawFiles(categoryId: string): Promise<string[]> {
  const dir = path.join(RAW_DIR, categoryId)
  try {
    const entries = await readdir(dir)
    return entries.filter((f) => IMAGE_RE.test(f)).sort()
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ENOENT') return []
    throw err
  }
}

async function makeVariant(buffer: Buffer, size: number, outPath: string): Promise<sharp.OutputInfo> {
  // sharp strips EXIF/ICC metadata by default — calling .withMetadata() (even
  // with {}) would instead re-attach it, so it's deliberately omitted here.
  return sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outPath)
}

async function processFile(
  categoryId: string,
  filename: string,
  previousDims: Map<string, Dimensions>,
): Promise<ProcessResult> {
  const rawPath = path.join(RAW_DIR, categoryId, filename)
  const id = `${categoryId}-${slugify(filename)}`
  const outDir = path.join(OUT_DIR, categoryId)
  await mkdir(outDir, { recursive: true })
  const fullPath = path.join(outDir, `${id}-full.webp`)
  const thumbPath = path.join(outDir, `${id}-thumb.webp`)

  if (existsSync(fullPath) && existsSync(thumbPath)) {
    const cached = previousDims.get(id)
    if (cached) {
      console.log(`[skip] ${filename} (output exists)`)
      return { id, w: cached.w, h: cached.h }
    }
    // no dimensions carried over from the previous manifest — fall back to
    // reading them off the file directly (e.g. first run after a manual copy)
    const meta = await sharp(fullPath).metadata()
    console.log(`[skip] ${filename} (output exists, re-read dimensions)`)
    return { id, w: meta.width, h: meta.height }
  }

  const t0 = performance.now()
  const rawBuffer = await readFile(rawPath)

  let workingBuffer: Buffer
  if (categoryId === 'backgrounds') {
    workingBuffer = rawBuffer
  } else {
    const cutBlob = await removeBackground(new Blob([rawBuffer], { type: mimeFor(filename) }), {
      output: { format: 'image/png', quality: 1 },
    })
    const cutBuffer = Buffer.from(await cutBlob.arrayBuffer())

    // a fully transparent result (background removal found no subject) trims
    // to a no-op rather than throwing, so check the alpha channel explicitly
    const stats = await sharp(cutBuffer, { limitInputPixels: MAX_INPUT_PIXELS }).stats()
    const alpha = stats.channels[3]
    if (!alpha || alpha.max === 0) {
      throw new Error('background removal produced an empty image — bad source photo')
    }

    workingBuffer = await sharp(cutBuffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .trim({ threshold: 10 })
      .toBuffer()
  }

  const fullInfo = await makeVariant(workingBuffer, FULL_SIZE, fullPath)
  const thumbInfo = await makeVariant(workingBuffer, THUMB_SIZE, thumbPath)

  const duration = Math.round(performance.now() - t0)
  const kb = Math.round((fullInfo.size + thumbInfo.size) / 1024)
  console.log(`[ok] ${filename} -> ${kb}KB in ${duration}ms`)

  return { id, w: fullInfo.width, h: fullInfo.height }
}

async function main(): Promise<void> {
  const sources = await loadSources()
  const previousDims = await loadPreviousDimensions()
  const manifestAssets: ManifestAsset[] = []
  const provenance: Provenance = {}
  const categoryCounts = new Map<string, number>()
  for (const c of CATEGORIES) categoryCounts.set(c.id, 0)

  for (const category of CATEGORIES) {
    const files = await listRawFiles(category.id)

    for (const filename of files) {
      const key = `${category.id}/${filename}`
      const sourceRow = sources.get(key)

      if (!sourceRow) {
        console.error(`[ERROR] no sources.csv row for ${key} — skipping this file`)
        continue
      }

      try {
        const { id, w, h } = await processFile(category.id, filename, previousDims)

        manifestAssets.push({
          id,
          c: category.id,
          f: `/assets/${category.id}/${id}-full.webp`,
          t: `/assets/${category.id}/${id}-thumb.webp`,
          w,
          h,
          l: humanize(filename),
        })
        categoryCounts.set(category.id, (categoryCounts.get(category.id) ?? 0) + 1)

        const hasPeople = sourceRow.has_people.toLowerCase() === 'true'
        if (hasPeople) {
          console.warn(`[WARN] ${id} contains identifiable people — check personality rights before shipping`)
        }

        provenance[id] = {
          filename,
          category: category.id,
          source: sourceRow.source,
          source_url: sourceRow.source_url,
          license: sourceRow.license,
          published_date: sourceRow.published_date,
          has_people: hasPeople,
          downloaded_at: sourceRow.downloaded_at,
        }
      } catch (err) {
        console.error(`[FAIL] ${key}:`, errorMessage(err))
      }
    }
  }

  await mkdir(OUT_DIR, { recursive: true })

  const manifest: Manifest = {
    version: Date.now(),
    generated: new Date().toISOString(),
    categories: CATEGORIES.map((c) => ({ id: c.id, label: c.label, count: categoryCounts.get(c.id) ?? 0 })),
    assets: manifestAssets,
  }

  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
  await writeFile(PROVENANCE_PATH, JSON.stringify(provenance, null, 2))

  console.log(`\nwrote ${manifestAssets.length} assets -> ${path.relative(process.cwd(), MANIFEST_PATH)}`)

  await reportOrphanedOutputs(new Set(manifestAssets.map((a) => a.id)))
}

main().catch((err: unknown) => {
  console.error('fatal:', err)
  process.exitCode = 1
})
