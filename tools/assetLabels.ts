// The hand-written label and search tags for each asset (asset-labels.tsv),
// and the assets taken out of the library. Read by cut.ts when it writes the
// manifest and by relabel.ts to update an existing one — so a label lives in
// one reviewed file, not in a filename.
//
// The file is checked before anything uses it: a malformed row in 500+ lines
// is hard to spot by eye, and a row whose id matches no asset is a label
// silently doing nothing.

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORIES } from './categories.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const LABELS_TSV = path.join(__dirname, 'asset-labels.tsv')
const RAW_DIR = path.join(__dirname, 'raw')

export const IMAGE_RE = /\.(jpe?g|png|webp)$/i
const REQUIRED_COLUMNS = ['id', 'category', 'label', 'tags', 'remove', 'note'] as const

export type AssetLabel = { label: string; tags: string[]; remove: boolean }

// An asset's id: its category and raw filename, slugged. It's an opaque key
// — "animals-adorable-15904" is a toy chick, and that's fine. Renaming a raw
// file changes the id and orphans its row in asset-labels.tsv.
export function slugify(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function assetIdFor(categoryId: string, filename: string): string {
  return `${categoryId}-${slugify(filename)}`
}

// Reads and checks asset-labels.tsv. `problems` non-empty means the file
// must be fixed before it's used — nothing is half-applied.
export async function loadAssetLabels(): Promise<{ labels: Map<string, AssetLabel>; problems: string[] }> {
  const labels = new Map<string, AssetLabel>()
  const problems: string[] = []
  let text: string
  try {
    text = await readFile(LABELS_TSV, 'utf8')
  } catch {
    console.warn(`no ${path.basename(LABELS_TSV)} — labels come from filenames`)
    return { labels, problems }
  }

  const lines = text.split(/\r?\n/).map((line, i) => ({ line, n: i + 1 }))
  const rows = lines.filter(({ line }) => line.trim() !== '' && !line.startsWith('#'))
  const headerRow = rows.shift()
  const header = (headerRow?.line ?? '').split('\t').map((h) => h.trim())
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c))
  if (missing.length > 0) {
    problems.push(`header is missing column(s): ${missing.join(', ')}`)
    return { labels, problems }
  }
  const col = (name: (typeof REQUIRED_COLUMNS)[number]) => header.indexOf(name)

  for (const { line, n } of rows) {
    const cells = line.split('\t')
    const at = `line ${n}`
    // a tab typed inside a cell shifts everything after it
    if (cells.length !== header.length) {
      problems.push(`${at}: ${cells.length} cells, expected ${header.length} — a tab inside a cell?`)
      continue
    }
    const cell = (name: (typeof REQUIRED_COLUMNS)[number]) => (cells[col(name)] ?? '').trim()
    const id = cell('id')
    if (!id || /\s/.test(id)) {
      problems.push(`${at}: id "${id}" is empty or has spaces`)
      continue
    }
    if (labels.has(id)) problems.push(`${at}: duplicate id ${id}`)
    const remove = cell('remove').toLowerCase()
    if (remove !== '' && remove !== 'yes') problems.push(`${at}: remove is "${cell('remove')}" — leave it empty or write yes`)
    const label = cell('label')
    if (!label && remove !== 'yes') problems.push(`${at}: ${id} has no label`)
    const rawTags = cell('tags')
    const tags = rawTags.split(',').map((t) => t.trim().toLowerCase())
    // "a, b," or "a,, b" — an empty entry is a typo, not a tag
    if (rawTags !== '' && tags.some((t) => t === '')) problems.push(`${at}: ${id} has an empty tag (stray comma?)`)
    if (!id.startsWith(`${cell('category')}-`)) {
      problems.push(`${at}: ${id} doesn't match its category "${cell('category')}"`)
    }
    labels.set(id, { label, tags: tags.filter(Boolean), remove: remove === 'yes' })
  }
  return { labels, problems }
}

// Every asset id the raw files make — null when there are no raw files on
// this machine to check against.
export async function rawAssetIds(): Promise<Set<string> | null> {
  const ids = new Set<string>()
  let found = false
  for (const category of CATEGORIES) {
    let entries: string[]
    try {
      entries = await readdir(path.join(RAW_DIR, category.id))
    } catch {
      continue
    }
    found = true
    for (const f of entries) if (IMAGE_RE.test(f)) ids.add(assetIdFor(category.id, f))
  }
  return found ? ids : null
}

// Rows whose id matches no raw file: a renamed or deleted file, and a
// hand-written label that has quietly stopped applying to anything.
export function orphanedRows(labels: ReadonlyMap<string, AssetLabel>, known: ReadonlySet<string>): string[] {
  return [...labels.keys()].filter((id) => !known.has(id))
}

export function reportProblems(problems: readonly string[]): void {
  console.error(`\n[asset-labels.tsv] ${problems.length} problem(s) — nothing was changed:`)
  for (const p of problems.slice(0, 50)) console.error(`  ${p}`)
  if (problems.length > 50) console.error(`  …and ${problems.length - 50} more`)
}

export function reportOrphans(orphans: readonly string[]): void {
  if (orphans.length === 0) return
  console.warn(`\n[asset-labels.tsv] ${orphans.length} row(s) match no raw file — renamed or deleted? Their labels apply to nothing:`)
  for (const id of orphans) console.warn(`  ${id}`)
}
