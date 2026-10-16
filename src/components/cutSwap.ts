import type { ImageVariant } from '../assets'
import type { CutProgress, CutTrim } from '../cutting/cutClient'
import { FULL_CROP, MIN_SCALE, baseSize, cropCenterOffset, isFullCrop, type CropRect, type EraseStroke, type LayerItem } from './layerItem'

// Cut never blocks: tapping Cut on a picture nobody has cut yet puts the
// whole picture on the canvas at once, marked with a token (`cutting`), and
// the sheet cuts it on this phone meanwhile. When the cut-out lands it takes
// the place of every layer still carrying that token — a duplicate too — in
// the present and through the undo history alike (rewriteDoc), so undo never
// brings the whole picture back. When it fails the token just goes.

// what the sheet tells the canvas about a cut it's making for a layer
export type CutUpdate =
  | { kind: 'progress'; progress: CutProgress }
  | { kind: 'done'; image: ImageVariant; trim: CutTrim }
  | { kind: 'failed' }

export type LandedCut = { token: string; image: ImageVariant; trim: CutTrim }

// a layer no longer waiting on a cut
export function withoutCut(item: LayerItem): LayerItem {
  if (item.cutting === undefined) return item
  const next = { ...item }
  delete next.cutting
  return next
}

// smaller than this (a fraction of the image) is nothing left to show
const EPS = 1e-6

// The layer showing the whole picture, turned into its cut-out with the
// subject exactly where it was on the canvas, at the same size: the cut-out
// is trimmed to the subject, so its scale and position are worked out again
// from where the trim sits in the picture. Everything else is kept. A crop
// is kept to what's left of it inside the trim, and eraser strokes are moved
// into the cut-out's own terms (both are fractions of the image they're on).
// null when the crop holds none of the subject: then the whole picture stays.
export function swapInCut(item: LayerItem, image: ImageVariant, trim: CutTrim): LayerItem | null {
  const was = item.crop ?? FULL_CROP
  const x0 = Math.max(was.x, trim.x)
  const y0 = Math.max(was.y, trim.y)
  const x1 = Math.min(was.x + was.width, trim.x + trim.width)
  const y1 = Math.min(was.y + was.height, trim.y + trim.height)
  if (x1 - x0 <= EPS || y1 - y0 <= EPS) return null
  const crop: CropRect = {
    x: (x0 - trim.x) / trim.width,
    y: (y0 - trim.y) / trim.height,
    width: (x1 - x0) / trim.width,
    height: (y1 - y0) / trim.height,
  }

  // canvas units at scale 1 (only the shape matters to baseSize)
  const fullBase = baseSize({ width: trim.aspect, height: 1 })
  const cutBase = baseSize({ width: trim.aspect * trim.width, height: trim.height })
  // the subject's width on the canvas, before and after
  const scale = Math.max(MIN_SCALE, (item.scale * fullBase.w * trim.width) / cutBase.w)

  // the whole picture's centre, then the trim's centre in it, then the
  // centre of what shows of the cut-out: the layer's new position
  const before = cropCenterOffset(was, fullBase, item)
  const trimAt = cropCenterOffset(trim, fullBase, item)
  const after = cropCenterOffset(crop, cutBase, { ...item, scale })

  const next: LayerItem = {
    ...withoutCut(item),
    src: image.full,
    thumb: image.thumb,
    scale,
    x: item.x - before.x + trimAt.x + after.x,
    y: item.y - before.y + trimAt.y + after.y,
  }
  if (isFullCrop(crop)) delete next.crop
  else next.crop = crop
  if (item.erase) next.erase = item.erase.map((s) => strokeIntoTrim(s, trim))
  return next
}

// a stroke's points are fractions of the image, its radius of its width
function strokeIntoTrim(stroke: EraseStroke, trim: CutTrim): EraseStroke {
  return {
    r: stroke.r / trim.width,
    p: stroke.p.map((v, i) => (i % 2 === 0 ? (v - trim.x) / trim.width : (v - trim.y) / trim.height)),
  }
}

// every layer waiting on one of these cuts, swapped for it
export function landCuts(items: LayerItem[], landed: readonly LandedCut[]): LayerItem[] {
  if (!items.some((i) => i.cutting !== undefined && landed.some((l) => l.token === i.cutting))) return items
  return items.map((i) => {
    const cut = i.cutting === undefined ? undefined : landed.find((l) => l.token === i.cutting)
    if (!cut) return i
    return swapInCut(i, cut.image, cut.trim) ?? withoutCut(i)
  })
}

// every layer waiting on this cut, left as the whole picture
export function dropCut(items: LayerItem[], token: string): LayerItem[] {
  if (!items.some((i) => i.cutting === token)) return items
  return items.map((i) => (i.cutting === token ? withoutCut(i) : i))
}
