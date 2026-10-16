import { describe, it, expect } from 'vitest'
import { dropCut, landCuts, swapInCut, withoutCut } from './cutSwap'
import { FULL_CROP, baseSize, type LayerItem } from './layerItem'
import type { CutTrim } from '../cutting/cutClient'

// a point of an image, as fractions of it, where it lands on the canvas for
// a layer showing that image — as DraggableImage draws it: the crop's centre
// at (x, y), then the mirror, the scale and the turn
function toCanvas(item: LayerItem, aspect: number, fx: number, fy: number) {
  const base = baseSize({ width: aspect, height: 1 })
  const crop = item.crop ?? FULL_CROP
  const lx = (fx - (crop.x + crop.width / 2)) * base.w * item.scale * (item.mirrored ? -1 : 1)
  const ly = (fy - (crop.y + crop.height / 2)) * base.h * item.scale
  const r = (item.rotation * Math.PI) / 180
  return { x: item.x + lx * Math.cos(r) - ly * Math.sin(r), y: item.y + lx * Math.sin(r) + ly * Math.cos(r) }
}

const layer = (patch: Partial<LayerItem> = {}): LayerItem => ({
  id: 'a',
  src: 'full.jpg',
  thumb: 'full-thumb.jpg',
  label: 'a hen',
  x: 480,
  y: 530,
  scale: 1,
  rotation: 0,
  mirrored: false,
  opacity: 1,
  cutting: 't1',
  ...patch,
})

// a landscape photo with the hen in its left half, a little low
const trim: CutTrim = { x: 0.1, y: 0.35, width: 0.4, height: 0.5, aspect: 1.5 }
const cut = { full: 'blob:cut', thumb: 'blob:cut' }

// the cut-out's own fractions for a point of the whole picture
const inCut = (fx: number, fy: number) => [(fx - trim.x) / trim.width, (fy - trim.y) / trim.height] as const
const cutAspect = (trim.aspect * trim.width) / trim.height

function expectSubjectStays(before: LayerItem, after: LayerItem) {
  // the trim's corners and a point inside it, wherever they were
  for (const [fx, fy] of [
    [trim.x, trim.y],
    [trim.x + trim.width, trim.y + trim.height],
    [0.3, 0.6],
  ] as const) {
    const was = toCanvas(before, trim.aspect, fx, fy)
    const [cx, cy] = inCut(fx, fy)
    const now = toCanvas(after, cutAspect, cx, cy)
    expect(now.x).toBeCloseTo(was.x, 6)
    expect(now.y).toBeCloseTo(was.y, 6)
  }
}

describe('swapping a cut-out in for the whole picture', () => {
  it('keeps the subject exactly where it was, at the same size', () => {
    const before = layer()
    const after = swapInCut(before, cut, trim)!
    expectSubjectStays(before, after)
    expect(after.src).toBe('blob:cut')
    expect(after.thumb).toBe('blob:cut')
    expect(after.cutting).toBeUndefined()
  })

  it('does so turned, mirrored and scaled, and keeps the rest of the layer', () => {
    const before = layer({ rotation: 37, mirrored: true, scale: 1.7, opacity: 0.6, locked: true, pixabayId: 9, fromWord: 'hen' })
    const after = swapInCut(before, cut, trim)!
    expectSubjectStays(before, after)
    expect(after).toMatchObject({ rotation: 37, mirrored: true, opacity: 0.6, locked: true, pixabayId: 9, fromWord: 'hen', id: 'a' })
  })

  it('keeps what a crop left of the subject, where it was', () => {
    // cropped to the picture’s left 30%: through the middle of the hen
    const before = layer({ crop: { x: 0, y: 0.2, width: 0.3, height: 0.8 }, rotation: -20 })
    const after = swapInCut(before, cut, trim)!
    expect(after.crop!.x).toBeCloseTo(0)
    expect(after.crop!.y).toBeCloseTo(0)
    expect(after.crop!.width).toBeCloseTo(0.5)
    expect(after.crop!.height).toBeCloseTo(1)
    // a point of the hen inside the crop hasn't moved
    const was = toCanvas(before, trim.aspect, 0.2, 0.5)
    const now = toCanvas(after, cutAspect, ...inCut(0.2, 0.5))
    expect(now.x).toBeCloseTo(was.x, 6)
    expect(now.y).toBeCloseTo(was.y, 6)
  })

  it('drops a crop that holds the whole subject', () => {
    const after = swapInCut(layer({ crop: { x: 0.05, y: 0.3, width: 0.5, height: 0.6 } }), cut, trim)!
    expect(after.crop).toBeUndefined()
  })

  it('leaves the whole picture when the crop holds none of the subject', () => {
    expect(swapInCut(layer({ crop: { x: 0.6, y: 0, width: 0.4, height: 1 } }), cut, trim)).toBeNull()
  })

  it('moves eraser strokes into the cut-out’s terms', () => {
    const after = swapInCut(layer({ erase: [{ r: 0.02, p: [0.3, 0.6, 0.5, 0.85] }] }), cut, trim)!
    const [stroke] = after.erase!
    expect(stroke!.r).toBeCloseTo(0.05)
    expect(stroke!.p.map((v) => Math.round(v * 1000) / 1000)).toEqual([0.5, 0.5, 1, 1])
  })
})

describe('landing and dropping cuts', () => {
  const items = [layer({ id: 'a' }), layer({ id: 'b', cutting: 't2' }), layer({ id: 'c' }), layer({ id: 'd', cutting: undefined })]

  it('swaps every layer waiting on the cut — a duplicate too — and only those', () => {
    const next = landCuts(items, [{ token: 't1', image: cut, trim }])
    expect(next.map((i) => i.src)).toEqual(['blob:cut', 'full.jpg', 'blob:cut', 'full.jpg'])
    expect(next.map((i) => i.cutting)).toEqual([undefined, 't2', undefined, undefined])
  })

  it('changes nothing when no layer is waiting on it (deleted, or undone)', () => {
    expect(landCuts(items, [{ token: 'gone', image: cut, trim }])).toBe(items)
    expect(dropCut(items, 'gone')).toBe(items)
  })

  it('leaves the whole picture, no longer waiting, when the cut fails', () => {
    const next = dropCut(items, 't1')
    expect(next.map((i) => i.src)).toEqual(['full.jpg', 'full.jpg', 'full.jpg', 'full.jpg'])
    expect(next.map((i) => i.cutting)).toEqual([undefined, 't2', undefined, undefined])
  })

  it('stops waiting when the crop holds none of the subject', () => {
    const [a] = landCuts([layer({ crop: { x: 0.7, y: 0, width: 0.3, height: 1 } })], [{ token: 't1', image: cut, trim }])
    expect(a).toEqual(withoutCut(layer({ crop: { x: 0.7, y: 0, width: 0.3, height: 1 } })))
  })
})
