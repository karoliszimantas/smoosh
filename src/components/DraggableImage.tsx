import { useEffect, useMemo, useRef, useState, memo } from 'react'
import { Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import { FULL_CROP, MIN_SCALE, baseSize, type CropRect, type LayerItem } from './layerItem'
import { erasedFor } from './erase'
import { loadImage } from './imageCache'
import { stickerSprite, type StickerOptions } from './stickerEdge'
import { CANVAS_UNITS_PER_THEME_PX, liveShadow, stickerOptions } from './layerLook'
import { isExporting } from './canvasExport'
import { useTheme } from '../themes/useTheme'
import { EXPORT_LOOK, pictureLook, type PictureLook } from '../themes/exportLook'

// a cut-out is mostly transparent, but Konva hit-tests its whole rectangle —
// so a rotated layer's invisible corners would grab touches meant for the
// layer beside it. The hit mask paints only the opaque pixels, in the
// shape's hit colour, so taps on the transparent parts fall through.
const HIT_MASK_MAX_PX = 256
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

// a layer's sticker, from the cache: its erased image, inside its crop
function spriteFor(erased: HTMLImageElement | HTMLCanvasElement | null, crop: CropRect, options: StickerOptions | null) {
  if (!erased || !options) return null
  const w = erased.width
  const h = erased.height
  return stickerSprite(erased, { x: crop.x * w, y: crop.y * h, width: crop.width * w, height: crop.height * h }, options)
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
  onCutout,
}: {
  item: LayerItem
  // crop mode draws its own copy of the layer; this one steps aside
  hidden: boolean
  dimmed: boolean
  isGestureOwner: (id: string) => boolean
  onChange: (id: string, patch: Partial<Omit<LayerItem, 'id' | 'src'>>) => void
  // whether the layer, once its image is in, is a cut-out — the only kind
  // with a sticker edge to take off
  onCutout: (id: string, cutout: boolean) => void
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

  // A cut-out (anything with real transparency — never a whole photo) is a
  // die-cut sticker: a rim of the theme's paper round what's left of it
  // after erasing, inside its crop, with its lift shadow baked in under it —
  // Konva would blur that afresh for every layer on every frame, the
  // costliest part of a frame. The rim is the same width on screen at any
  // scale, like the shadow, so it's rebuilt when the scale is committed (a
  // gesture in progress just scales it with the layer).
  const opaque = erased ? isOpaque(erased) : true
  const scale = Math.max(drawn.scale, MIN_SCALE)
  const cropLongSide = Math.max(src.width, src.height)
  const noEdge = drawn.noEdge === true
  const screenSticker = useMemo(
    () => stickerOptions(theme, { unitsPerSourcePx: u, scale, cropLongSide, opaque, noEdge }),
    [theme, u, scale, cropLongSide, opaque, noEdge],
  )
  // the same layer as it's sent: in the export's look, whatever the theme
  const exportSticker = useMemo(
    () => stickerOptions(EXPORT_LOOK, { unitsPerSourcePx: u, scale, cropLongSide, opaque, noEdge }),
    [u, scale, cropLongSide, opaque, noEdge],
  )
  const cutout = erased !== null && !opaque
  useEffect(() => onCutout(item.id, cutout), [onCutout, item.id, cutout])
  // on screen: built when the layer changes. The export's is built (or found
  // in the cache: it's the same sprite when the looks agree) as it's drawn
  const sprite = useMemo(() => spriteFor(erased, crop, screenSticker), [erased, crop, screenSticker])

  // the baked shadow's drop, in canvas units: straight down the frame
  const dropOf = (look: PictureLook) => ({
    x: look.layerShadowOffset.x * CANVAS_UNITS_PER_THEME_PX,
    y: look.layerShadowOffset.y * CANVAS_UNITS_PER_THEME_PX,
  })
  const drop = dropOf(theme)
  // in node units, how far the sprite, its shadow and the shadow's drop reach
  // past the node's box on any side — freezeOthers reads it to size a
  // snapshot that holds them all
  const spritePad = sprite ? sprite.reach * u + (sprite.shadow ? Math.hypot(drop.x, drop.y) / scale : 0) : 0

  // The sprite (the rim, with the image on top) drawn spilling past the
  // node's box: width, height, offsets, hitFunc and the transform maths all
  // stay the image's own, so the selection, hit tests and gestures don't
  // know the rim is there. The shadow first, its drop taken back through the
  // node's own turn, scale and mirror — read live, so it still falls
  // straight down mid-gesture. During the export, the export's sprite.
  const sceneFunc =
    sprite || exportSticker
      ? (ctx: Konva.Context, shape: Konva.Shape) => {
          const exporting = isExporting(shape)
          const drawing = exporting ? spriteFor(erased, crop, exportSticker) : sprite
          if (!drawing) {
            // no sticker in this look: the image as Konva would draw it
            if (erased) ctx.drawImage(erased, src.x, src.y, src.width, src.height, 0, 0, width, height)
            return
          }
          const p = drawing.pad
          const shadow = drawing.shadow
          if (shadow) {
            const { x: dropX, y: dropY } = dropOf(pictureLook(theme, exporting))
            const t = (shape.rotation() * Math.PI) / 180
            const cos = Math.cos(t)
            const sin = Math.sin(t)
            const ox = (dropX * cos + dropY * sin) / shape.scaleX()
            const oy = (dropY * cos - dropX * sin) / shape.scaleY()
            ctx.drawImage(shadow.canvas, (shadow.x - p) * u + ox, (shadow.y - p) * u + oy, shadow.width * u, shadow.height * u)
          }
          ctx.drawImage(drawing.canvas, -p * u, -p * u, drawing.canvas.width * u, drawing.canvas.height * u)
        }
      : undefined
  // Konva's own shadow, where no sticker baked one in: on screen, and the
  // attrs the export swaps in for its capture (applyExportLook)
  const mirrored = drawn.mirrored
  const shadowAttrs = liveShadow(theme, { opaque, scale, mirrored, stickerShadow: !!sprite?.shadow })
  const exportShadowAttrs = useMemo(
    () => liveShadow(EXPORT_LOOK, { opaque, scale, mirrored, stickerShadow: !!exportSticker?.shadow }),
    [opaque, scale, mirrored, exportSticker],
  )

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
      {...shadowAttrs}
      exportAttrs={exportShadowAttrs}
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
