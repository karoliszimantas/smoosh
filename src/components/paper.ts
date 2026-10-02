import { CANVAS_SIZE } from './layerItem'

// theme sizes for canvas drawing are screen pixels on a 400px-wide frame;
// this many canvas units make one of them
export const CANVAS_UNITS_PER_THEME_PX = CANVAS_SIZE / 400

// A layer printed on paper: the image's own silhouette grown outward in the
// border colour, with an uneven ("torn") edge, and the image on top. Follows
// the cut-out's outline, not its bounding box — a rectangle photo gets a
// border like a print, a cut-out goat gets a sticker edge.
export type Paper = {
  source: HTMLImageElement | HTMLCanvasElement
  // border thickness added on every side, in source pixels
  pad: number
}

// small deterministic PRNG, seeded per image, so a layer's torn edge is the
// same every time it's drawn — switching theme away and back doesn't re-tear it
function seeded(seedText: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

const DIRECTIONS = 48

function buildPaper(image: HTMLImageElement, color: string, pad: number): Paper {
  const tint = document.createElement('canvas')
  tint.width = image.width
  tint.height = image.height
  const t = tint.getContext('2d')
  const out = document.createElement('canvas')
  out.width = image.width + pad * 2
  out.height = image.height + pad * 2
  const o = out.getContext('2d')
  if (!t || !o) return { source: image, pad: 0 }

  // the silhouette, flat in the border colour
  t.drawImage(image, 0, 0)
  t.globalCompositeOperation = 'source-in'
  t.fillStyle = color
  t.fillRect(0, 0, tint.width, tint.height)

  // stamp it around a circle at an uneven radius per direction (a dilation
  // whose reach wobbles — the torn edge), plus an inner ring to fill gaps
  const rand = seeded(image.src)
  for (const ring of [1, 0.55]) {
    for (let k = 0; k < DIRECTIONS; k++) {
      const angle = (k / DIRECTIONS) * Math.PI * 2
      const r = pad * ring * (0.6 + 0.4 * rand())
      o.drawImage(tint, pad + Math.cos(angle) * r, pad + Math.sin(angle) * r)
    }
  }
  o.drawImage(image, pad, pad)
  return { source: out, pad }
}

const cache = new WeakMap<HTMLImageElement, Map<string, Paper>>()

// `unitsPerPx`: canvas units per source pixel at scale 1 — the border is
// sized against the frame, so the same theme gives the same border on a
// small or large image
export function paperFor(
  image: HTMLImageElement,
  color: string | null,
  borderThemePx: number,
  unitsPerPx: number,
): Paper {
  const pad = Math.round((borderThemePx * CANVAS_UNITS_PER_THEME_PX) / unitsPerPx)
  if (!color || pad < 1) return { source: image, pad: 0 }
  const key = `${color}|${pad}`
  let byKey = cache.get(image)
  if (!byKey) {
    byKey = new Map()
    cache.set(image, byKey)
  }
  let paper = byKey.get(key)
  if (!paper) {
    paper = buildPaper(image, color, pad)
    byKey.set(key, paper)
  }
  return paper
}
