import type { EraseStroke } from './layerItem'

// The eraser works on data, not pixels: a layer's strokes are replayed onto
// a copy of its image whenever they change. A stroke is a few hundred bytes
// and survives a reload; the erased image would be megabytes.
//
// Coordinates are fractions of the full, untransformed image, so erasing
// stays glued to the picture through crop, mirror, scale and rotation, and
// through the source being swapped for a differently-sized copy.

export type BrushSize = 'S' | 'M' | 'L'
// brush diameters in screen px — big by default: the eraser fixes a lump the
// auto-cut left, it isn't for tracing
export const BRUSH_PX: Record<BrushSize, number> = { S: 20, M: 40, L: 80 }

// stamps along a path, this fraction of the radius apart — close enough
// that a fast swipe still leaves a continuous line, not a row of dots
const STAMP_SPACING = 0.25
// fully erased out to this fraction of the radius, then a soft fade to the edge
const SOFT_EDGE_START = 0.55

function stamp(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  // only alpha matters under destination-out — the colour never shows
  g.addColorStop(0, 'black')
  g.addColorStop(SOFT_EDGE_START, 'black')
  g.addColorStop(1, 'transparent')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

// Stamps the segment from (x0, y0) to (x1, y1), in pixels of `ctx`'s canvas.
// The first point of a stroke is stamped by passing it as both ends.
export function eraseSegment(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
): void {
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  const dist = Math.hypot(x1 - x0, y1 - y0)
  const steps = Math.max(1, Math.ceil(dist / Math.max(0.5, r * STAMP_SPACING)))
  // the start point was already stamped by the previous segment
  for (let i = dist === 0 ? 0 : 1; i <= steps; i++) {
    const t = i / steps
    stamp(ctx, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r)
  }
  ctx.restore()
}

export function replayStroke(ctx: CanvasRenderingContext2D, stroke: EraseStroke, w: number, h: number): void {
  const r = stroke.r * w
  const p = stroke.p
  for (let i = 0; i + 1 < p.length; i += 2) {
    const x = p[i]! * w
    const y = p[i + 1]! * h
    const px = i >= 2 ? p[i - 2]! * w : x
    const py = i >= 2 ? p[i - 1]! * h : y
    eraseSegment(ctx, px, py, x, y, r)
  }
}

// Erased images, by stroke list and then source image: duplicates of a
// layer share its stroke array (until one of them is erased further), and
// so share one erased canvas rather than each building its own. Weak on
// both keys — a stroke list replaced by the next stroke lets its canvas go.
const erasedCache = new WeakMap<readonly EraseStroke[], WeakMap<HTMLImageElement, HTMLCanvasElement>>()

export function erasedFor(image: HTMLImageElement, strokes: readonly EraseStroke[]): HTMLCanvasElement {
  let byImage = erasedCache.get(strokes)
  if (!byImage) {
    byImage = new WeakMap()
    erasedCache.set(strokes, byImage)
  }
  let canvas = byImage.get(image)
  if (!canvas) {
    canvas = renderErased(image, strokes)
    byImage.set(image, canvas)
  }
  return canvas
}

// the image with every stroke replayed onto it — a new canvas; the source
// image is never touched
export function renderErased(image: HTMLImageElement, strokes: readonly EraseStroke[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.drawImage(image, 0, 0)
  for (const stroke of strokes) replayStroke(ctx, stroke, canvas.width, canvas.height)
  return canvas
}

// keeps stored strokes small: 4 decimals is ~0.1px on a 1024px image
export function roundCoord(v: number): number {
  return Math.round(v * 10000) / 10000
}
