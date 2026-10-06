import { useEffect, useMemo, useRef, useState, memo } from 'react'
import { Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import { FULL_CROP, MIN_SCALE, baseSize, type LayerItem } from './layerItem'
import { CANVAS_UNITS_PER_THEME_PX, paperFor } from './paper'
import { erasedFor } from './erase'
import { loadImage } from './imageCache'
import { useTheme } from '../themes/useTheme'

// a cut-out is mostly transparent, but Konva hit-tests its whole rectangle —
// so a rotated layer's invisible corners would grab touches meant for the
// layer beside it. The hit mask paints only the opaque pixels, in the
// shape's hit colour, so taps on the transparent parts fall through.
const HIT_MASK_MAX_PX = 256
const HIT_ALPHA_THRESHOLD = 32

function buildHitMask(image: HTMLImageElement | HTMLCanvasElement, colorKey: string): HTMLCanvasElement | null {
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
  const hitMask = useRef<{
    source: HTMLImageElement | HTMLCanvasElement
    colorKey: string
    mask: HTMLCanvasElement | null
  } | null>(null)
  const theme = useTheme()

  // the image with its eraser strokes replayed — rebuilt only when the
  // strokes change (a new array), never per frame, and shared with any
  // duplicate that still has the same strokes
  const erased = useMemo(
    () => (img && item.erase && item.erase.length > 0 ? erasedFor(img, item.erase) : img),
    [img, item.erase],
  )

  // the image as the theme prints it (border + torn edge) — built once per
  // image and theme, then cached; switching theme swaps the source only,
  // never the layer's position, scale, rotation or order. Built from the
  // erased image, so the border follows what's left
  const paper = useMemo(
    () =>
      erased && img
        ? paperFor(erased, theme.layerBorderColor, theme.layerBorderWidth, dims.w / img.width, item.src)
        : null,
    [erased, img, theme.layerBorderColor, theme.layerBorderWidth, dims.w, item.src],
  )

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

  // The part of the paper to draw. The crop is in the original image's
  // terms; the paper adds `pad` all round. An edge the crop leaves alone
  // keeps its paper border; an edge the crop cuts is cut straight through,
  // like scissors would.
  const W = img?.width ?? 1
  const H = img?.height ?? 1
  const pad = paper?.pad ?? 0
  const u = dims.w / W // canvas units per source pixel
  const eps = 1e-3
  const padL = crop.x < eps ? pad : 0
  const padT = crop.y < eps ? pad : 0
  const padR = crop.x + crop.width > 1 - eps ? pad : 0
  const padB = crop.y + crop.height > 1 - eps ? pad : 0
  const cropW = crop.width * W
  const cropH = crop.height * H
  const src = { x: crop.x * W + pad - padL, y: crop.y * H + pad - padT, width: cropW + padL + padR, height: cropH + padT + padB }
  const width = src.width * u
  const height = src.height * u
  // the node's origin stays the centre of the crop itself (what x/y and the
  // crop maths assume), however much border hangs off each side
  const offsetX = (padL + cropW / 2) * u
  const offsetY = (padT + cropH / 2) * u

  // Konva scales shadow sizes by the node's absolute scale; divide out the
  // layer's own scale so the shadow is the theme's size whatever the layer's,
  // and undo a mirror's sign so the shadow still falls downward
  const shadowScale = CANVAS_UNITS_PER_THEME_PX / Math.max(item.scale, MIN_SCALE)

  const hitFunc = (ctx: Konva.Context, shape: Konva.Shape) => {
    const source = paper?.source ?? img
    if (!source) return
    const cached = hitMask.current
    if (!cached || cached.source !== source || cached.colorKey !== shape.colorKey) {
      hitMask.current = { source, colorKey: shape.colorKey, mask: buildHitMask(source, shape.colorKey) }
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
    const sx = mask.width / source.width
    const sy = mask.height / source.height
    native.drawImage(
      mask,
      src.x * sx,
      src.y * sy,
      src.width * sx,
      src.height * sy,
      0,
      0,
      shape.width(),
      shape.height(),
    )
    native.imageSmoothingEnabled = smoothing
  }

  if (!img || !paper) return null

  return (
    <KonvaImage
      id={item.id}
      ref={ref}
      image={paper.source}
      x={item.x}
      y={item.y}
      scaleX={item.scale * (item.mirrored ? -1 : 1)}
      scaleY={item.scale}
      rotation={item.rotation}
      width={width}
      height={height}
      offsetX={offsetX}
      offsetY={offsetY}
      // Konva's own crop: drawn from the untouched image, so it's
      // non-destructive and can always be widened again. Always a full
      // object — Konva's setter can't take undefined when a crop is reset
      crop={src}
      shadowColor={theme.layerShadowColor}
      shadowBlur={theme.layerShadowBlur * shadowScale}
      shadowOffsetX={theme.layerShadowOffset.x * shadowScale * (item.mirrored ? -1 : 1)}
      shadowOffsetY={theme.layerShadowOffset.y * shadowScale}
      // the selection outline is UI, not paper — it casts no shadow
      shadowForStrokeEnabled={false}
      visible={!hidden}
      opacity={item.opacity * (dimmed ? 0.4 : 1)}
      draggable
      hitFunc={hitFunc}
      stroke={isSelected ? theme.selectionColor : undefined}
      strokeWidth={isSelected ? 3 : 0}
      // the stage is scaled to fit the frame — keep the outline 3 screen px
      strokeScaleEnabled={false}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    />
  )
})

export default DraggableImage
