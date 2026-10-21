import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SearchResult } from '../assets'
import { Dwell, FULL_DWELL_MS, fullOf } from './holdPreview'
import type { PreviewStore } from './useHoldPreview'

// full images seen once on this page: the browser has them, so coming back
// to one shows it at once, with no wait and no fade
const seenFull = new Set<string>()

// The held asset, large, over the dimmed sheet. The thumbnail (already
// loaded, it's on the card) fills the box at once, scaled up; the full image
// lands on top of it in the same box once the finger has stopped on it — so
// nothing moves or pops, and if it never arrives the thumbnail simply stays.
// The checkerboard behind it is the /labels one: a cut-out's edges vanish
// against a plain colour.
export default function AssetPreview({ store, results }: { store: PreviewStore; results: readonly SearchResult[] }) {
  const key = useSyncExternalStore(store.subscribe, store.get)
  const result = key === null ? undefined : results.find((r) => r.key === key)
  const full = result ? fullOf(result) : null

  const [requested, setRequested] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const dwell = useRef<Dwell | null>(null)
  useEffect(() => {
    const d = new Dwell(FULL_DWELL_MS, setRequested)
    dwell.current = d
    return () => d.dispose()
  }, [])
  useEffect(() => {
    dwell.current?.want(full !== null && !seenFull.has(full) ? full : null)
  }, [full])

  if (!result) return null
  const showFull = full !== null && (requested === full || seenFull.has(full))
  return (
    // decorative: each card's picture already carries its label
    <div className="asset-preview" aria-hidden="true">
      <div className="asset-preview-picture">
        <img className="asset-preview-thumb" src={result.thumb} alt="" draggable={false} />
        {showFull && (
          <img
            key={full}
            className={`asset-preview-full${loaded === full || seenFull.has(full) ? ' loaded' : ''}`}
            src={full}
            alt=""
            draggable={false}
            decoding="async"
            onLoad={() => {
              seenFull.add(full)
              setLoaded(full)
            }}
          />
        )}
      </div>
      <p className="asset-preview-label">{result.label}</p>
    </div>
  )
}
