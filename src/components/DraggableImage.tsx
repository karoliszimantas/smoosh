import { useEffect, useRef, useState, memo } from 'react'
import { Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import type { LayerItem } from './layerItem'

// pipeline assets cap at 800px on their longest side (see tools/cut.ts), so
// this never fires for local assets today — kept for when a remote/search
// source can hand back full-resolution photos
const MAX_SOURCE_PX = 1024

const MIN_SCALE = 0.15
const MAX_SCALE = 5

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

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
  onSelect,
  onChange,
}: {
  item: LayerItem
  isSelected: boolean
  onSelect: (id: string) => void
  onChange: (id: string, patch: Partial<Omit<LayerItem, 'id' | 'src'>>) => void
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [dims, setDims] = useState({ w: 120, h: 120 })
  const ref = useRef<Konva.Image>(null)
  const lastDist = useRef(0)
  const lastAngle = useRef(0)
  const pinching = useRef(false)

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

  const getDistance = (p1: Touch, p2: Touch) =>
    Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY)

  const getAngle = (p1: Touch, p2: Touch) =>
    (Math.atan2(p2.clientY - p1.clientY, p2.clientX - p1.clientX) * 180) / Math.PI

  const commitTransform = () => {
    const node = ref.current
    if (!node) return
    onChange(item.id, { scale: node.scaleX(), rotation: node.rotation() })
  }

  const handleTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches
    if (touches.length !== 2) return

    const touch0 = touches[0]
    const touch1 = touches[1]
    if (!touch0 || !touch1) return

    e.evt.preventDefault()
    const node = ref.current
    if (!node) return

    if (!pinching.current) {
      pinching.current = true
      node.stopDrag()
    }

    const dist = getDistance(touch0, touch1)
    const angle = getAngle(touch0, touch1)

    if (!lastDist.current) lastDist.current = dist
    if (!lastAngle.current) lastAngle.current = angle

    const scale = clamp(node.scaleX() * (dist / lastDist.current), MIN_SCALE, MAX_SCALE)
    node.scaleX(scale)
    node.scaleY(scale)
    node.rotation(node.rotation() + (angle - lastAngle.current))

    lastDist.current = dist
    lastAngle.current = angle
  }

  const handleTouchEnd = (e: Konva.KonvaEventObject<TouchEvent>) => {
    if (e.evt.touches.length >= 2) return
    if (!pinching.current) return

    pinching.current = false
    lastDist.current = 0
    lastAngle.current = 0
    commitTransform()

    // one finger is still down after the pinch — Konva's own drag was
    // stopped mid-gesture, so restart it from here or the layer freezes
    // until re-touched, then jumps
    if (e.evt.touches.length === 1) {
      ref.current?.startDrag()
    }
  }

  const handleDragEnd = () => {
    const node = ref.current
    if (!node) return
    onChange(item.id, { x: node.x(), y: node.y() })
  }

  const handleSelect = () => {
    // selecting must not reorder — the items array in Canvas is the single
    // source of truth for z-order; Konva's own child order is never touched
    onSelect(item.id)
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
      onTouchStart={handleSelect}
      onMouseDown={handleSelect}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onDragEnd={handleDragEnd}
    />
  )
})

export default DraggableImage
