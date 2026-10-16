import { useEffect, useMemo, useRef, useState, memo } from 'react'
import { Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import { CANVAS_SIZE, FULL_CROP, MIN_SCALE, baseSize, type LayerItem } from './layerItem'
import { erasedFor } from './erase'
import { loadImage } from './imageCache'
import { stickerRadius, stickerSprite } from './stickerEdge'
import { useTheme } from '../themes/useTheme'

// a cut-out is mostly transparent, but Konva hit-tests its whole rectangle —
// so a rotated layer's invisible corners would grab touches meant for the
// layer beside it. The hit mask paints only the opaque pixels, in the
// shape's hit colour, so taps on the transparent parts fall through.
const HIT_MASK_MAX_PX = 256
// theme sizes for canvas drawing are screen pixels on a 400px-wide frame;
// this many canvas units make one of them
const CANVAS_UNITS_PER_THEME_PX = CANVAS_SIZE / 400
const HIT_ALPHA_THRESHOLD = 32

// Rectangular, or cut out: does the image have any real transparency? A
// cut-out, a photo cut with the lasso and a layer with eraser strokes all
// do; a full photo or a library background doesn't. Read from a small copy,
// once per image.
const OPAQUE_SAMPLE_PX = 64
const opaqueCache = new WeakMap<HTMLImageElement | HTMLCanvasElement, boolean>()
function isOpaque(image: HTMLImageElement | HTMLCanvasElement): boolean {
  const known = opaqueCache.get(image)
  if (known !== undefined) return known
  const scale = Math.min(1, OPAQUE_SAMPLE_PX / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  let opaque = false
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (ctx) {
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let clear = 0
      for (let i = 3; i < px.length; i += 4) if ((px[i] ?? 0) < 250) clear++
      // a few soft pixels at a resampled edge don't make a cut-out
      opaque = clear / (px.length / 4) < 0.01
    }
  } catch {
    // tainted: can't tell — treat as rectangular, as before
    opaque = true
  }
  canvas.width = 0
  canvas.height = 0
  opaqueCache.set(image, opaque)
  return opaque
}

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
  hidden,
  dimmed,
  isGestureOwner,
  onChange,
}: {
  item: LayerItem
  // crop mode draws its own copy of the layer; this one steps aside
  hidden: boolean
  dimmed: boolean
  isGestureOwner: (id: string) => boolean
  onChange: (id: string, patch: Partial<Omit<LayerItem, 'id' | 'src'>>) => void
}) {
  // the image on show, the src it's from, and its size on the canvas
  const [shown, setShown] = useState<{ src: string; img: HTMLImageElement; dims: { w: number; h: number } } | null>(null)
  const img = shown?.img ?? null
  const dims = shown?.dims ?? { w: 120, h: 120 }
  // The layer as it was when its image last matched its src. A new src
  // (a cut-out swapped in for the whole picture, a local cut for its shared
  // copy) comes with new geometry for the new image — scale, crop, erasing —
  // so until that image has decoded, the old one is drawn as it was
  const [fitted, setFitted] = useState(item)
  if (shown?.src === item.src && fitted !== item) setFitted(item)
  const drawn = shown?.src === item.src ? item : fitted
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
    () => (img && drawn.erase && drawn.erase.length > 0 ? erasedFor(img, drawn.erase) : img),
    [img, drawn.erase],
  )

  useEffect(() => {
    let cancelled = false

    // the loaded image is shared via imageCache, so cancellation here only
    // stops this component acting on a stale result — it must not abort the
    // shared load, which other mounted (or future) consumers may depend on
    loadImage(item.src)
      .then((small) => {
        if (cancelled) return
        setShown({ src: item.src, img: small, dims: baseSize(small) })
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

  const crop = drawn.crop ?? FULL_CROP

  // the part of the image to draw — the crop is in the original image's terms
  const W = img?.width ?? 1
  const H = img?.height ?? 1
  const u = dims.w / W // canvas units per source pixel
  const src = { x: crop.x * W, y: crop.y * H, width: crop.width * W, height: crop.height * H }
  const width = src.width * u
  const height = src.height * u
  // the node's origin is the centre of the crop (what x/y and the crop maths
  // assume)
  const offsetX = width / 2
  const offsetY = height / 2

  // Konva scales shadow sizes by the node's absolute scale; divide out the
  // layer's own scale so the shadow is the theme's size whatever the layer's,
  // and undo a mirror's sign so the shadow still falls downward
  const shadowScale = CANVAS_UNITS_PER_THEME_PX / Math.max(drawn.scale, MIN_SCALE)

  const hitFunc = (ctx: Konva.Context, shape: Konva.Shape) => {
    const source = erased
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

  // the theme's shadow — unless this is a cut-out and the theme's shadow is a
  // glow that would halo its edge
  const shadowed = useMemo(() => (erased ? theme.cutoutShadow || isOpaque(erased) : false), [erased, theme.cutoutShadow])

  // A cut-out (anything with real transparency — never a whole photo) is a
  // die-cut sticker: a rim of the theme's paper round what's left of it
  // after erasing, inside its crop. The rim is the same width on screen at
  // any scale, like the shadow, so it's rebuilt when the scale is committed
  // (a gesture in progress just scales it with the layer).
  const edge = theme.stickerEdge
  const radius =
    edge && erased && !isOpaque(erased)
      ? stickerRadius(CANVAS_UNITS_PER_THEME_PX, edge.width, u, Math.max(drawn.scale, MIN_SCALE), Math.max(src.width, src.height))
      : 0
  const edgeColor = edge?.color
  const edgeWidth = edge?.width ?? 0
  // The lift shadow goes under the rim. Konva would blur it afresh for
  // every layer on every frame — the costliest part of a frame — so the
  // sprite bakes it in once instead, from the same silhouette and in the
  // theme's terms: colour, and blur in canvas units
  const shadowColor = shadowed ? theme.layerShadowColor : null
  const shadowBlur = theme.layerShadowBlur * CANVAS_UNITS_PER_THEME_PX
  const sprite = useMemo(() => {
    if (!erased || !edgeColor || radius <= 0) return null
    const w = erased.width
    const h = erased.height
    const rect = { x: crop.x * w, y: crop.y * h, width: crop.width * w, height: crop.height * h }
    return stickerSprite(erased, rect, {
      radius,
      color: edgeColor,
      // what the rounded radius stands for: the rim's width in units over it
      unitsPerSourcePx: (edgeWidth * CANVAS_UNITS_PER_THEME_PX) / radius,
      shadow: shadowColor ? { color: shadowColor, blur: shadowBlur } : null,
    })
  }, [erased, crop, radius, edgeColor, edgeWidth, shadowColor, shadowBlur])

  // the baked shadow's drop, in canvas units: straight down the frame
  const dropX = theme.layerShadowOffset.x * CANVAS_UNITS_PER_THEME_PX
  const dropY = theme.layerShadowOffset.y * CANVAS_UNITS_PER_THEME_PX
  // in node units, how far the sprite, its shadow and the shadow's drop reach
  // past the node's box on any side — freezeOthers reads it to size a
  // snapshot that holds them all
  const spritePad = sprite
    ? sprite.reach * u + (sprite.shadow ? Math.hypot(dropX, dropY) / Math.max(drawn.scale, MIN_SCALE) : 0)
    : 0

  // The sprite (the rim, with the image on top) drawn spilling past the
  // node's box: width, height, offsets, hitFunc and the transform maths all
  // stay the image's own, so the selection, hit tests and gestures don't
  // know the rim is there. The shadow first, its drop taken back through the
  // node's own turn, scale and mirror — read live, so it still falls
  // straight down mid-gesture.
  const sceneFunc = sprite
    ? (ctx: Konva.Context, shape: Konva.Shape) => {
        const p = sprite.pad
        const shadow = sprite.shadow
        if (shadow) {
          const t = (shape.rotation() * Math.PI) / 180
          const cos = Math.cos(t)
          const sin = Math.sin(t)
          const ox = (dropX * cos + dropY * sin) / shape.scaleX()
          const oy = (dropY * cos - dropX * sin) / shape.scaleY()
          ctx.drawImage(shadow.canvas, (shadow.x - p) * u + ox, (shadow.y - p) * u + oy, shadow.width * u, shadow.height * u)
        }
        ctx.drawImage(sprite.canvas, -p * u, -p * u, sprite.canvas.width * u, sprite.canvas.height * u)
      }
    : undefined
  // with the shadow baked in, Konva's own stays off
  const liveShadow = shadowed && !sprite?.shadow

  if (!img || !erased) return null

  return (
    <KonvaImage
      id={item.id}
      ref={ref}
      image={erased}
      x={drawn.x}
      y={drawn.y}
      scaleX={drawn.scale * (drawn.mirrored ? -1 : 1)}
      scaleY={drawn.scale}
      rotation={drawn.rotation}
      width={width}
      height={height}
      offsetX={offsetX}
      offsetY={offsetY}
      // Konva's own crop: drawn from the untouched image, so it's
      // non-destructive and can always be widened again. Always a full
      // object — Konva's setter can't take undefined when a crop is reset
      crop={src}
      shadowColor={liveShadow ? theme.layerShadowColor : undefined}
      shadowEnabled={liveShadow}
      shadowBlur={theme.layerShadowBlur * shadowScale}
      shadowOffsetX={theme.layerShadowOffset.x * shadowScale * (drawn.mirrored ? -1 : 1)}
      shadowOffsetY={theme.layerShadowOffset.y * shadowScale}
      visible={!hidden}
      opacity={item.opacity * (dimmed ? 0.4 : 1)}
      // the one place a lock acts: a node that doesn't listen isn't in Konva's
      // hit test, so a tap, drag, pinch or long-press finds the layer beneath
      // it instead (Canvas takes every gesture's target from that hit test)
      listening={!item.locked}
      draggable={!item.locked}
      hitFunc={hitFunc}
      sceneFunc={sceneFunc}
      stickerPad={spritePad}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    />
  )
})

export default DraggableImage
