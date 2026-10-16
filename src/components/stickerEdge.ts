import { cleanAlpha } from '../cutting/maskCleanup'

// The sticker edge: a cut-out drawn as a die-cut sticker, a rim of the
// theme's paper round its silhouette, as Build.dc.html draws it with four
// 3px drop-shadows. Here it's a sprite per layer — the edge, then the image
// on top — built once per (erased) image, crop and radius, and drawn with a
// single drawImage per frame, so the Konva shadow under it is the only
// shadow and the per-frame cost is what it was without the edge.
//
// The edge is the layer's alpha mask grown by the radius:
//   1. a working copy of the crop at about one pixel per canvas unit — the
//      export's resolution, and the screen's on a phone — padded so there's
//      room for the rim, and at most WORK_MAX_PX on its long side
//   2. cleanAlpha, so a stray speck from an old cut doesn't grow a blob and
//      a faint halo doesn't grow a ring
//   3. alpha ≥ 128 is inside
//   4. a Euclidean distance transform (Felzenszwalb & Huttenlocher, two
//      passes, linear time)
//   5. alpha = smoothstep across the rim's outer line, one pixel wide
//   6. scaled up into a canvas the crop's size plus the padding, in the
//      source's own pixels, and the image drawn on top
//
// The maths (steps 2–5) is DOM-free and exported for the tests; only the
// sprite builder touches canvases.

// the working copy's long side at most: one DT over ~260k pixels. Most
// layers are well under it — a layer 300 canvas units across works on ~300px
const WORK_MAX_PX = 512
// …but never so coarse that the rim is under this many working pixels
const WORK_MIN_RADIUS = 2
// what counts as inside, as the mask clean-up's own threshold
const INSIDE_ALPHA = 128
const FAR = 1e20

// ---------- the maths

// The squared distance transform of one row or column (Felzenszwalb &
// Huttenlocher): d[q] = min over p of (q − p)² + f[p]. v and z are scratch:
// the parabolas of the lower envelope and the boundaries between them.
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    const fq = f[q]! + q * q
    let p = v[k]!
    let s = (fq - (f[p]! + p * p)) / (2 * (q - p))
    while (s <= z[k]!) {
      k--
      p = v[k]!
      s = (fq - (f[p]! + p * p)) / (2 * (q - p))
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++
    const p = v[k]!
    d[q] = (q - p) * (q - p) + f[p]!
  }
}

// For every pixel, the squared Euclidean distance to the nearest inside
// pixel (centre to centre): 0 inside, ≥ 1e20 everywhere when nothing is.
export function squaredDistance(inside: Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h)
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  // columns first, then rows: the 2D transform separates
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = inside[y * w + x] ? 0 : FAR
    edt1d(f, h, d, v, z)
    for (let y = 0; y < h; y++) out[y * w + x] = d[y]!
  }
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) f[x] = out[row + x]!
    edt1d(f, w, d, v, z)
    for (let x = 0; x < w; x++) out[row + x] = d[x]!
  }
  return out
}

// The inside grown by `radius` px, as alpha 0–255. An inside pixel's own
// edge is half a pixel out from its centre, so the rim's outer line is at
// radius + ½ from the nearest inside centre; it's antialiased across one
// pixel there — full to radius, gone by radius + 1.
export function dilate(inside: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(w * h)
  const sq = squaredDistance(inside, w, h)
  const full = radius * radius
  const none = (radius + 1) * (radius + 1)
  for (let i = 0; i < out.length; i++) {
    const s = sq[i]!
    if (s <= full) out[i] = 255
    else if (s < none) {
      // smoothstep from radius + 1 (0) to radius (1)
      const t = radius + 1 - Math.sqrt(s)
      out[i] = Math.round(t * t * (3 - 2 * t) * 255)
    }
  }
  return out
}

// The edge's alpha for RGBA pixels: the mask cleaned (in place — this is a
// working copy), thresholded, grown by `radius`.
export function edgeAlpha(rgba: Uint8ClampedArray, w: number, h: number, radius: number): Uint8Array {
  cleanAlpha(rgba, w, h)
  const inside = new Uint8Array(w * h)
  for (let i = 0; i < inside.length; i++) inside[i] = rgba[i * 4 + 3]! >= INSIDE_ALPHA ? 1 : 0
  return dilate(inside, w, h, radius)
}

// The rim's radius in the source image's pixels, for a theme width in theme
// px (on a 400px frame) — the same on screen whatever the layer's scale, as
// the shadow is. Rounded to eighths of an octave, so a nudge of the scale
// doesn't rebuild the sprite; and capped, so a layer shrunk to a speck
// doesn't grow a rim many times its own size.
export function stickerRadius(
  unitsPerThemePx: number,
  themeWidth: number,
  unitsPerSourcePx: number,
  scale: number,
  cropLongSide: number,
): number {
  const r = (themeWidth * unitsPerThemePx) / Math.max(unitsPerSourcePx * scale, 1e-6)
  if (!(r > 0) || !Number.isFinite(r)) return 0
  const stepped = 2 ** (Math.round(Math.log2(r) * 8) / 8)
  return Math.min(Math.round(stepped * 100) / 100, Math.max(1, cropLongSide / 4))
}

// ---------- the sprite

export type SourceRect = { x: number; y: number; width: number; height: number }

export type StickerSprite = {
  // the edge with the crop of the image on top, in source pixels
  canvas: HTMLCanvasElement
  // source pixels of padding on every side: the crop starts at (pad, pad)
  pad: number
  // how long it took to build
  ms: number
}

type Source = HTMLImageElement | HTMLCanvasElement

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

// `rimWorkPx`: how many working pixels the rim is across — the rim's width
// in canvas units, for a pixel per unit. The working copy is scaled to
// match; the sprite itself stays in the source's pixels.
export function buildStickerSprite(
  source: Source,
  src: SourceRect,
  radius: number,
  color: string,
  rimWorkPx: number,
): StickerSprite | null {
  const started = performance.now()
  const pad = Math.ceil(radius + 2)
  const sw = Math.ceil(src.width) + 2 * pad
  const sh = Math.ceil(src.height) + 2 * pad
  const k = Math.min(1, WORK_MAX_PX / Math.max(sw, sh), Math.max(rimWorkPx, WORK_MIN_RADIUS) / radius)
  const gw = Math.max(1, Math.ceil(sw * k))
  const gh = Math.max(1, Math.ceil(sh * k))

  const work = newCanvas(gw, gh)
  const wctx = work.getContext('2d', { willReadFrequently: true })
  if (!wctx) return null
  wctx.drawImage(source, src.x, src.y, src.width, src.height, pad * k, pad * k, src.width * k, src.height * k)
  let data: ImageData
  try {
    data = wctx.getImageData(0, 0, gw, gh)
  } catch {
    // tainted: no mask to grow — the layer draws as before
    return null
  }
  const alpha = edgeAlpha(data.data, gw, gh, radius * k)
  const px = data.data
  for (let i = 0; i < alpha.length; i++) {
    px[i * 4] = 0
    px[i * 4 + 1] = 0
    px[i * 4 + 2] = 0
    px[i * 4 + 3] = alpha[i]!
  }
  wctx.putImageData(data, 0, 0)
  // any CSS colour, through the canvas rather than a parser of our own
  wctx.globalCompositeOperation = 'source-in'
  wctx.fillStyle = color
  wctx.fillRect(0, 0, gw, gh)

  const canvas = newCanvas(sw, sh)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(work, 0, 0, gw / k, gh / k)
  ctx.drawImage(source, src.x, src.y, src.width, src.height, pad, pad, src.width, src.height)
  work.width = 0
  work.height = 0

  const ms = performance.now() - started
  try {
    performance.measure('sticker-edge', { start: started, duration: ms, detail: { w: sw, h: sh, work: [gw, gh] } })
  } catch {
    // timing only
  }
  return { canvas, pad, ms }
}

// Sprites by source image, then crop, radius and colour. The source is the
// layer's erased canvas — rebuilt whenever its strokes change — or its image
// when nothing's erased, so a new erase set gets a new edge and duplicates
// share one. A few per source, for a crop or scale being tried back and forth.
const PER_SOURCE = 4
const sprites = new WeakMap<object, Map<string, StickerSprite | null>>()

export function stickerSprite(
  source: Source,
  src: SourceRect,
  radius: number,
  color: string,
  rimWorkPx: number,
  // the builder, for the tests
  build: typeof buildStickerSprite = buildStickerSprite,
): StickerSprite | null {
  const key = `${src.x},${src.y},${src.width},${src.height}|${radius}|${rimWorkPx}|${color}`
  let bySource = sprites.get(source)
  if (!bySource) {
    bySource = new Map()
    sprites.set(source, bySource)
  }
  if (bySource.has(key)) {
    const known = bySource.get(key)!
    // most recently used goes last
    bySource.delete(key)
    bySource.set(key, known)
    return known
  }
  const sprite = build(source, src, radius, color, rimWorkPx)
  bySource.set(key, sprite)
  // another layer may still be drawing an evicted sprite: let it go to the
  // collector rather than empty it
  if (bySource.size > PER_SOURCE) bySource.delete(bySource.keys().next().value!)
  return sprite
}
