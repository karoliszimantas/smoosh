import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { LayerItem } from './layerItem'
import { isPhotoSrc, photoUrl } from '../photos/photoStore'
import { haptic } from './haptic'
import { dropSlot, edgeScroll, partShift } from './stripReorder'

// hold a thumbnail this long to pick it up. Not a plain drag: the strip
// scrolls sideways, and a drag that started at once would never let it
const LIFT_MS = 300
// a finger that travels this far before then is scrolling, not holding
const LIFT_SLOP_PX = 8
// a lifted thumbnail this near either end of the strip scrolls it, faster
// the nearer, up to this many px a frame
const EDGE_ZONE_PX = 36
const EDGE_MAX_PX = 9

// a hold under way, not yet a pick-up
type Pending = { pointerId: number; id: string; index: number; x: number; y: number; timer: number }

// a thumbnail picked up. All in display order (0 = left = front) and
// scroll-content px, measured once at pick-up: the thumbnails are moved by
// hand, a frame at a time, and React hears of it only on the drop
type Lift = {
  pointerId: number
  id: string
  from: number
  to: number
  chips: HTMLElement[]
  // each thumbnail's left edge, and the distance from one to the next
  slots: number[]
  step: number
  // where on the thumbnail the finger holds it
  grab: number
  clientX: number
  frame: number
  // auto-scroll not yet applied, under a pixel
  carry: number
}

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

function Chevron({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

// the stack, on the desk: select a layer, see what's locked, and move the
// selected one a step toward the front or back with the strip's own two
// ends — or hold a thumbnail to pick it up and drag it to a new place,
// locked or not (a lock stops moving and deleting it on the canvas, not its
// place in the stack). Left is the front, right the back, and the two ends
// say so. (Long-press on the canvas still jumps a layer to an exact depth.)
// The selected thumbnail sits on a scrap of yellow tape.
export default function LayerStrip({
  items,
  selectedId,
  onSelect,
  canFront,
  canBack,
  onFront,
  onBack,
  canReorder,
  onReorder,
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
  // dragging a thumbnail: off while a mode owns the canvas (crop, erase)
  canReorder: boolean
  // drop: the layer `id` to index `to` of the stack (0 = back) — one change
  onReorder: (id: string, to: number) => void
}) {
  // front (top of stack, last array index) first — reading order matches
  // "what's in front"
  const displayItems = useMemo(() => [...items].reverse(), [items])

  // with one layer there's nothing to choose between — unless it's locked:
  // the strip is the only way to select a locked layer, and so to unlock it
  const hidden = items.length < 2 && !items.some((i) => i.locked)

  const scrollRef = useRef<HTMLDivElement>(null)
  // the click that ends a pick-up isn't a tap: the layer is selected already
  const swallowClick = useRef(false)
  // for the listeners, which outlive any one render
  const latest = useRef({ onSelect, onReorder, canReorder, count: items.length })
  useEffect(() => {
    latest.current = { onSelect, onReorder, canReorder, count: items.length }
  }, [onSelect, onReorder, canReorder, items.length])
  // put a lifted thumbnail back where it was, nothing changed
  const dropLift = useRef<() => void>(() => {})

  useEffect(() => {
    const strip = scrollRef.current
    if (!strip) return
    let pending: Pending | null = null
    let lift: Lift | null = null

    const cancelPending = () => {
      if (pending) window.clearTimeout(pending.timer)
      pending = null
    }

    // one frame of a drag: scroll at the ends, follow the finger, and part
    // the others round the slot it would drop into
    const frame = () => {
      const l = lift
      if (!l) return
      const box = strip.getBoundingClientRect()
      const by = edgeScroll(l.clientX, box.left, box.right, EDGE_ZONE_PX, EDGE_MAX_PX)
      // whole pixels only: the browser rounds a scroll position, so the
      // slow end of the zone (under a pixel a frame) would never move —
      // the fraction waits for the next frame instead
      l.carry = by === 0 ? 0 : l.carry + by
      const whole = Math.trunc(l.carry)
      if (whole !== 0) {
        strip.scrollLeft += whole
        l.carry -= whole
      }
      const first = l.slots[0] ?? 0
      const last = l.slots[l.slots.length - 1] ?? first
      const left = Math.min(last, Math.max(first, l.clientX - box.left + strip.scrollLeft - l.grab))
      const chip = l.chips[l.from]
      if (chip) chip.style.translate = `${left - (l.slots[l.from] ?? first)}px 0`
      const to = dropSlot(left, first, l.step, l.slots.length)
      if (to !== l.to) {
        l.to = to
        l.chips.forEach((other, i) => {
          if (i === l.from) return
          const shift = partShift(i, l.from, to, l.step)
          other.style.translate = shift ? `${shift}px 0` : ''
        })
      }
      l.frame = requestAnimationFrame(frame)
    }

    const startLift = (p: Pending) => {
      if (pending !== p) return
      pending = null
      const chips = Array.from(strip.querySelectorAll<HTMLElement>('.layer-chip'))
      const chip = chips[p.index]
      if (!chip || chip.dataset.id !== p.id) return
      const origin = strip.getBoundingClientRect().left - strip.scrollLeft
      const slots = chips.map((c) => c.getBoundingClientRect().left - origin)
      const own = slots[p.index] ?? 0
      const step = slots.length > 1 ? (slots[1] ?? 0) - (slots[0] ?? 0) : chip.offsetWidth
      lift = { pointerId: p.pointerId, id: p.id, from: p.index, to: p.index, chips, slots, step, grab: p.x - origin - own, clientX: p.x, frame: 0, carry: 0 }
      swallowClick.current = true
      strip.dataset.reorder = 'lifted'
      chip.dataset.lifted = ''
      haptic()
      latest.current.onSelect(p.id)
      lift.frame = requestAnimationFrame(frame)
    }

    const endLift = (drop: boolean) => {
      const l = lift
      if (!l) return
      lift = null
      cancelAnimationFrame(l.frame)
      // every thumbnail straight to where it now belongs, with no slide: the
      // parted ones are already there, and the new order lands this frame
      strip.dataset.reorder = 'settling'
      for (const chip of l.chips) {
        chip.style.translate = ''
        delete chip.dataset.lifted
      }
      const count = l.slots.length
      if (drop && l.to !== l.from && latest.current.count === count) {
        // display order runs front to back, the stack back to front
        const to = count - 1 - l.to
        flushSync(() => latest.current.onReorder(l.id, to))
      }
      if (drop) haptic()
      void strip.offsetWidth
      requestAnimationFrame(() => delete strip.dataset.reorder)
    }
    dropLift.current = () => endLift(false)

    const onDown = (e: PointerEvent) => {
      swallowClick.current = false
      if (!latest.current.canReorder || pending || lift) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const chip = e.target instanceof Element ? e.target.closest<HTMLElement>('.layer-chip') : null
      const id = chip?.dataset.id
      const index = Number(chip?.dataset.index)
      if (!id || !Number.isInteger(index)) return
      const p: Pending = { pointerId: e.pointerId, id, index, x: e.clientX, y: e.clientY, timer: 0 }
      p.timer = window.setTimeout(() => startLift(p), LIFT_MS)
      pending = p
    }
    const onMove = (e: PointerEvent) => {
      if (lift && e.pointerId === lift.pointerId) {
        lift.clientX = e.clientX
      } else if (pending && e.pointerId === pending.pointerId) {
        // moved before the hold was up: a scroll (the browser takes it, and
        // cancels the pointer anyway) or a slip — either way, not a pick-up
        if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > LIFT_SLOP_PX) cancelPending()
      }
    }
    const onUp = (e: PointerEvent) => {
      if (pending?.pointerId === e.pointerId) cancelPending()
      if (lift?.pointerId === e.pointerId) endLift(true)
    }
    const onCancel = (e: PointerEvent) => {
      if (pending?.pointerId === e.pointerId) cancelPending()
      if (lift?.pointerId === e.pointerId) endLift(false)
    }
    // once a thumbnail is up, the finger moves it, not the strip. Nothing has
    // scrolled yet (moving first would have called the hold off), so the
    // browser still lets this stop the pan
    const onTouchMove = (e: TouchEvent) => {
      if (lift && e.cancelable) e.preventDefault()
    }
    // Android's long-press menu, on the hold that picks a thumbnail up
    const onContextMenu = (e: Event) => {
      if (pending || lift) e.preventDefault()
    }

    strip.addEventListener('pointerdown', onDown)
    strip.addEventListener('touchmove', onTouchMove, { passive: false })
    strip.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      cancelPending()
      endLift(false)
      dropLift.current = () => {}
      strip.removeEventListener('pointerdown', onDown)
      strip.removeEventListener('touchmove', onTouchMove)
      strip.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [hidden])

  // a layer added or taken away mid-drag (a round ending, a cut landing):
  // the slots measured at pick-up are wrong now — put it back
  useEffect(() => {
    dropLift.current()
  }, [items.length])

  if (hidden) return null

  return (
    <div className="layer-strip">
      <span className="layer-strip-label" aria-hidden="true">
        Layers
      </span>
      <div className="layer-strip-side">
        <button className="icon-btn icon-btn-sm layer-strip-end" onClick={onFront} disabled={!canFront} aria-label="Move layer one step toward the front">
          <Chevron d="M15 6l-6 6 6 6" />
        </button>
        <span className="layer-strip-side-label" aria-hidden="true">
          front
        </span>
      </div>
      <div ref={scrollRef} className="layer-strip-scroll" role="listbox" aria-label="Layers, front to back" aria-orientation="horizontal">
        {displayItems.map((item, index) => {
          const selected = item.id === selectedId
          return (
            <button
              key={item.id}
              role="option"
              aria-selected={selected}
              className={`layer-chip${selected ? ' selected' : ''}`}
              data-id={item.id}
              data-index={index}
              aria-label={`Layer ${index + 1} of ${displayItems.length}, ${item.label}${item.locked ? ', locked' : ''}`}
              onClick={() => {
                if (swallowClick.current) {
                  swallowClick.current = false
                  return
                }
                onSelect(item.id)
              }}
            >
              <Thumb src={item.thumb} />
              {item.locked && <Padlock />}
            </button>
          )
        })}
      </div>
      <div className="layer-strip-side">
        <button className="icon-btn icon-btn-sm layer-strip-end" onClick={onBack} disabled={!canBack} aria-label="Move layer one step toward the back">
          <Chevron d="M9 6l6 6-6 6" />
        </button>
        <span className="layer-strip-side-label" aria-hidden="true">
          back
        </span>
      </div>
    </div>
  )
}
