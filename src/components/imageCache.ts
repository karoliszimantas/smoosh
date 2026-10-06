import { isPhotoSrc, photoUrl } from '../photos/photoStore'

// Decoding, downscaling and caching of layer images, shared by every layer
// and by crop/erase modes — which need the original image, not whatever the
// layer's node currently draws (a themed paper canvas, an erased copy).

// pipeline assets cap at 800px on their longest side (see tools/cut.ts), so
// this never fires for local assets today — kept for when a remote/search
// source can hand back full-resolution photos
const MAX_SOURCE_PX = 1024

function downscale(image: HTMLImageElement): { promise: Promise<HTMLImageElement>; cancel: () => void } {
  const scale = Math.min(1, MAX_SOURCE_PX / Math.max(image.width, image.height))
  if (scale >= 1) return { promise: Promise.resolve(image), cancel: () => {} }

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.width * scale)
  canvas.height = Math.round(image.height * scale)
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)

  let cancelled = false
  let url: string | null = null

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (cancelled) {
        reject(new DOMException('image decode cancelled', 'AbortError'))
        return
      }
      if (!blob) {
        reject(new Error('toBlob failed'))
        return
      }
      url = URL.createObjectURL(blob)
      const small = new window.Image()
      small.onload = () => {
        if (url) URL.revokeObjectURL(url)
        if (cancelled) {
          reject(new DOMException('image decode cancelled', 'AbortError'))
          return
        }
        resolve(small)
      }
      small.onerror = () => {
        if (url) URL.revokeObjectURL(url)
        reject(new Error('failed to decode downscaled image'))
      }
      small.src = url
    }, 'image/png')
  })

  const cancel = () => {
    cancelled = true
    if (url) {
      URL.revokeObjectURL(url)
      url = null
    }
  }

  return { promise, cancel }
}

// shared across every DraggableImage instance: the same asset added multiple
// times (a common pattern in this game) decodes and downscales exactly once
const imageCache = new Map<string, Promise<HTMLImageElement>>()

export function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src)
  if (cached) return cached

  // a player's own photo is `photo:<id>`, kept on this device — its pixels
  // come out of local storage, never off the network
  const url = isPhotoSrc(src) ? photoUrl(src) : Promise.resolve(src)
  const promise = url.then(
    (resolved) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new window.Image()
        // no-op for same-origin manifest assets today, but prevents a tainted
        // canvas (and a broken export) if a future CDN source lacks CORS headers
        image.crossOrigin = 'anonymous'
        image.onload = () => {
          downscale(image).promise.then(resolve, reject)
        }
        image.onerror = () => reject(new Error(`failed to load ${src}`))
        image.src = resolved
      }),
  )

  // don't let a failed load poison the cache forever — a later retry (new
  // item, sheet retry) should get a fresh attempt
  promise.catch(() => imageCache.delete(src))

  imageCache.set(src, promise)
  return promise
}
