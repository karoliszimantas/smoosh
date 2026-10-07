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

// the stack: select a layer, see what's locked, and move the selected one a
// step toward the front or back with the strip's own two ends. (Long-press
// on the canvas still jumps a layer to an exact depth.)
export default function LayerStrip({
  items,
  selectedId,
  onSelect,
  canFront,
  canBack,
  onFront,
  onBack,
}: {
  items: LayerItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  // the strip's two ends move the selected layer one step that way — the
  // stack is right here, so this is where moving within it belongs
  canFront: boolean
  canBack: boolean
  onFront: () => void
  onBack: () => void
}) {
  // front (top of stack, last array index) first — reading order matches
  // "what's in front"
  const displayItems = useMemo(() => [...items].reverse(), [items])

  // with one layer there's nothing to choose between — unless it's locked:
  // the strip is the only way to select a locked layer, and so to unlock it
  if (items.length < 2 && !items.some((i) => i.locked)) return null

  return (
    <div className="layer-strip">
      <button className="layer-strip-end" onClick={onFront} disabled={!canFront} aria-label="Move layer forward one step">
        <span aria-hidden="true">◀</span> Front
      </button>
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
      <button className="layer-strip-end" onClick={onBack} disabled={!canBack} aria-label="Move layer backward one step">
        Back <span aria-hidden="true">▶</span>
      </button>
    </div>
  )
}
