import { useEffect, useRef, useState, memo } from 'react'
import { Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import type { LayerItem } from './layerItem'

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

const DraggableImage = memo(function DraggableImage({
  item,
  isSelected,
  isGestureOwner,
  onChange,
}: {
  item: LayerItem
  isSelected: boolean
  isGestureOwner: (id: string) => boolean
  onChange: (id: string, patch: Partial<Omit<LayerItem, 'id' | 'src'>>) => void
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [dims, setDims] = useState({ w: 120, h: 120 })
  const ref = useRef<Konva.Image>(null)
  const blockedDrag = useRef(false)

  useEffect(() => {
    let cancelled = false

    // the loaded image is shared via imageCache, so cancellation here only
    // stops this component acting on a stale result — it must not abort the
    // shared load, which other mounted (or future) consumers may depend on
    loadImage(item.src)
      .then((small) => {
        if (cancelled) return
        const maxSide = Math.min(window.innerWidth, window.innerHeight) * 0.3
        const ratio = small.width / small.height
        setDims({
          w: ratio > 1 ? maxSide : maxSide * ratio,
          h: ratio > 1 ? maxSide / ratio : maxSide,
        })
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

  if (!img) return null

  return (
    <KonvaImage
      id={item.id}
      ref={ref}
      image={img}
      x={item.x}
      y={item.y}
      scaleX={item.scale}
      scaleY={item.scale}
      rotation={item.rotation}
      width={dims.w}
      height={dims.h}
      offsetX={dims.w / 2}
      offsetY={dims.h / 2}
      draggable
      stroke={isSelected ? '#4ade80' : undefined}
      strokeWidth={isSelected ? 3 : 0}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    />
  )
})

export default DraggableImage
