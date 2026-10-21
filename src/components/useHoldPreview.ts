import { useEffect, useState, type RefObject } from 'react'
import { haptic } from './haptic'
import { HoldGesture } from './holdPreview'

// The asset under a held finger, for AssetPreview to show. A store of its
// own rather than the sheet's state: the finger crosses a card every tenth
// of a second or so, and only the preview should redraw, never the grid.
export type PreviewStore = { get: () => string | null; subscribe: (listener: () => void) => () => void }

function createStore(): PreviewStore & { set: (key: string | null) => void } {
  let key: string | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => key,
    set: (next) => {
      if (next === key) return
      key = next
      listeners.forEach((l) => l())
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
  }
}

// a swallowed click is the one a release makes straight away — not a tap
// that comes after it
const SWALLOW_MS = 400

// Hold a card's picture to preview it, slide to preview the next, let go
// to put it away. Everything is scoped to the grid: a press elsewhere (the
// Cut and Full buttons, the tabs, the layer strip under the sheet) never
// starts one, and the layer strip's own hold listens on the strip alone.
export function useHoldPreview(gridRef: RefObject<HTMLElement | null>, enabled: boolean): PreviewStore {
  const [store] = useState(createStore)

  useEffect(() => {
    const grid = gridRef.current
    if (!grid || !enabled) return
    let shown: HTMLElement | null = null
    let frame = 0
    let last: { id: number; x: number; y: number } | null = null

    const cardOf = (key: string) => grid.querySelector<HTMLElement>(`.result-card[data-key="${CSS.escape(key)}"]`)
    const mark = (key: string | null) => {
      if (shown) delete shown.dataset.previewing
      shown = key === null ? null : cardOf(key)
      if (shown) shown.dataset.previewing = ''
    }

    const gesture = new HoldGesture(
      (key) => {
        // a tick as it opens, not on every card after
        if (grid.dataset.previewing === undefined) haptic()
        grid.dataset.previewing = ''
        mark(key)
        store.set(key)
      },
      () => {
        delete grid.dataset.previewing
        mark(null)
        store.set(null)
      },
    )

    // the card under the finger — the preview itself takes no pointer, so
    // this sees through it to the grid
    const keyAt = (x: number, y: number) => {
      const card = document.elementFromPoint(x, y)?.closest<HTMLElement>('.result-card[data-key]')
      return card && grid.contains(card) ? (card.dataset.key ?? null) : null
    }

    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary && !gesture.holding) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const card = e.target instanceof Element ? e.target.closest<HTMLElement>('.result-thumb') : null
      const key = card?.closest<HTMLElement>('.result-card[data-key]')?.dataset.key
      if (!key) return
      gesture.down(e.pointerId, e.clientX, e.clientY, key)
    }
    const onMove = (e: PointerEvent) => {
      if (!gesture.holding) return
      if (!gesture.previewing) {
        gesture.move(e.pointerId, e.clientX, e.clientY, () => null)
        return
      }
      // hit-testing once a frame, however fast the pointer reports
      last = { id: e.pointerId, x: e.clientX, y: e.clientY }
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const l = last
        if (l) gesture.move(l.id, l.x, l.y, () => keyAt(l.x, l.y))
      })
    }
    const onUp = (e: PointerEvent) => {
      if (!gesture.up(e.pointerId)) return
      // the click a release can make — over a card's Cut or Full, even —
      // goes nowhere: letting go never places
      const swallow = (c: MouseEvent) => {
        c.preventDefault()
        c.stopPropagation()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), SWALLOW_MS)
    }
    const onCancel = (e: PointerEvent) => void gesture.up(e.pointerId)
    // once the preview is up, the finger browses, the grid holds still.
    // Nothing has scrolled yet (moving first would have called the hold
    // off), so the browser still lets this stop the pan
    const onTouchMove = (e: TouchEvent) => {
      if (gesture.previewing && e.cancelable) e.preventDefault()
    }
    // Android's long-press menu and image drag, on the hold
    const onContextMenu = (e: Event) => {
      if (gesture.holding) e.preventDefault()
    }

    grid.addEventListener('pointerdown', onDown)
    grid.addEventListener('touchmove', onTouchMove, { passive: false })
    grid.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      cancelAnimationFrame(frame)
      gesture.dispose()
      grid.removeEventListener('pointerdown', onDown)
      grid.removeEventListener('touchmove', onTouchMove)
      grid.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [gridRef, enabled, store])

  return store
}
