// Dragging a layer strip thumbnail to a new place: the sums, kept apart
// from the DOM so they can be checked. Everything is in the strip's display
// order (0 = left = front) and in scroll-content pixels.

// the slot the lifted thumbnail would drop into, from where its left edge is
// now: the nearest slot, the ends as far as it can go
export function dropSlot(left: number, firstLeft: number, step: number, count: number): number {
  if (count < 1 || step <= 0) return 0
  const slot = Math.round((left - firstLeft) / step)
  return Math.min(count - 1, Math.max(0, slot))
}

// how far thumbnail `index` moves aside while the one from `from` hovers over
// slot `to`: the ones it has passed close up behind it, one step
export function partShift(index: number, from: number, to: number, step: number): number {
  if (index === from) return 0
  if (from < index && index <= to) return -step
  if (to <= index && index < from) return step
  return 0
}

// how fast the strip scrolls with the finger this far (px) from an edge:
// nothing outside the zone, up to `max` px a frame right at the edge. Signed:
// negative scrolls back toward the start
export function edgeScroll(clientX: number, left: number, right: number, zone: number, max: number): number {
  if (right - left <= 2 * zone) return 0
  if (clientX < left + zone) return -max * Math.min(1, (left + zone - clientX) / zone)
  if (clientX > right - zone) return max * Math.min(1, (clientX - (right - zone)) / zone)
  return 0
}
