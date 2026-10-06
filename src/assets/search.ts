import type { Asset, PixabayHit, SearchResult } from './types'

// ---------- prompt → tabs

// Function words, plus the verbs and modifiers the prompt generator uses
// that name nothing you could pick from a library — "Crab Performing Heart
// Surgery" is Crab · Heart · Surgery. Verbs that do name a thing stay:
// "Chainsawing" finds the chainsaw (assetSearch tries it without -ing).
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'at', 'and', 'or', 'with', 'to', 'for', 'on',
  'as', 'is', 'are', 'by', 'from', 'into', 'its', 'his', 'her', 'their',
  'over', 'about', 'very', 'everyone',
  'performing', 'doing', 'having', 'getting', 'making', 'taking', 'being',
  'playing', 'singing', 'juggling', 'stealing', 'pushing', 'directing', 'unclogging',
  'hoarding', 'guarding', 'licking', 'hugging', 'riding', 'packing', 'drinking',
  'selling', 'blowing', 'carrying', 'eating', 'fighting', 'starting', 'racing',
  'robbing', 'arguing', 'wearing', 'holding', 'working', 'sitting', 'standing',
  'giant', 'tiny', 'mysterious', 'stolen', 'whole', 'full', 'last', 'awkward', 'first', 'panic',
])

export type PromptTab = { label: string; term: string }

// "Vampire Bunny Hotel Reception" → Vampire | Bunny | Hotel | Reception,
// in prompt order, each word once
export function promptTabs(prompt: string): PromptTab[] {
  const tabs: PromptTab[] = []
  const seen = new Set<string>()
  for (const raw of prompt.split(/[^\p{L}\p{N}']+/u)) {
    const word = raw.replace(/'s$/i, '').replace(/^'+|'+$/g, '')
    const term = word.toLowerCase()
    if (term.length < 2 || STOPWORDS.has(term) || seen.has(term)) continue
    seen.add(term)
    tabs.push({ label: word.charAt(0).toUpperCase() + word.slice(1), term })
  }
  return tabs
}

// ---------- curated (tier 1) matching

// crude singular form so "goats" finds the curated "Goat" and vice versa
export function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 3 && /(s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(stem)
}

// A curated asset matches when every word of the term appears in its label
// or category ("goat" → the Goat; "backgrounds" → every background).
export function matchesCurated(asset: Asset, categoryLabel: string, term: string): boolean {
  const wanted = words(term)
  if (wanted.length === 0) return false
  const have = new Set([...words(asset.label), ...words(asset.category), ...words(categoryLabel)])
  return wanted.every((w) => have.has(w))
}

// cut.ts names curated files "<slug>-<pixabayId>", so the id survives as the
// asset id's trailing number — enough to dedupe a curated goat against the
// same goat coming back from Pixabay
export function curatedPixabayId(assetId: string): number | null {
  const match = /-(\d{4,})$/.exec(assetId)
  return match?.[1] ? Number(match[1]) : null
}

// ---------- backgrounds

const BACKGROUND_WORDS = new Set(
  [
    'background', 'landscape', 'scenery', 'scene', 'sky', 'clouds', 'mountain', 'beach', 'sea', 'ocean',
    'forest', 'field', 'meadow', 'desert', 'lake', 'river', 'city', 'cityscape', 'skyline', 'street',
    'room', 'interior', 'kitchen', 'office', 'lobby', 'hall', 'bedroom', 'restaurant', 'park', 'garden',
    'panorama', 'sunset', 'sunrise', 'horizon', 'space', 'galaxy', 'stage', 'wallpaper', 'texture',
  ].map(stem),
)

function looksLikeBackground(tags: string, w: number, h: number): boolean {
  // a cut subject is rarely what someone wants from a wide shot of a place
  return w / h >= 1.2 && words(tags).some((t) => BACKGROUND_WORDS.has(t))
}

// ---------- merge

export function labelFromTags(tags: string): string {
  const first = tags.split(',')[0]?.trim() ?? ''
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Image'
}

export function curatedResult(asset: Asset): SearchResult {
  const isBackground = asset.category === 'backgrounds'
  const image = { full: asset.full, thumb: asset.thumb }
  return {
    key: `local:${asset.id}`,
    tier: 1,
    label: asset.label,
    pixabayId: curatedPixabayId(asset.id),
    thumb: asset.thumb,
    // curated backgrounds were never cut (see tools/cut.ts) — they're the
    // rectangle; everything else in the manifest is the cut, and the
    // original rectangle isn't published
    cut: isBackground ? null : image,
    rect: isBackground ? image : null,
    isBackground,
  }
}

export function pixabayResult(hit: PixabayHit): SearchResult {
  return {
    key: `pixabay:${hit.id}`,
    tier: hit.cut ? 2 : 3,
    label: labelFromTags(hit.tags),
    pixabayId: hit.id,
    thumb: hit.cut?.thumb ?? hit.thumb,
    cut: hit.cut,
    rect: { full: hit.full, thumb: hit.thumb },
    isBackground: looksLikeBackground(hit.tags, hit.w, hit.h),
  }
}

// One list, fastest first: curated, then already-cut, then uncut. Each
// Pixabay id appears once — in its cut state if it has one.
export function mergeResults(curated: readonly Asset[], hits: readonly PixabayHit[]): SearchResult[] {
  const seen = new Set<number>()
  const tier1: SearchResult[] = []
  for (const asset of curated) {
    const result = curatedResult(asset)
    if (result.pixabayId !== null) seen.add(result.pixabayId)
    tier1.push(result)
  }
  const tier2: SearchResult[] = []
  const tier3: SearchResult[] = []
  for (const hit of hits) {
    if (seen.has(hit.id)) continue
    seen.add(hit.id)
    const result = pixabayResult(hit)
    ;(result.tier === 2 ? tier2 : tier3).push(result)
  }
  return [...tier1, ...tier2, ...tier3]
}
