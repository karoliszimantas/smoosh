// Background removal, off the main thread so the canvas never freezes
// mid-gesture. @imgly/background-removal is imported dynamically on the
// first job — this file is its own chunk, and the library (plus the ~40MB
// model it fetches) never touches the main bundle or the initial page load.

import type { WorkerRequest, WorkerResponse } from './protocol'

type Imgly = typeof import('@imgly/background-removal')
type ImglyConfig = NonNullable<Parameters<Imgly['removeBackground']>[1]>

// Feeding a full-resolution photo into the model is how an iOS tab dies.
// Pixabay's webformat images are 640px so this is usually a no-op, but the
// cap holds whatever the source.
const MAX_INPUT_PX = 1024
// alpha at or below this counts as background when trimming
const TRIM_ALPHA = 10

// per-image failures — everything else means the device can't cut at all
class ImageError extends Error {}

let imgly: Promise<Imgly> | null = null
// imgly memoizes its init — including the config, progress callback and all
// — on the first call, so progress has to route through this rather than a
// per-job closure
let currentJob = -1

function post(message: WorkerResponse): void {
  self.postMessage(message)
}

const config: ImglyConfig = {
  model: 'isnet_quint8',
  output: { format: 'image/png', quality: 1 },
  progress: (key, current, total) => {
    if (key.startsWith('fetch:')) post({ type: 'progress', job: currentJob, key, loaded: current, total })
  },
}

function canvas2d(w: number, h: number): OffscreenCanvasRenderingContext2D {
  const ctx = new OffscreenCanvas(w, h).getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2D is not available')
  return ctx
}

async function fetchDownscaled(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new ImageError(`Couldn't load this image (HTTP ${res.status}).`)
  const bitmap = await createImageBitmap(await res.blob())
  const scale = Math.min(1, MAX_INPUT_PX / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const ctx = canvas2d(w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return ctx.canvas.convertToBlob({ type: 'image/png' })
}

function alphaBounds(data: ImageData): { x: number; y: number; w: number; h: number } | null {
  const { width, height, data: px } = data
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((px[(y * width + x) * 4 + 3] ?? 0) > TRIM_ALPHA) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

async function cut(url: string): Promise<{ place: Blob; upload: Blob | null }> {
  if (!imgly) imgly = import('@imgly/background-removal')
  const lib = await imgly
  await lib.preload(config)

  post({ type: 'cutting', job: currentJob })
  const input = await fetchDownscaled(url)
  const output = await lib.removeBackground(input, config)

  const bitmap = await createImageBitmap(output)
  const full = canvas2d(bitmap.width, bitmap.height)
  full.drawImage(bitmap, 0, 0)
  bitmap.close()
  const bounds = alphaBounds(full.getImageData(0, 0, full.canvas.width, full.canvas.height))
  if (!bounds) throw new ImageError('No subject found in this image — try Full instead.')

  // The upload stays untrimmed, the same size as the source, so the server
  // can check it pixel-for-pixel against the original before sharing it.
  // Safari can't encode WebP and silently hands back PNG; the server only
  // takes WebP, so on those devices the cut just isn't shared.
  const uploadBlob = await full.canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })
  const upload = uploadBlob.type === 'image/webp' ? uploadBlob : null

  // What goes on this player's canvas is trimmed to the subject, so the
  // layer's selection box and hit area hug the cut rather than the photo
  const trimmed = canvas2d(bounds.w, bounds.h)
  trimmed.drawImage(full.canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h)
  const place = await trimmed.canvas.convertToBlob({ type: 'image/webp', quality: 0.9 })

  return { place, upload }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { job, url } = event.data
  currentJob = job
  cut(url).then(
    ({ place, upload }) => post({ type: 'done', job, place, upload }),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      // a bad image is this image's problem; anything else (model download,
      // wasm, OffscreenCanvas) means this device can't cut at all
      post({ type: 'error', job, message, fatal: !(err instanceof ImageError) })
    },
  )
}
