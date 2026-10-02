import { useEffect, useRef, useState, memo } from 'react'
import { Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import { FULL_CROP, baseSize, type LayerItem } from './layerItem'

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

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src)
  if (cached) return cached

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image()
    // no-op for same-origin manifest assets today, but prevents a tainted
    // canvas (and a broken export) if a future CDN source lacks CORS headers
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      downscale(image).promise.then(resolve, reject)
    }
    image.onerror = () => reject(new Error(`failed to load ${src}`))
    image.src = src
  })

  // don't let a failed load poison the cache forever — a later retry (new
  // item, sheet retry) should get a fresh attempt
  promise.catch(() => imageCache.delete(src))

  imageCache.set(src, promise)
  return promise
}

// a cut-out is mostly transparent, but Konva hit-tests its whole rectangle —
// so a rotated layer's invisible corners would grab touches meant for the
// layer beside it. The hit mask paints only the opaque pixels, in the
// shape's hit colour, so taps on the transparent parts fall through.
const HIT_MASK_MAX_PX = 256
const HIT_ALPHA_THRESHOLD = 32

function buildHitMask(image: HTMLImageElement, colorKey: string): HTMLCanvasElement | null {
  const scale = Math.min(1, HIT_MASK_MAX_PX / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  let data: ImageData
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  } catch {
    // tainted (cross-origin without CORS) — fall back to the rectangle
    return null
  }

  const r = parseInt(colorKey.slice(1, 3), 16)
  const g = parseInt(colorKey.slice(3, 5), 16)
  const b = parseInt(colorKey.slice(5, 7), 16)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    const opaque = px[i + 3]! > HIT_ALPHA_THRESHOLD
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
    px[i + 3] = opaque ? 255 : 0
  }
  ctx.putImageData(data, 0, 0)
  return canvas
}

const DraggableImage = memo(function DraggableImage({
  item,
  isSelected,
  hidden,
  dimmed,
  isGestureOwner,
  onChange,
}: {
  item: LayerItem
  isSelected: boolean
  // crop mode draws its own copy of the layer; this one steps aside
  hidden: boolean
  dimmed: boolean
  isGestureOwner: (id: string) => boolean
  onChange: (id: string, patch: Partial<Omit<LayerItem, 'id' | 'src'>>) => void
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [dims, setDims] = useState({ w: 120, h: 120 })
  const ref = useRef<Konva.Image>(null)
  const blockedDrag = useRef(false)
  const hitMask = useRef<{ image: HTMLImageElement; colorKey: string; mask: HTMLCanvasElement | null } | null>(null)

  useEffect(() => {
    let cancelled = false

    // the loaded image is shared via imageCache, so cancellation here only
    // stops this component acting on a stale result — it must not abort the
    // shared load, which other mounted (or future) consumers may depend on
    loadImage(item.src)
      .then((small) => {
        if (cancelled) return
        setDims(baseSize(small))
        setImg(small)
      })
      .catch((err: unknown) => console.error('failed to load', item.src, err))

    return () => {
      cancelled = true
    }
  }, [item.src])

  // Konva will happily drag several nodes at once (one per finger) — only
  // the image the gesture started on may move, everything else stays put
  const handleDragStart = () => {
    if (isGestureOwner(item.id)) return
    blockedDrag.current = true
    ref.current?.stopDrag()
  }

  const handleDragEnd = () => {
    const node = ref.current
    if (!node) return
    if (blockedDrag.current) {
      blockedDrag.current = false
      node.position({ x: item.x, y: item.y })
      return
    }
    onChange(item.id, { x: node.x(), y: node.y() })
  }

  const crop = item.crop ?? FULL_CROP
  // the visible part, in canvas units at scale 1
  const width = dims.w * crop.width
  const height = dims.h * crop.height

  const hitFunc = (ctx: Konva.Context, shape: Konva.Shape) => {
    const cached = hitMask.current
    if (!cached || cached.image !== img || cached.colorKey !== shape.colorKey) {
      hitMask.current = { image: img!, colorKey: shape.colorKey, mask: buildHitMask(img!, shape.colorKey) }
    }
    const mask = hitMask.current!.mask
    if (!mask) {
      ctx.beginPath()
      ctx.rect(0, 0, shape.width(), shape.height())
      ctx.closePath()
      ctx.fillStrokeShape(shape)
      return
    }
    // smoothing would blend edge pixels into colours that match no shape
    const native = ctx._context
    const smoothing = native.imageSmoothingEnabled
    native.imageSmoothingEnabled = false
    native.drawImage(
      mask,
      crop.x * mask.width,
      crop.y * mask.height,
      crop.width * mask.width,
      crop.height * mask.height,
      0,
      0,
      shape.width(),
      shape.height(),
    )
    native.imageSmoothingEnabled = smoothing
  }

  if (!img) return null

  return (
    <KonvaImage
      id={item.id}
      ref={ref}
      image={img}
      x={item.x}
      y={item.y}
      scaleX={item.scale * (item.flipX ? -1 : 1)}
      scaleY={item.scale * (item.flipY ? -1 : 1)}
      rotation={item.rotation}
      width={width}
      height={height}
      offsetX={width / 2}
      offsetY={height / 2}
      // Konva's own crop: drawn from the untouched image, so it's
      // non-destructive and can always be widened again. Always a full
      // object — Konva's setter can't take undefined when a crop is reset
      crop={{
        x: crop.x * img.width,
        y: crop.y * img.height,
        width: crop.width * img.width,
        height: crop.height * img.height,
      }}
      visible={!hidden}
      opacity={dimmed ? 0.4 : 1}
      draggable
      hitFunc={hitFunc}
      stroke={isSelected ? '#4ade80' : undefined}
      strokeWidth={isSelected ? 3 : 0}
      // the stage is scaled to fit the frame — keep the outline 3 screen px
      strokeScaleEnabled={false}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    />
  )
})

export default DraggableImage
