import type { LabelRow } from '@smoosh/protocol'
import { stem } from '../assets/search'

// Tagging help for the /labels tool — suggestions only, never applied by
// itself. Pure, so it's tested without a page.

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1)
    .map(stem)
}

// Tags other assets with a similar label use — the second pug is offered
// the first pug's tags. Similar: the same label, or a word of it in common
// (a whole-label match counts for more). Most used first.
export function suggestTags(label: string, rows: readonly LabelRow[], exceptId: string, have: readonly string[]): string[] {
  const mine = new Set(words(label))
  if (mine.size === 0) return []
  const wanted = label.trim().toLowerCase()
  const score = new Map<string, number>()
  for (const r of rows) {
    if (r.id === exceptId || r.remove) continue
    const weight = r.label.toLowerCase() === wanted ? 3 : words(r.label).some((w) => mine.has(w)) ? 1 : 0
    if (weight === 0) continue
    for (const t of r.tags) score.set(t, (score.get(t) ?? 0) + weight)
  }
  const taken = new Set(have)
  return [...score]
    .filter(([t]) => !taken.has(t))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t)
    .slice(0, 12)
}

// every tag in use, and on how many assets
export function tagVocabulary(rows: readonly LabelRow[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const r of rows) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  return counts
}

// The vocabulary that fits what's being typed — reuse "bird" rather than
// invent "birdie". Starting with it first, then containing it; most used first.
export function completeTag(typed: string, vocabulary: ReadonlyMap<string, number>, have: readonly string[]): string[] {
  const q = typed.trim().toLowerCase()
  if (!q) return []
  const taken = new Set(have)
  const fits = [...vocabulary].filter(([t]) => !taken.has(t) && t.includes(q))
  return fits
    .sort((a, b) => Number(b[0].startsWith(q)) - Number(a[0].startsWith(q)) || b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t)
    .slice(0, 8)
}

// A tag that would be on this asset alone — usually a typo or a synonym of
// one that exists. `vocabulary` counts every asset including this one.
export function isLoneTag(tag: string, vocabulary: ReadonlyMap<string, number>, onThisAsset: boolean): boolean {
  return (vocabulary.get(tag) ?? 0) - (onThisAsset ? 1 : 0) <= 0
}
