import { describe, it, expect } from 'vitest'
import { cleanAlpha, DEFAULT_CLEANUP } from './maskCleanup'

// a w×h image with a recognisable RGB pattern and nothing visible yet
function image(w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = i % 251
    px[i * 4 + 1] = (i * 7) % 253
    px[i * 4 + 2] = 77
  }
  return px
}

const alphaAt = (px: Uint8ClampedArray, w: number, x: number, y: number) => px[(y * w + x) * 4 + 3]!

function setAlpha(px: Uint8ClampedArray, w: number, x: number, y: number, a: number): void {
  px[(y * w + x) * 4 + 3] = a
}

function rect(px: Uint8ClampedArray, w: number, x0: number, y0: number, rw: number, rh: number, a: number): void {
  for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) setAlpha(px, w, x, y, a)
}

// alpha `a` for every pixel whose centre is within (r0, r1] of (cx, cy)
function ring(px: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, r0: number, r1: number, a: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d > r0 && d <= r1) setAlpha(px, w, x, y, a)
    }
  }
}

const disc = (px: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, r: number, a: number) =>
  ring(px, w, h, cx, cy, -1, r, a)

function alphaSum(px: Uint8ClampedArray): number {
  let s = 0
  for (let i = 3; i < px.length; i += 4) s += px[i]!
  return s
}

describe('specks and stray components', () => {
  it('drops specks far from the subject, whatever their alpha', () => {
    const w = 256
    const px = image(w, w)
    disc(px, w, w, 100, 100, 40, 255)
    rect(px, w, 220, 30, 3, 3, 200)
    setAlpha(px, w, 20, 230, 255)
    // haze below the threshold isn't a component at all, but it still goes
    rect(px, w, 200, 200, 6, 6, 60)

    const stats = cleanAlpha(px, w, w)

    expect(alphaAt(px, w, 221, 31)).toBe(0)
    expect(alphaAt(px, w, 20, 230)).toBe(0)
    expect(alphaAt(px, w, 202, 202)).toBe(0)
    expect(alphaAt(px, w, 100, 100)).toBe(255)
    expect(alphaAt(px, w, 100, 65)).toBe(255)
    expect(stats.components).toBe(3)
    expect(stats.kept).toBe(1)
    expect(stats.cleared).toBeGreaterThanOrEqual(9 + 1 + 36)
  })

  it('keeps a second component that is big enough — a hat above a head', () => {
    const w = 200
    const px = image(w, w)
    disc(px, w, w, 100, 120, 40, 255) // ~5000 px
    rect(px, w, 85, 50, 30, 15, 255) // 450 px, ~9% of the head, 15 px clear of it

    const stats = cleanAlpha(px, w, w)

    expect(stats.components).toBe(2)
    expect(stats.kept).toBe(2)
    expect(alphaAt(px, w, 100, 57)).toBe(255)
    expect(alphaAt(px, w, 85, 50)).toBe(255)
  })

  it('drops a component below the fraction', () => {
    const w = 200
    const px = image(w, w)
    disc(px, w, w, 100, 120, 40, 255)
    rect(px, w, 10, 10, 10, 10, 255) // 100 px, ~2%

    const stats = cleanAlpha(px, w, w)

    expect(stats.kept).toBe(1)
    expect(alphaAt(px, w, 15, 15)).toBe(0)
  })

  it('counts diagonal neighbours as touching', () => {
    const w = 64
    const px = image(w, w)
    rect(px, w, 10, 10, 20, 20, 255)
    // a staircase of single pixels leading off the corner, only ever
    // touching corner to corner — one component with the square
    for (let k = 0; k < 10; k++) setAlpha(px, w, 30 + k, 30 + k, 255)

    const stats = cleanAlpha(px, w, w)

    expect(stats.components).toBe(1)
    expect(alphaAt(px, w, 35, 35)).toBe(255)
  })
})

describe('the edge', () => {
  it('pulls in a half-opaque halo ring', () => {
    const w = 120
    const px = image(w, w)
    disc(px, w, w, 60, 60, 30, 255)
    ring(px, w, w, 60, 60, 30, 31, 200)
    const ringBefore = ringAlpha(px, w)

    cleanAlpha(px, w, w)

    expect(ringAlpha(px, w)).toBeLessThan(ringBefore * 0.95)
    expect(alphaAt(px, w, 60, 60)).toBe(255)
    expect(alphaAt(px, w, 60, 31)).toBe(255)
  })

  it('a wider halo loses its outer part and is thinned overall', () => {
    const w = 120
    const px = image(w, w)
    disc(px, w, w, 60, 60, 30, 255)
    ring(px, w, w, 60, 60, 30, 31, 160)
    ring(px, w, w, 60, 60, 31, 32, 110)
    ring(px, w, w, 60, 60, 32, 33, 70)
    ring(px, w, w, 60, 60, 33, 34, 40)
    const before = alphaSum(px)

    cleanAlpha(px, w, w)

    // straight down from the centre: d = 31…34 are the halo
    expect(alphaAt(px, w, 60, 60 + 34)).toBe(0)
    expect(alphaAt(px, w, 60, 60 + 33)).toBe(0)
    expect(alphaAt(px, w, 60, 60 + 30)).toBe(255)
    expect(alphaSum(px)).toBeLessThan(before)
  })

  it('a soft gradient next to the subject is capped, not wiped', () => {
    const w = 80
    const px = image(w, w)
    rect(px, w, 10, 10, 30, 40, 255)
    // to the right of the block: a soft edge, all below the threshold
    const ramp = [120, 100, 80, 60, 40, 20]
    for (let y = 10; y < 50; y++) ramp.forEach((a, k) => setAlpha(px, w, 40 + k, y, a))

    cleanAlpha(px, w, w)

    expect(alphaAt(px, w, 39, 30)).toBe(255)
    expect(alphaAt(px, w, 40, 30)).toBe(120)
    expect(alphaAt(px, w, 41, 30)).toBeGreaterThan(0)
    expect(alphaAt(px, w, 41, 30)).toBeLessThan(100)
    expect(alphaAt(px, w, 44, 30)).toBe(0)
  })

  it('keeps a thin opaque line attached to the subject', () => {
    const w = 100
    const px = image(w, w)
    rect(px, w, 10, 10, 40, 40, 255)
    rect(px, w, 50, 30, 40, 1, 255) // a 1px string trailing off to the right

    cleanAlpha(px, w, w)

    for (let x = 50; x < 90; x++) expect(alphaAt(px, w, x, 30)).toBe(255)
  })

  it('stays hard where the subject runs off the photo', () => {
    const w = 90
    const h = 60
    const px = image(w, h)
    // a body cut off by the bottom and left of the frame
    rect(px, w, 0, 20, 50, 40, 255)

    cleanAlpha(px, w, h)

    for (let x = 0; x < 49; x++) expect(alphaAt(px, w, x, h - 1)).toBe(255)
    for (let y = 21; y < h; y++) expect(alphaAt(px, w, 0, y)).toBe(255)
  })

  it('erode: 0 leaves a half-opaque edge where it was', () => {
    const w = 60
    const px = image(w, w)
    rect(px, w, 10, 10, 30, 30, 255)
    rect(px, w, 40, 10, 1, 30, 180)

    cleanAlpha(px, w, w, { erode: 0 })

    expect(alphaAt(px, w, 40, 20)).toBe(180)
  })
})

function ringAlpha(px: Uint8ClampedArray, w: number): number {
  let s = 0
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - 60, y - 60)
      if (d > 30) s += alphaAt(px, w, x, y)
    }
  }
  return s
}

describe('odd inputs', () => {
  it('an empty mask is left alone', () => {
    const px = image(32, 32)
    const before = px.slice()
    const stats = cleanAlpha(px, 32, 32)
    expect(px).toEqual(before)
    expect(stats.components).toBe(0)
    expect(stats.cleared).toBe(0)
  })

  it('so is one with nothing over the threshold — no anchor, no clean-up', () => {
    const px = image(32, 32)
    rect(px, 32, 0, 0, 32, 32, 60)
    const before = px.slice()
    cleanAlpha(px, 32, 32)
    expect(px).toEqual(before)
  })

  it('zero-sized and one-pixel images', () => {
    expect(() => cleanAlpha(new Uint8ClampedArray(0), 0, 0)).not.toThrow()
    const one = new Uint8ClampedArray([1, 2, 3, 255])
    cleanAlpha(one, 1, 1)
    expect([...one]).toEqual([1, 2, 3, 255])
  })

  it('a single opaque pixel survives', () => {
    const px = image(9, 9)
    setAlpha(px, 9, 4, 4, 255)
    cleanAlpha(px, 9, 9)
    expect(alphaAt(px, 9, 4, 4)).toBe(255)
  })

  it('a faint, thin subject is kept rather than eroded away', () => {
    const px = image(40, 40)
    rect(px, 40, 5, 20, 30, 2, 200)
    cleanAlpha(px, 40, 40)
    expect(alphaAt(px, 40, 20, 20)).toBe(200)
  })

  it('never touches RGB', () => {
    const w = 256
    const px = image(w, w)
    disc(px, w, w, 100, 100, 40, 255)
    ring(px, w, w, 100, 100, 40, 43, 90)
    rect(px, w, 220, 30, 3, 3, 200)
    const before = px.slice()

    cleanAlpha(px, w, w)

    let rgbSame = true
    for (let i = 0; i < px.length; i++) if (i % 4 !== 3 && px[i] !== before[i]) rgbSame = false
    expect(rgbSame).toBe(true)
  })

  it('non-square, both ways round', () => {
    for (const [w, h] of [
      [300, 120],
      [90, 400],
    ] as const) {
      const px = image(w, h)
      const cx = w - 30
      const cy = h - 30
      disc(px, w, h, cx, cy, 25, 255)
      rect(px, w, 5, 5, 4, 4, 255)

      const stats = cleanAlpha(px, w, h)

      expect(stats.kept).toBe(1)
      expect(alphaAt(px, w, 6, 6)).toBe(0)
      expect(alphaAt(px, w, cx, cy)).toBe(255)
      expect(alphaAt(px, w, cx + 20, cy)).toBe(255)
    }
  })

  it('rejects a size that does not match the data', () => {
    expect(() => cleanAlpha(new Uint8ClampedArray(16), 4, 4)).toThrow(RangeError)
    expect(() => cleanAlpha(new Uint8ClampedArray(16), 1.5, 2)).toThrow(RangeError)
  })

  it('defaults are what the worker runs with', () => {
    expect(DEFAULT_CLEANUP).toEqual({ threshold: 128, minFraction: 0.04, erode: 1, solidAlpha: 250, feather: 1 })
  })
})

describe('speed', () => {
  it('a 1024² mask in well under a frame budget', () => {
    const w = 1024
    const px = image(w, w)
    disc(px, w, w, 512, 560, 380, 255)
    ring(px, w, w, 512, 560, 380, 383, 140)
    ring(px, w, w, 512, 560, 383, 386, 50)
    // a scatter of specks
    for (let k = 0; k < 400; k++) rect(px, w, (k * 97) % 1000, (k * 61) % 1000, 3, 2, 180)

    cleanAlpha(px.slice(), w, w) // warm-up
    const t = performance.now()
    const stats = cleanAlpha(px, w, w)
    const ms = performance.now() - t

    console.info(`[mask clean-up] 1024² in ${ms.toFixed(1)}ms`, stats)
    expect(ms).toBeLessThan(500)
  })
})
