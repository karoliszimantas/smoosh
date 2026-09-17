import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { LayerItem } from './layerItem'

const LONG_PRESS_MS = 400
// pointer movement past this, before the long-press timer fires, cancels the
// long-press so an ordinary horizontal swipe still scrolls the strip
const MOVE_CANCEL_PX = 8

// which chip is being dragged, and the live display-order while dragging —
// kept in state (not a ref) because it's read during render for styling
type DragState = { id: string; order: string[] } | null

export default function LayerStrip({
  items,
  selectedId,
  onSelect,
  onReorder,
}: {
  items: LayerItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onReorder: (items: LayerItem[]) => void
}) {
  // front (top of stack, last array index) first — reading order matches
  // "what's in front"
  const displayItems = useMemo(() => [...items].reverse(), [items])

  const [drag, setDrag] = useState<DragState>(null)
  const longPressTimer = useRef<number | null>(null)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const isLongPressing = useRef(false)
  // a drag ending still fires a synthetic click on the chip afterwards —
  // suppress exactly that one click so it doesn't also select the layer
  const justDragged = useRef(false)
  const chipRefs = useRef(new Map<string, HTMLButtonElement>())

  const orderedIds = drag?.order ?? displayItems.map((i) => i.id)
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const orderedDisplayItems = orderedIds
    .map((id) => byId.get(id))
    .filter((i): i is LayerItem => i !== undefined)

  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const updateDragPosition = (clientX: number, current: { id: string; order: string[] }) => {
    let targetIndex = current.order.indexOf(current.id)
    let bestDist = Infinity
    for (const [chipId, el] of chipRefs.current) {
      const rect = el.getBoundingClientRect()
      const center = rect.left + rect.width / 2
      const dist = Math.abs(clientX - center)
      if (dist < bestDist) {
        bestDist = dist
        targetIndex = current.order.indexOf(chipId)
      }
    }

    const currentIndex = current.order.indexOf(current.id)
    if (targetIndex < 0 || targetIndex === currentIndex) return

    const next = current.order.slice()
    next.splice(currentIndex, 1)
    next.splice(targetIndex, 0, current.id)
    setDrag({ id: current.id, order: next })
  }

  const finalizeDrag = (current: { id: string; order: string[] }) => {
    const reordered = current.order
      .slice()
      .reverse() // back to z-order: back of stack first
      .map((id) => byId.get(id))
      .filter((i): i is LayerItem => i !== undefined)
    onReorder(reordered)
  }

  const handlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const target = e.currentTarget
    const pointerId = e.pointerId
    pointerStart.current = { x: e.clientX, y: e.clientY }
    clearLongPress()
    isLongPressing.current = true
    longPressTimer.current = window.setTimeout(() => {
      isLongPressing.current = false
      setDrag({ id, order: displayItems.map((i) => i.id) })
      target.setPointerCapture(pointerId)
    }, LONG_PRESS_MS)
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!pointerStart.current) return

    if (!drag) {
      if (isLongPressing.current) {
        const dx = e.clientX - pointerStart.current.x
        const dy = e.clientY - pointerStart.current.y
        if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
          clearLongPress()
          isLongPressing.current = false
        }
      }
      return
    }

    e.preventDefault()
    updateDragPosition(e.clientX, drag)
  }

  const endPointer = () => {
    clearLongPress()
    isLongPressing.current = false
    if (drag) {
      justDragged.current = true
      finalizeDrag(drag)
      setDrag(null)
    }
    pointerStart.current = null
  }

  if (items.length < 2) return null

  return (
    <div className="layer-strip">
      <span className="layer-strip-label">Front</span>
      <div className="layer-strip-scroll">
        {orderedDisplayItems.map((item, index) => (
          <button
            key={item.id}
            ref={(el) => {
              if (el) chipRefs.current.set(item.id, el)
              else chipRefs.current.delete(item.id)
            }}
            className={`layer-chip${item.id === selectedId ? ' selected' : ''}${
              drag?.id === item.id ? ' dragging' : ''
            }`}
            aria-label={`Layer ${index + 1} of ${orderedDisplayItems.length}, ${item.label}`}
            onClick={() => {
              if (justDragged.current) {
                justDragged.current = false
                return
              }
              onSelect(item.id)
            }}
            onPointerDown={(e) => handlePointerDown(e, item.id)}
            onPointerMove={handlePointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          >
            <img src={item.thumb} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      <span className="layer-strip-label">Back</span>
    </div>
  )
}
