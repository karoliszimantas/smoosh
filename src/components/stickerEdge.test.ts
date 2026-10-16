import { describe, it, expect, vi } from 'vitest'
import { dilate, edgeAlpha, squaredDistance, stickerRadius, stickerSprite, type StickerSprite } from './stickerEdge'

function mask(w: number, h: number, inside: (x: number, y: number) => boolean): Uint8Array {
  const m = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = inside(x, y) ? 1 : 0
  return m
}

// RGBA with alpha 255 where `inside`, 0 elsewhere
function rgba(w: number, h: number, inside: (x: number, y: number) => boolean): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y)) px[(y * w + x) * 4 + 3] = 255
  return px
}

// the squared distance the slow way: to every inside pixel
function bruteForce(m: Uint8Array, w: number, h: number): number[] {
  const out: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (m[j * w + i]) best = Math.min(best, (x - i) ** 2 + (y - j) ** 2)
      out.push(best)
    }
  }
  return out
}

describe('squaredDistance', () => {
  it('is right on a hand-checked grid', () => {
    // 5×3, one inside pixel at (1, 1)
    const m = mask(5, 3, (x, y) => x === 1 && y === 1)
    expect([...squaredDistance(m, 5, 3)]).toEqual([
      2, 1, 2, 5, 10,
      1, 0, 1, 4, 9,
      2, 1, 2, 5, 10,
    ])
  })

  it('takes the nearer of two shapes', () => {
    // 7×1: inside at 0 and 6
    const m = mask(7, 1, (x) => x === 0 || x === 6)
    expect([...squaredDistance(m, 7, 1)]).toEqual([0, 1, 4, 9, 4, 1, 0])
  })

  it('matches brute force on a ragged mask', () => {
    const w = 23
    const h = 17
    const m = mask(w, h, (x, y) => (x * 7 + y * 13) % 11 === 0 && (x + y) % 3 !== 0)
    expect([...squaredDistance(m, w, h)]).toEqual(bruteForce(m, w, h))
  })

  it('is far everywhere on an empty mask', () => {
    const d = squaredDistance(new Uint8Array(12), 4, 3)
    for (const v of d) expect(v).toBeGreaterThan(1e19)
  })
})

describe('dilate', () => {
  it('grows a disc by the radius, give or take the antialiased pixel', () => {
    const w = 64
    const cx = 32
    const R = 12
    const r = 3
    const m = mask(w, w, (x, y) => Math.hypot(x - cx, y - cx) <= R)
    const a = dilate(m, w, w, r)
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - cx, y - cx)
        const v = a[y * w + x]!
        if (d <= R + r - 0.5) expect(v, `${x},${y} d=${d.toFixed(2)}`).toBe(255)
        if (d >= R + r + 1.5) expect(v, `${x},${y} d=${d.toFixed(2)}`).toBe(0)
      }
    }
    // and somewhere along the rim's outer line it's partly covered
    expect([...a].some((v) => v > 0 && v < 255)).toBe(true)
  })

  it('grows a square by exactly the radius along its sides', () => {
    const w = 30
    const m = mask(w, w, (x, y) => x >= 10 && x < 20 && y >= 10 && y < 20)
    const a = dilate(m, w, w, 3)
    const row = 15
    // inside, then three px of full rim, then nothing
    expect(a[row * w + 10]).toBe(255)
    expect(a[row * w + 7]).toBe(255)
    expect(a[row * w + 6]).toBe(0)
    expect(a[row * w + 22]).toBe(255)
    expect(a[row * w + 23]).toBe(0)
    // a fractional radius antialiases the last pixel
    const soft = dilate(m, w, w, 2.5)
    expect(soft[row * w + 7]).toBeGreaterThan(0)
    expect(soft[row * w + 7]).toBeLessThan(255)
  })

  it('leaves nothing far from the shape', () => {
    const w = 40
    const m = mask(w, w, (x, y) => x === 5 && y === 5)
    const a = dilate(m, w, w, 3)
    let far = 0
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - 5, y - 5) > 4.5) far += a[y * w + x]!
    expect(far).toBe(0)
  })
})

describe('edgeAlpha', () => {
  it('gives an empty mask an empty edge', () => {
    const px = new Uint8ClampedArray(20 * 10 * 4)
    expect([...edgeAlpha(px, 20, 10, 3)].every((v) => v === 0)).toBe(true)
  })

  it('cleans a speck away before growing, so it gets no blob', () => {
    const w = 80
    // a big disc, and a 1px speck well clear of it
    const px = rgba(w, w, (x, y) => Math.hypot(x - 30, y - 30) <= 15 || (x === 70 && y === 70))
    const a = edgeAlpha(px, w, w, 3)
    // the disc's rim is there…
    expect(a[30 * w + 30 + 17]).toBe(255)
    // …the speck's isn't, nor the speck itself
    for (let y = 64; y < 77; y++) for (let x = 64; x < 77; x++) expect(a[y * w + x], `${x},${y}`).toBe(0)
  })

  it('grows from the half-opaque threshold, not from a faint halo', () => {
    const w = 60
    // an opaque square with a faint (alpha 60) band 4px wide round it
    const px = new Uint8ClampedArray(w * w * 4)
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const inSquare = x >= 20 && x < 40 && y >= 20 && y < 40
        const inHalo = x >= 16 && x < 44 && y >= 16 && y < 44
        px[(y * w + x) * 4 + 3] = inSquare ? 255 : inHalo ? 60 : 0
      }
    }
    const a = edgeAlpha(px, w, w, 2)
    // the rim reaches 2px past the square — not 2px past the halo
    expect(a[30 * w + 41]).toBe(255)
    expect(a[30 * w + 43]).toBe(0)
  })
})

describe('stickerRadius', () => {
  // the canvas is 1000 units on a 400px frame: 2.5 units per theme px
  const UNITS = 2.5

  it('keeps the rim the same on screen at any scale', () => {
    // 300 canvas units across for an 800px image
    const u = 300 / 800
    // 7.5 canvas units is 20 source px, within the rounding (≤ 4.5%)
    const at1 = stickerRadius(UNITS, 3, u, 1, 800)
    expect(Math.abs(at1 / 20 - 1)).toBeLessThan(0.045)
    // twice the size: half the source pixels for the same screen width
    expect(stickerRadius(UNITS, 3, u, 2, 800)).toBeCloseTo(at1 / 2, 1)
  })

  it("doesn't change for a nudge of the scale", () => {
    // a 4% band of scales lands on at most two radii
    const radii = new Set<number>()
    for (let s = 1; s <= 1.04; s += 0.002) radii.add(stickerRadius(UNITS, 3, 0.375, s, 800))
    expect(radii.size).toBeLessThanOrEqual(2)
  })

  it('caps the rim on a layer shrunk to almost nothing', () => {
    expect(stickerRadius(UNITS, 3, 0.375, 0.01, 800)).toBe(200)
  })
})

describe('stickerSprite cache', () => {
  type Src = HTMLCanvasElement
  const fake = () => ({ width: 100, height: 80 }) as unknown as Src
  const sprite = (): StickerSprite => ({ canvas: {} as HTMLCanvasElement, pad: 5, ms: 0 })
  const crop = { x: 0, y: 0, width: 100, height: 80 }

  it('builds once for the same erased source, crop, radius and colour', () => {
    const build = vi.fn(sprite)
    const source = fake()
    const a = stickerSprite(source, crop, 3, '#FFFFFF', 8, build)
    const b = stickerSprite(source, { ...crop }, 3, '#FFFFFF', 8, build)
    expect(b).toBe(a)
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('builds anew for a new erased source, a new crop, radius or colour', () => {
    const build = vi.fn(sprite)
    const source = fake()
    const a = stickerSprite(source, crop, 3, '#FFFFFF', 8, build)
    // a new erase set is a new canvas: the edge regrows
    expect(stickerSprite(fake(), crop, 3, '#FFFFFF', 8, build)).not.toBe(a)
    expect(stickerSprite(source, { ...crop, width: 50 }, 3, '#FFFFFF', 8, build)).not.toBe(a)
    expect(stickerSprite(source, crop, 4, '#FFFFFF', 8, build)).not.toBe(a)
    expect(stickerSprite(source, crop, 3, '#FBF7EE', 8, build)).not.toBe(a)
    expect(build).toHaveBeenCalledTimes(5)
  })

  it('remembers a failed build too', () => {
    const build = vi.fn(() => null)
    const source = fake()
    expect(stickerSprite(source, crop, 3, '#FFFFFF', 8, build)).toBeNull()
    expect(stickerSprite(source, crop, 3, '#FFFFFF', 8, build)).toBeNull()
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('keeps only a few per source', () => {
    const build = vi.fn(sprite)
    const source = fake()
    const first = stickerSprite(source, crop, 1, '#FFFFFF', 8, build)
    for (let r = 2; r <= 5; r++) stickerSprite(source, crop, r, '#FFFFFF', 8, build)
    expect(stickerSprite(source, crop, 1, '#FFFFFF', 8, build)).not.toBe(first)
    expect(build).toHaveBeenCalledTimes(6)
  })
})
