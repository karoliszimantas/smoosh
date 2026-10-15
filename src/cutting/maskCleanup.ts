// Clean-up pass for the background remover's alpha mask. The model finds the
// subject well and is sloppy around it: islands of half-opaque pixels out in
// the background, a faint haze hugging the edge, a ring of background colour
// at partial alpha (the halo). This keeps the subject, drops the rest, and
// softens the edge it leaves so the cut isn't jagged.
//
// Pure and DOM-free — it works on ImageData's .data in place, alpha only.
//
// The steps, in mask terms:
//   core   alpha ≥ threshold — where the model is fairly sure
//   keep   the core's largest component, plus any nearly as big (a hat, a
//          held ball, the other person in a two-shot); the rest are specks
//   inner  keep with its outer `erode` px stripped, where the halo lives —
//          except pixels the model was sure of, so thin opaque bits survive
//   cap    inner grown by `feather` px, then blurred by `feather` px: 255 on
//          inner, ramping to 0 over the 2·feather px outside it
//   alpha  min(alpha, cap)
//
// Why min and not multiply: inside the subject the cap is 255 and both leave
// the model's alpha alone, hair and fur included. In the ramp, min only clips
// what sticks out past the envelope, so an edge the model already drew soft
// stays exactly as soft; multiplying would fade it a second time and the
// whole cut would look a pixel thinner and washed out at the rim. Outside
// the ramp the cap is 0, which is what removes specks and far-off haze.
//
// Why grow before blurring: blurring the bare mask would pull its own edge
// down to half alpha, eating into the subject. Grown first, the blur's
// falloff lands outside it — so faint fringe right next to the subject
// (hair, a soft edge under the threshold) survives, capped, while anything
// further than 2·feather px out goes.

export type CleanupOptions = {
  // alpha at or above this counts as the model being fairly sure
  threshold: number
  // a component at least this fraction of the largest one's area is kept
  minFraction: number
  // px stripped off the kept mask's edge to pull the halo in (0–4)
  erode: number
  // never stripped by erode: alpha this high is the model being certain,
  // and thin opaque bits (a whisker, a lead, a strap) would vanish otherwise
  solidAlpha: number
  // px of soft edge allowed past the inner mask, and of ramp after that (0–4)
  feather: number
}

export const DEFAULT_CLEANUP: CleanupOptions = {
  threshold: 128,
  minFraction: 0.04,
  erode: 1,
  solidAlpha: 250,
  feather: 1,
}

export type CleanupStats = {
  // components of the core (alpha ≥ threshold)
  components: number
  kept: number
  // visible before, fully transparent now
  cleared: number
  // still visible, but fainter
  softened: number
  ms: number
}

// box filter counts live in a Uint8Array: (2·4 + 1)² = 81 fits easily
const MAX_RADIUS = 4

function radius(v: number): number {
  return Math.max(0, Math.min(MAX_RADIUS, Math.round(v)))
}

// ---------- connected components, on runs

// Labelling works on horizontal runs of core pixels rather than pixels: a
// 1024² mask is a few thousand runs, so the union-find barely registers, and
// it runs at full resolution — nothing thin gets lost to a downscale.
type Runs = {
  count: number
  x0: Int32Array
  // exclusive
  x1: Int32Array
  y: Int32Array
  // each run's component, as the index of its first run
  root: Int32Array
}

function grow(a: Int32Array): Int32Array<ArrayBuffer> {
  const b = new Int32Array(a.length * 2)
  b.set(a)
  return b
}

function findRoot(parent: Int32Array, i: number): number {
  let r = i
  while (parent[r]! !== r) {
    // path halving: every lookup flattens the tree a bit
    const g = parent[parent[r]!]!
    parent[r] = g
    r = g
  }
  return r
}

function union(parent: Int32Array, a: number, b: number): void {
  const ra = findRoot(parent, a)
  const rb = findRoot(parent, b)
  if (ra < rb) parent[rb] = ra
  else if (rb < ra) parent[ra] = rb
}

function labelRuns(rgba: Uint8ClampedArray, width: number, height: number, threshold: number): Runs {
  let cap = 1024
  let x0s = new Int32Array(cap)
  let x1s = new Int32Array(cap)
  let ys = new Int32Array(cap)
  let parent = new Int32Array(cap)
  let count = 0
  let prevStart = 0
  let prevEnd = 0

  for (let y = 0; y < height; y++) {
    const rowStart = count
    let j = prevStart
    let p = y * width * 4 + 3
    let x = 0
    while (x < width) {
      if (rgba[p]! < threshold) {
        x++
        p += 4
        continue
      }
      const start = x
      while (x < width && rgba[p]! >= threshold) {
        x++
        p += 4
      }
      if (count === cap) {
        cap *= 2
        x0s = grow(x0s)
        x1s = grow(x1s)
        ys = grow(ys)
        parent = grow(parent)
      }
      x0s[count] = start
      x1s[count] = x
      ys[count] = y
      parent[count] = count
      // 8-connected: a run in the row above touches this one if it reaches
      // the column before `start` and begins by the column after the end.
      // `j` only skips runs that end too early for this run, so the next
      // run in this row can still pick up the last one we touched.
      while (j < prevEnd && x1s[j]! < start) j++
      for (let k = j; k < prevEnd && x0s[k]! <= x; k++) union(parent, k, count)
      count++
    }
    prevStart = rowStart
    prevEnd = count
  }

  for (let i = 0; i < count; i++) parent[i] = findRoot(parent, i)
  return { count, x0: x0s, x1: x1s, y: ys, root: parent }
}

// ---------- box filters

// Counts the set pixels in the (2r+1)² square around every pixel of a 0/1
// mask, as two running sums. Edges are replicated, so a subject cut off by
// the photo's frame keeps a hard edge there instead of fading out.
function boxCount(src: Uint8Array, dst: Uint8Array, tmp: Uint8Array, w: number, h: number, r: number): void {
  if (r === 0) {
    dst.set(src)
    return
  }
  const lastX = w - 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let s = 0
    for (let k = -r; k <= r; k++) s += src[row + (k < 0 ? 0 : k > lastX ? lastX : k)]!
    tmp[row] = s
    for (let x = 1; x < w; x++) {
      const add = x + r
      const sub = x - r - 1
      s += src[row + (add > lastX ? lastX : add)]! - src[row + (sub < 0 ? 0 : sub)]!
      tmp[row + x] = s
    }
  }
  // vertical: a whole row at a time, so every pass walks memory in order
  const lastY = h - 1
  dst.fill(0, 0, w)
  for (let k = -r; k <= r; k++) {
    const from = (k < 0 ? 0 : k > lastY ? lastY : k) * w
    for (let x = 0; x < w; x++) dst[x] = dst[x]! + tmp[from + x]!
  }
  for (let y = 1; y < h; y++) {
    const add = y + r
    const sub = y - r - 1
    const addRow = (add > lastY ? lastY : add) * w
    const subRow = (sub < 0 ? 0 : sub) * w
    const prev = (y - 1) * w
    const row = y * w
    for (let x = 0; x < w; x++) dst[row + x] = dst[prev + x]! + tmp[addRow + x]! - tmp[subRow + x]!
  }
}

// ---------- the pass

// zeroes alpha for pixels [from, to) and returns how many were visible
function clearSpan(rgba: Uint8ClampedArray, from: number, to: number): number {
  let cleared = 0
  for (let p = from * 4 + 3, end = to * 4 + 3; p < end; p += 4) {
    if (rgba[p]! > 0) {
      cleared++
      rgba[p] = 0
    }
  }
  return cleared
}

// Cleans the alpha channel of RGBA pixels in place; RGB is never touched.
// A mask with no confident pixels at all is left exactly as it is — there's
// nothing to anchor on, and wiping it would only turn a faint cut into none.
export function cleanAlpha(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: Partial<CleanupOptions> = {},
): CleanupStats {
  const started = performance.now()
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new RangeError(`bad mask size ${width}×${height}`)
  }
  if (rgba.length < width * height * 4) throw new RangeError('pixel data is smaller than the mask size')
  const o = { ...DEFAULT_CLEANUP, ...opts }
  const erode = radius(o.erode)
  const feather = radius(o.feather)
  const stats: CleanupStats = { components: 0, kept: 0, cleared: 0, softened: 0, ms: 0 }
  const done = () => {
    stats.ms = Math.round((performance.now() - started) * 10) / 10
    return stats
  }

  const runs = labelRuns(rgba, width, height, o.threshold)
  if (runs.count === 0) return done()

  // area per component, then which ones stay
  const { x0, x1, y: ry, root } = runs
  const area = new Int32Array(runs.count)
  for (let i = 0; i < runs.count; i++) area[root[i]!] = area[root[i]!]! + x1[i]! - x0[i]!
  let largest = 0
  for (let i = 0; i < runs.count; i++) {
    if (root[i] !== i) continue
    stats.components++
    if (area[i]! > largest) largest = area[i]!
  }
  const minArea = Math.max(1, largest * o.minFraction)
  const keep = new Uint8Array(runs.count)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let i = 0; i < runs.count; i++) {
    const r = root[i]!
    if (area[r]! < minArea) continue
    if (r === i) stats.kept++
    keep[i] = 1
    if (x0[i]! < minX) minX = x0[i]!
    if (x1[i]! - 1 > maxX) maxX = x1[i]! - 1
    if (ry[i]! < minY) minY = ry[i]!
    if (ry[i]! > maxY) maxY = ry[i]!
  }

  // Everything below happens in a window around what's kept: the cap is 0
  // more than 2·feather px out, so past that it's just clearing. The window
  // ends in empty mask wherever it doesn't meet the photo's edge, which
  // makes boxCount's replicated edge exactly right there too.
  const margin = 2 * feather + 1
  const ox = Math.max(0, minX - margin)
  const oy = Math.max(0, minY - margin)
  const rw = Math.min(width, maxX + margin + 1) - ox
  const rh = Math.min(height, maxY + margin + 1) - oy
  const n = rw * rh

  const kept = new Uint8Array(n)
  for (let i = 0; i < runs.count; i++) {
    if (keep[i]) kept.fill(1, (ry[i]! - oy) * rw + x0[i]! - ox, (ry[i]! - oy) * rw + x1[i]! - ox)
  }

  const counts = new Uint8Array(n)
  const tmp = new Uint8Array(n)
  const mask = new Uint8Array(n)

  // inner: stripped of its outer `erode` px, sure pixels excepted
  if (erode === 0) {
    mask.set(kept)
  } else {
    boxCount(kept, counts, tmp, rw, rh, erode)
    const full = (2 * erode + 1) * (2 * erode + 1)
    const solid = o.solidAlpha
    let anyInner = false
    for (let y = 0, i = 0; y < rh; y++) {
      let p = ((oy + y) * width + ox) * 4 + 3
      for (let x = 0; x < rw; x++, i++, p += 4) {
        const inner = counts[i] === full || (kept[i] === 1 && rgba[p]! >= solid)
        mask[i] = inner ? 1 : 0
        if (inner) anyInner = true
      }
    }
    // a subject that's all thin and half-sure would erode to nothing; keep
    // it unstripped rather than throw the whole cut away
    if (!anyInner) mask.set(kept)
  }

  // grown by feather, then blurred by feather
  boxCount(mask, counts, tmp, rw, rh, feather)
  for (let i = 0; i < n; i++) mask[i] = counts[i]! > 0 ? 1 : 0
  boxCount(mask, counts, tmp, rw, rh, feather)
  const full = (2 * feather + 1) * (2 * feather + 1)
  const lut = new Uint8Array(full + 1)
  for (let c = 0; c <= full; c++) lut[c] = Math.round((c * 255) / full)

  for (let y = 0, i = 0; y < rh; y++) {
    let p = ((oy + y) * width + ox) * 4 + 3
    for (let x = 0; x < rw; x++, i++, p += 4) {
      const a = rgba[p]!
      const c = lut[counts[i]!]!
      if (a <= c) continue
      rgba[p] = c
      if (c === 0) stats.cleared++
      else stats.softened++
    }
  }

  // and outside the window, nothing survives
  stats.cleared += clearSpan(rgba, 0, oy * width)
  for (let y = oy; y < oy + rh; y++) {
    stats.cleared += clearSpan(rgba, y * width, y * width + ox)
    stats.cleared += clearSpan(rgba, y * width + ox + rw, (y + 1) * width)
  }
  stats.cleared += clearSpan(rgba, (oy + rh) * width, width * height)

  return done()
}
