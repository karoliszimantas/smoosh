// Applies asset-labels.tsv to the existing manifest — labels, tags and
// removals — without cutting anything again. cut.ts does the same on its
// next run; this is for when only the labels changed.
//
//   pnpm relabel        then  pnpm publish  to take it live

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAssetLabels, orphanedRows, rawAssetIds, reportOrphans, reportProblems } from './assetLabels.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = path.join(__dirname, '..', 'public', 'assets', 'manifest.json')

type Asset = { id: string; c: string; l: string; tags?: string[] }
type Manifest = { version: number; generated: string; categories: { id: string; label: string; count: number }[]; assets: Asset[] }

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Manifest
const { labels, problems } = await loadAssetLabels()
if (problems.length > 0) {
  reportProblems(problems)
  process.exit(1)
}
let relabelled = 0
let removed = 0
const assets: Asset[] = []
for (const asset of manifest.assets) {
  const entry = labels.get(asset.id)
  if (entry?.remove) {
    removed++
    continue
  }
  if (entry) {
    if (entry.label && entry.label !== asset.l) relabelled++
    assets.push({ ...asset, l: entry.label || asset.l, tags: entry.tags })
  } else assets.push(asset)
}
const counts = new Map<string, number>()
for (const a of assets) counts.set(a.c, (counts.get(a.c) ?? 0) + 1)
const next: Manifest = {
  ...manifest,
  version: Date.now(),
  generated: new Date().toISOString(),
  categories: manifest.categories.map((c) => ({ ...c, count: counts.get(c.id) ?? 0 })),
  assets,
}
await writeFile(MANIFEST_PATH, JSON.stringify(next, null, 2))
const unlabelled = assets.filter((a) => !labels.has(a.id)).map((a) => a.id)
console.log(`${assets.length} assets: ${relabelled} relabelled, ${removed} removed, ${unlabelled.length} with no row in asset-labels.tsv`)
if (unlabelled.length > 0) console.log(`  no row yet (label from filename): ${unlabelled.join(', ')}`)

// the quiet failure: a row for an asset that no longer exists
const known = await rawAssetIds()
if (known) reportOrphans(orphanedRows(labels, known))
else console.log('(no raw files here — orphaned rows not checked)')
