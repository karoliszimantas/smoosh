import type { Asset } from './assets/types'
import { stem } from './assets/search'

// Searching the curated library as you type: label and tags, best first —
// the whole label, then a word of it, then a tag, then a word starting the
// same way, then a near-miss spelling. Instant on every keystroke.
//
// A plain scan over a flat array: each search is one pass over every asset
// and its few dozen words. At 530 assets that's well under a millisecond on
// a phone; it stays comfortably under a frame up to roughly 10,000. Past
// that, a prefix index (words → assets) built once at load is the next step
// — still no library needed.

type Entry = {
  asset: Asset
  label: string
  labelWords: string[]
  tags: string[]
  tagWords: string[]
  categoryWords: string[]
}

export type AssetIndex = readonly Entry[]

function split(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

export function buildIndex(assets: readonly { asset: Asset; categoryLabel: string }[]): AssetIndex {
  return assets.map(({ asset, categoryLabel }) => {
    const tags = asset.tags.map((t) => t.toLowerCase())
    return {
      asset,
      label: split(asset.label).join(' '),
      labelWords: split(asset.label).map(stem),
      tags,
      tagWords: [...new Set(tags.flatMap(split).map(stem))],
      categoryWords: [...split(asset.category), ...split(categoryLabel)].map(stem),
    }
  })
}

// one typo for a word of 4+ letters, two for 8+
function near(a: string, b: string): boolean {
  if (a.length < 4) return false
  const allowed = a.length >= 8 ? 2 : 1
  if (Math.abs(a.length - b.length) > allowed) return false
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    if (Math.min(...row) > allowed) return false
    prev = row
  }
  return (prev[b.length] ?? Infinity) <= allowed
}

// a typed word, and the forms it might have in the library: "goats" →
// goat, "chainsawing" → chainsaw, "grilling" → grill
function variants(word: string): string[] {
  const out = new Set([stem(word)])
  const ing = /^(.{3,}?)(\w)\2?ing$/.exec(word)
  if (ing?.[1] && ing[2]) {
    out.add(word.slice(0, -3))
    out.add(`${ing[1]}${ing[2]}`)
    out.add(`${word.slice(0, -3)}e`)
  }
  return [...out]
}

// how well one typed word fits an asset — 0: not at all
function wordScore(e: Entry, word: string, last: boolean): number {
  let best = 0
  for (const w of variants(word)) {
    if (e.labelWords.includes(w)) best = Math.max(best, 60)
    else if (e.tagWords.includes(w)) best = Math.max(best, 40)
    // the word being typed is still unfinished — "cra" should find crab
    else if (last && w.length >= 2 && e.labelWords.some((l) => l.startsWith(w))) best = Math.max(best, 30)
    else if (last && w.length >= 2 && e.tagWords.some((t) => t.startsWith(w))) best = Math.max(best, 20)
    else if (e.labelWords.some((l) => near(w, l))) best = Math.max(best, 12)
    else if (e.tagWords.some((t) => near(w, t))) best = Math.max(best, 8)
    else if (e.categoryWords.includes(w)) best = Math.max(best, 5)
  }
  return best
}

// Every typed word must fit somewhere; the closer the fit, the higher up.
export function searchAssets(index: AssetIndex, query: string): Asset[] {
  const words = split(query)
  if (words.length === 0) return []
  const whole = words.join(' ')
  const scored: { asset: Asset; score: number }[] = []
  for (const e of index) {
    let score = e.label === whole ? 100 : e.tags.includes(whole) ? 70 : 0
    let all = true
    for (let i = 0; i < words.length; i++) {
      const s = wordScore(e, words[i] ?? '', i === words.length - 1)
      if (s === 0) {
        all = false
        break
      }
      score += s
    }
    if (all) scored.push({ asset: e.asset, score })
  }
  return scored.sort((a, b) => b.score - a.score || a.asset.label.localeCompare(b.asset.label)).map((s) => s.asset)
}
