import { useMemo } from 'react'
import type { LayerItem } from './layerItem'

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
            <img src={item.thumb} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      <span className="layer-strip-label">Back</span>
    </div>
  )
}
