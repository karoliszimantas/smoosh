export type Category = {
  id: string
  label: string
  count: number
}

export type Asset = {
  id: string
  category: string
  full: string
  thumb: string
  w: number
  h: number
  label: string
  // search words beyond the label (synonyms, plurals, related things) —
  // absent from manifests published before tags existed
  tags: string[]
}

export type AssetSource = {
  id: string
  listCategories(): Promise<Category[]>
  browse(categoryId: string): Promise<Asset[]>
}

// ---------- search (prompt-word tabs + Pixabay)

// A placeable image: either a cut (transparent background) or the full
// rectangular photo. `full` is what goes on the canvas, `thumb` is what the
// layer strip shows.
export type ImageVariant = {
  full: string
  thumb: string
}

// One card in the search sheet. Tiers merge into a single list:
//   1 — curated assets from the manifest (already cut, except backgrounds)
//   2 — Pixabay images some player has already cut (shared library)
//   3 — Pixabay images nobody has cut yet (cut on this device, on demand)
export type SearchResult = {
  key: string
  tier: 1 | 2 | 3
  label: string
  // null for curated assets that aren't traceable to a Pixabay id
  pixabayId: number | null
  // the card's thumbnail — the cut version whenever one exists
  thumb: string
  // ready-to-place cut, if one exists already (tiers 1 and 2)
  cut: ImageVariant | null
  // the whole rectangular image, if we have it (always for Pixabay results;
  // only backgrounds for curated assets, whose originals aren't published)
  rect: ImageVariant | null
  // landscapes, rooms, skies… — the UI defaults these to Full, never Cut
  isBackground: boolean
}

export type PixabayHit = {
  id: number
  w: number
  h: number
  tags: string
  thumb: string
  full: string
  cut: ImageVariant | null
}

export type SearchPage = {
  query: string
  page: number
  totalHits: number
  hits: PixabayHit[]
}
