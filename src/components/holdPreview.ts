// Hold a card's picture in the asset sheet to see it large; slide to see
// the next. The rules, with no DOM: useHoldPreview wires them to the grid.
//
// Nothing here places anything. A release only ever hides the preview, and
// says whether a preview was showing, so the click that may follow it is
// swallowed rather than landing on whatever the finger lifted over.

import type { SearchResult } from '../assets'

// what the preview fetches: the cut-out, or the whole picture when nobody
// has cut it yet — the same image the card's thumbnail was made from
export function fullOf(result: SearchResult): string | null {
  const full = result.cut?.full ?? result.rect?.full ?? null
  return full === result.thumb ? null : full
}

// still this long and it's a hold: past a tap, short of feeling slow
export const HOLD_MS = 350
// travel more than this first and it's a scroll, not a hold (the layer
// strip's pick-up uses the same)
export const HOLD_SLOP_PX = 8
// the preview rests on an asset this long before its full image is fetched,
// so a slide across a row fetches nothing until it stops
export const FULL_DWELL_MS = 150

type Timers = { set: (fn: () => void, ms: number) => number; clear: (id: number) => void }
const windowTimers: Timers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
}

export class HoldGesture {
  private pending: { id: number; x: number; y: number; key: string; timer: number } | null = null
  private active: { id: number; key: string } | null = null

  private readonly show: (key: string) => void
  private readonly hide: () => void
  private readonly timers: Timers

  constructor(show: (key: string) => void, hide: () => void, timers: Timers = windowTimers) {
    this.show = show
    this.hide = hide
    this.timers = timers
  }

  get previewing(): boolean {
    return this.active !== null
  }

  // a hold under way or showing: the long-press menu is ours to stop
  get holding(): boolean {
    return this.pending !== null || this.active !== null
  }

  // a finger (or button) down on a card's picture
  down(id: number, x: number, y: number, key: string): void {
    // a second finger: a pinch or a slip, never a hold
    if (this.pending || this.active) {
      if (this.pending && this.pending.id !== id) this.cancelPending()
      return
    }
    const timer = this.timers.set(() => {
      const p = this.pending
      if (!p || p.timer !== timer) return
      this.pending = null
      this.active = { id: p.id, key: p.key }
      this.show(p.key)
    }, HOLD_MS)
    this.pending = { id, x, y, key, timer }
  }

  // `keyAt` is asked only while a preview shows: the card under the finger,
  // or null between cards (the preview stays where it was)
  move(id: number, x: number, y: number, keyAt: () => string | null): void {
    const p = this.pending
    if (p && p.id === id && Math.hypot(x - p.x, y - p.y) > HOLD_SLOP_PX) this.cancelPending()
    const a = this.active
    if (!a || a.id !== id) return
    const key = keyAt()
    if (key !== null && key !== a.key) {
      a.key = key
      this.show(key)
    }
  }

  // true when a preview was showing: swallow the click that follows
  up(id: number): boolean {
    if (this.pending?.id === id) this.cancelPending()
    if (this.active?.id !== id) return false
    this.active = null
    this.hide()
    return true
  }

  dispose(): void {
    this.cancelPending()
    if (this.active) {
      this.active = null
      this.hide()
    }
  }

  private cancelPending(): void {
    if (this.pending) this.timers.clear(this.pending.timer)
    this.pending = null
  }
}

// Asks for something only once it has been wanted, unchanged, for `ms`:
// the full image of the asset the preview has stopped on.
export class Dwell {
  private timer: number | null = null
  private wanted: string | null = null

  private readonly ms: number
  private readonly fire: (url: string) => void
  private readonly timers: Timers

  constructor(ms: number, fire: (url: string) => void, timers: Timers = windowTimers) {
    this.ms = ms
    this.fire = fire
    this.timers = timers
  }

  want(url: string | null): void {
    if (url === this.wanted) return
    this.wanted = url
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
    if (url === null) return
    this.timer = this.timers.set(() => {
      this.timer = null
      this.fire(url)
    }, this.ms)
  }

  dispose(): void {
    this.want(null)
  }
}
