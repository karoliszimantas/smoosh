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

  if (items.length < 2) return null

  return (
    <div className="layer-strip">
      <span className="layer-strip-label">Front</span>
      <div className="layer-strip-scroll">
        {displayItems.map((item, index) => (
          <button
            key={item.id}
            className={`layer-chip${item.id === selectedId ? ' selected' : ''}`}
            aria-label={`Layer ${index + 1} of ${displayItems.length}, ${item.label}`}
            onClick={() => onSelect(item.id)}
          >
            <Thumb src={item.thumb} />
          </button>
        ))}
      </div>
      <span className="layer-strip-label">Back</span>
    </div>
  )
}
