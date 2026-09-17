import type { Asset, AssetSource, Category } from './types'

type ManifestAsset = {
  id: string
  c: string
  f: string
  t: string
  w: number
  h: number
  l: string
}

type Manifest = {
  version: number
  generated: string
  categories: Category[]
  assets: ManifestAsset[]
}

// The manifest is fetched over the network (from R2 in production — see
// VITE_MANIFEST_URL below) rather than bundled, so it's third-party data as
// far as the app is concerned and gets validated before use, the same as
// the Pixabay response in tools/fetch.ts.
function isCategory(value: unknown): value is Category {
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
    v.categories.every(isCategory) &&
    Array.isArray(v.assets) &&
    v.assets.every(isManifestAsset)
  )
}

function toAsset(a: ManifestAsset): Asset {
  return { id: a.id, category: a.c, full: a.f, thumb: a.t, w: a.w, h: a.h, label: a.l }
}

// Defaults to the manifest cut.ts writes locally so dev works without R2;
// production sets this to the R2-hosted manifest so the library can update
// without a code deploy (see the .gitignore note next to public/assets/*).
const MANIFEST_URL = import.meta.env.VITE_MANIFEST_URL || '/assets/manifest.json'

export class LocalAssetSource implements AssetSource {
  readonly id = 'local'
  private manifestPromise: Promise<Manifest> | null = null

  private loadManifest(): Promise<Manifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = fetch(MANIFEST_URL)
        .then((res) => {
          if (!res.ok) throw new Error(`failed to load manifest: ${res.status}`)
          return res.json() as Promise<unknown>
        })
        .then((json) => {
          if (!isManifest(json)) throw new Error('manifest has an unexpected shape')
          return json
        })
        .catch((err: unknown) => {
          // don't cache a failure — a later retry should hit the network again
          this.manifestPromise = null
          throw err
        })
    }
    return this.manifestPromise
  }

  async listCategories(): Promise<Category[]> {
    const manifest = await this.loadManifest()
    return manifest.categories
  }

  async browse(categoryId: string): Promise<Asset[]> {
    const manifest = await this.loadManifest()
    return manifest.assets.filter((a) => a.c === categoryId).map(toAsset)
  }
}
