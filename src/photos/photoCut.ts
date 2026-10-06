// Turning a phone photo into a layer, all on this device.

// Layers are capped at this on their longest side (imageCache's
// MAX_SOURCE_PX), and so is the exported picture — no point keeping more
export const PHOTO_MAX_PX = 1024

export type Point = { x: number; y: number }
// a closed loop drawn by a finger, in the photo's own pixels
export type Loop = Point[]

// A 12-megapixel photo is decoded once at full size, drawn straight onto a
// canvas at most PHOTO_MAX_PX across, and let go. What's kept is only that
// redrawn copy: the browser applies the EXIF orientation as it draws (so a
// portrait photo is upright), and a canvas carries no metadata at all —
// location, camera, date are gone without having to be stripped one by one.
export async function preparePhoto(file: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file)
  const img = new Image()
  try {
    img.decoding = 'async'
    img.src = url
    await img.decode()
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) throw new Error('not a picture')
    const scale = Math.min(1, PHOTO_MAX_PX / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    // the full-size decode is the big one — drop it now, not at GC's leisure
    img.removeAttribute('src')
    URL.revokeObjectURL(url)
  }
}

// a loop worth keeping: enough points, and not a dot or a hairline
export function isUsableLoop(loop: readonly Point[], minSpanPx = 12): boolean {
  if (loop.length < 3) return false
  const b = bounds([loop])
  return b.w >= minSpanPx && b.h >= minSpanPx
}

// the box around every loop, clamped to the photo and rounded outward to
// whole pixels — the cut is trimmed to exactly this
export function bounds(loops: readonly (readonly Point[])[], width = Infinity, height = Infinity) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const loop of loops) {
    for (const p of loop) {
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x)
      y1 = Math.max(y1, p.y)
    }
  }
  if (x0 > x1) return { x: 0, y: 0, w: 0, h: 0 }
  const x = Math.max(0, Math.floor(x0))
  const y = Math.max(0, Math.floor(y0))
  const right = Math.min(width, Math.ceil(x1))
  const bottom = Math.min(height, Math.ceil(y1))
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) }
}

// the whole photo as one loop — for a photo used as it is
export function wholePhoto(width: number, height: number): Loop {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]
}

// Keeps what's inside the loops (several loops keep all of them), trimmed
// to their bounds, as a PNG with everything else transparent. Hard edges, no
// feathering: a rough cut is the point.
export async function cutPhoto(photo: HTMLCanvasElement, loops: readonly Loop[]): Promise<Blob> {
  const b = bounds(loops, photo.width, photo.height)
  if (b.w < 1 || b.h < 1) throw new Error('nothing inside the cut')
  const out = document.createElement('canvas')
  out.width = b.w
  out.height = b.h
  try {
    const ctx = out.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.translate(-b.x, -b.y)
    ctx.fillStyle = '#000'
    for (const loop of loops) {
      const [first, ...rest] = loop
      if (!first) continue
      ctx.beginPath()
      ctx.moveTo(first.x, first.y)
      for (const p of rest) ctx.lineTo(p.x, p.y)
      ctx.closePath()
      ctx.fill()
    }
    // the photo, only where the loops were filled
    ctx.globalCompositeOperation = 'source-in'
    ctx.drawImage(photo, 0, 0)
    return await new Promise<Blob>((resolve, reject) =>
      out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not encode the cut'))), 'image/png'),
    )
  } finally {
    // Safari holds canvas memory until the size goes to zero
    out.width = 0
    out.height = 0
  }
}

// Release a canvas's pixels now (Safari keeps them until it's resized away).
export function releaseCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return
  canvas.width = 0
  canvas.height = 0
}
