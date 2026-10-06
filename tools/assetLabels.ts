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
import { parseLabels } from '@smoosh/protocol'
import { CATEGORIES } from './categories.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const LABELS_TSV = path.join(__dirname, 'asset-labels.tsv')
const RAW_DIR = path.join(__dirname, 'raw')

export const IMAGE_RE = /\.(jpe?g|png|webp)$/i

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

// Reads and checks asset-labels.tsv, with the same reader the /labels tool
// and the game server use (@smoosh/protocol). `problems` non-empty means the
// file must be fixed before it's used — nothing is half-applied.
export async function loadAssetLabels(): Promise<{ labels: Map<string, AssetLabel>; problems: string[] }> {
  const labels = new Map<string, AssetLabel>()
  let text: string
  try {
    text = await readFile(LABELS_TSV, 'utf8')
  } catch {
    console.warn(`no ${path.basename(LABELS_TSV)} — labels come from filenames`)
    return { labels, problems: [] }
  }
  const { doc, problems } = parseLabels(text)
  for (const row of doc.rows) labels.set(row.id, { label: row.label, tags: row.tags, remove: row.remove })
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
