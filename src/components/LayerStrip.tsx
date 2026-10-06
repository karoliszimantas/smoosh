import { useEffect, useMemo, useState } from 'react'
import type { LayerItem } from './layerItem'
import { isPhotoSrc, photoUrl } from '../photos/photoStore'

// a layer's thumbnail — a player's own photo has no URL of its own, so it's
// looked up on this device first
function Thumb({ src }: { src: string }) {
  const [photo, setPhoto] = useState<string | null>(null)
  useEffect(() => {
    if (!isPhotoSrc(src)) return
    let live = true
    photoUrl(src).then(
      (url) => live && setPhoto(url),
      () => {},
    )
    return () => {
      live = false
    }
  }, [src])
  const shown = isPhotoSrc(src) ? photo : src
  return shown ? <img src={shown} alt="" loading="lazy" /> : null
}

// a locked layer's mark: fixed colours, not the theme's, so it reads on
// any thumbnail in any theme
function Padlock() {
  return (
    <span className="layer-chip-lock" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 11V7a4 4 0 0 1 8 0v4M5 11h14v10H5z" />
      </svg>
    </span>
  )
}

// selection and a depth readout only — reordering happens on the canvas
// itself (long-press a layer, slide up/down), so there's one way to do it
export default function LayerStrip({
  items,
  selectedId,
  onSelect,
}: {
  items: LayerItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  // front (top of stack, last array index) first — reading order matches
  // "what's in front"
  const displayItems = useMemo(() => [...items].reverse(), [items])

  // with one layer there's nothing to choose between — unless it's locked:
  // the strip is the only way to select a locked layer, and so to unlock it
  if (items.length < 2 && !items.some((i) => i.locked)) return null

  return (
    <div className="layer-strip">
      <span className="layer-strip-label">Front</span>
      <div className="layer-strip-scroll">
        {displayItems.map((item, index) => (
          <button
            key={item.id}
            className={`layer-chip${item.id === selectedId ? ' selected' : ''}`}
            aria-label={`Layer ${index + 1} of ${displayItems.length}, ${item.label}${item.locked ? ', locked' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            <Thumb src={item.thumb} />
            {item.locked && <Padlock />}
          </button>
        ))}
      </div>
      <span className="layer-strip-label">Back</span>
    </div>
  )
}
