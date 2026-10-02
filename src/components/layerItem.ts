// The picture is a square frame of CANVAS_SIZE x CANVAS_SIZE canvas units.
// Item positions are stored in these units, not screen pixels — the stage is
// scaled to fit the frame on whatever screen it's on, so a composition stays
// put across rotation, window resizes, and restoring on another device.
export const CANVAS_SIZE = 1000

// array index is the sole source of z-order — index 0 renders at the back.
// Konva must never reorder its own children; reordering means reordering
// this array in React state.
export type LayerItem = {
  id: string
  src: string
  thumb: string
  label: string
  x: number
  y: number
  // always positive — mirroring lives in `mirrored`, so a pinch that
  // rewrites the scale can never un-mirror a layer
  scale: number
  rotation: number
  // horizontal flip (scaleX * -1). There's deliberately no vertical flip:
  // upside down reads as a mistake, and rotation covers it anyway
  mirrored: boolean
  // 0.1 – 1
  opacity: number
  // eraser strokes, as data in the image's own untransformed space —
  // replayed onto the image to rebuild it, never stored as pixels. Absent
  // = nothing erased. See erase.ts
  erase?: EraseStroke[]
  // the visible part of the image, as fractions of the full (uncropped)
  // image — absent means uncropped. Fractions rather than pixels so it holds
  // when the source is swapped for a differently-sized copy (a local cut
  // replaced by its shared upload). The image itself is never altered.
  crop?: CropRect
  // set for anything that came from Pixabay, so the layer can be reported
  pixabayId?: number
}

export type EraseStroke = {
  // brush radius, as a fraction of the full image's width
  r: number
  // the path, flattened [x0, y0, x1, y1, …] as fractions of the full image
  p: number[]
}

export const MIN_OPACITY = 0.1
export const MAX_ERASE_STROKES = 200

export type CropRect = { x: number; y: number; width: number; height: number }

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 }

export function isFullCrop(c: CropRect): boolean {
  const eps = 1e-3
  return c.x < eps && c.y < eps && c.width > 1 - eps && c.height > 1 - eps
}

// a full (uncropped) layer's size in canvas units at scale 1: new layers
// start at 30% of the frame on their longest side
export function baseSize(image: { width: number; height: number }): { w: number; h: number } {
  const maxSide = CANVAS_SIZE * 0.3
  const ratio = image.width / image.height
  return ratio > 1 ? { w: maxSide, h: maxSide / ratio } : { w: maxSide * ratio, h: maxSide }
}

// A layer's position is the centre of its visible (cropped) part, so it
// scales and rotates around what the player sees. This is where that centre
// sits relative to the full image's centre, in canvas units, after the
// layer's scale, flips and rotation.
export function cropCenterOffset(
  crop: CropRect,
  base: { w: number; h: number },
  item: Pick<LayerItem, 'scale' | 'rotation' | 'mirrored'>,
): { x: number; y: number } {
  const lx = (crop.x + crop.width / 2 - 0.5) * base.w * item.scale * (item.mirrored ? -1 : 1)
  const ly = (crop.y + crop.height / 2 - 0.5) * base.h * item.scale
  const r = (item.rotation * Math.PI) / 180
  return { x: lx * Math.cos(r) - ly * Math.sin(r), y: lx * Math.sin(r) + ly * Math.cos(r) }
}

// what the asset sheet hands the canvas to place — a curated asset, a shared
// cut, a fresh on-device cut (blob: URL), or a full Pixabay rectangle
export type Placement = {
  full: string
  thumb: string
  label: string
  pixabayId: number | null
}
