// The arithmetic behind the layer gestures and sliders — pure, so it can be
// tested without a canvas.

export type Point = { x: number; y: number }

// An angle as a person reads it: −180 up to (not including) 180.
export function normalizeAngle(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180
}

// the shortest turn from one finger angle to the next — atan2 jumps from
// +180 to −180, which would otherwise read as a whole turn the other way
export function turnBetween(fromDeg: number, toDeg: number): number {
  return normalizeAngle(toDeg - fromDeg)
}

// Two-finger pinch/rotate turns the layer around the point between the
// fingers, not its own centre — like turning a photo on a table, which
// both spins and shifts it. The fingers moved their midpoint from m0 to m1,
// scaled by k and turned by deg; this is where the layer's position goes.
export function pivotAround(p: Point, m0: Point, m1: Point, k: number, deg: number): Point {
  const r = (deg * Math.PI) / 180
  const dx = (p.x - m0.x) * k
  const dy = (p.y - m0.y) * k
  return { x: m1.x + dx * Math.cos(r) - dy * Math.sin(r), y: m1.y + dx * Math.sin(r) + dy * Math.cos(r) }
}

// ---------- detents

// held at a detent: `push` is how far the input has carried on past it
export type Held = { at: number; push: number } | null

// the first detent strictly passed going from `from` to `to`, or null
export type DetentFinder = (from: number, to: number) => number | null

// every multiple of `spacing` (0°, 90°, 180°, 270°, …, either way round)
export function detentEvery(spacing: number): DetentFinder {
  return (from, to) => {
    if (to > from) {
      const k = (Math.floor(from / spacing) + 1) * spacing
      return k <= to ? k : null
    }
    if (to < from) {
      const k = (Math.ceil(from / spacing) - 1) * spacing
      return k >= to ? k : null
    }
    return null
  }
}

export function detentAt(at: number): DetentFinder {
  return (from, to) => ((from < at && to >= at) || (from > at && to <= at) ? at : null)
}

// Moves `value` by `delta`, catching on any detent it passes. While caught,
// movement only builds up push; push past `escape` either way and it carries
// on from the detent — a detent is easy to land on, never a wall.
export function stepDetent(
  value: number,
  delta: number,
  held: Held,
  findDetent: DetentFinder,
  escape: number,
): { value: number; held: Held; snapped: boolean } {
  if (held) {
    const push = held.push + delta
    if (Math.abs(push) < escape) return { value: held.at, held: { at: held.at, push }, snapped: false }
    return { value: held.at + push - Math.sign(push) * escape, held: null, snapped: false }
  }
  const next = value + delta
  const detent = findDetent(value, next)
  if (detent !== null) return { value: detent, held: { at: detent, push: 0 }, snapped: true }
  return { value: next, held: null, snapped: false }
}

// ---------- the rotation jog

export const JOG_MAX_DEG_PER_SEC = 300
// a thumb resting on the handle doesn't drift the layer
export const JOG_DEADZONE = 0.04
// push past a snapped angle this far to carry on — at the slowest speeds
// that's a deliberate second's push; at speed, a blink
export const ROTATION_ESCAPE_DEG = 5

// How fast the jog turns, from how far the handle is pushed (−1 … 1 of its
// travel). Steep curve: the first part of the travel is for nudging a
// degree at a time, the far end for spinning.
export function jogSpeed(displacement: number): number {
  const a = Math.min(1, Math.abs(displacement))
  if (a < JOG_DEADZONE) return 0
  const t = (a - JOG_DEADZONE) / (1 - JOG_DEADZONE)
  return Math.sign(displacement) * JOG_MAX_DEG_PER_SEC * t ** 2.5
}

// ---------- the zoom slider

// The slider's travel shows ¼× to 4× on a log scale, 1× in the middle.
// It's for precision, so it spans a narrow range finely (on a phone, a
// pixel is ~1.6% of size) rather than everything coarsely: dragging carries
// on past the ends, pinch covers the extremes, and nothing caps scale but
// the MIN_SCALE floor.
export const ZOOM_TRACK_MIN = 0.25
export const ZOOM_TRACK_MAX = 4
export const ZOOM_LOG_RANGE = Math.log(ZOOM_TRACK_MAX / ZOOM_TRACK_MIN)
// in log-scale units: ~6% of size to push off the 1× detent
export const ZOOM_ESCAPE = 0.06

// where `scale` sits along the track, 0 (bottom) … 1 (top)
export function scaleToTrack(scale: number): number {
  const t = (Math.log(scale) - Math.log(ZOOM_TRACK_MIN)) / ZOOM_LOG_RANGE
  return Math.min(1, Math.max(0, t))
}

// a vertical drag of `dyPx` on a track `trackPx` long, as a change in log
// scale — up (negative dy) enlarges
export function zoomDelta(dyPx: number, trackPx: number): number {
  return (-dyPx / Math.max(1, trackPx)) * ZOOM_LOG_RANGE
}
