import { useEffect, useMemo, useRef, useState } from 'react'
import { Layer, Rect, Circle, Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import { baseSize, FULL_CROP, MAX_ERASE_STROKES, type EraseStroke, type LayerItem } from './layerItem'
import { eraseSegment, renderErased, roundCoord } from './erase'
import { useTheme } from '../themes/useTheme'

const OUTSIDE = 20000
// a new path point once the finger has moved this far (screen px) — the
// segments between points are interpolated, so this only bounds data size
const MIN_POINT_GAP_PX = 3

type Live = { pointerId: number; last: { x: number; y: number }; screen: { x: number; y: number }; points: number[] }

// Erase mode: the rest of the canvas dims, the layer shows as it really is
// (crop, mirror, rotation, opacity), and a finger dragged over it erases.
// The stroke is stamped live onto a working copy of the image and handed
// up as data on finger-up — one finger-down to finger-up is one undoable
// stroke. Strokes are kept in the full image's own space, so they move with
// the picture through every later transform.
export default function EraseOverlay({
  item,
  image,
  stageScale,
  brushPx,
  onStroke,
}: {
  item: LayerItem
  image: HTMLImageElement
  // canvas units → screen pixels
  stageScale: number
  // brush diameter in screen pixels
  brushPx: number
  onStroke: (stroke: EraseStroke) => void
}) {
  const theme = useTheme()
  const imageRef = useRef<Konva.Image>(null)
  const live = useRef<Live | null>(null)
  // the brush preview, in canvas units — starts on the layer so the size is
  // visible before the first touch
  const [cursor, setCursor] = useState({ x: item.x, y: item.y })

  const W = image.width
  const H = image.height
  const base = baseSize(image)
  const u = base.w / W // canvas units per image pixel
  const crop = item.crop ?? FULL_CROP
  const width = crop.width * W * u
  const height = crop.height * H * u
  const full = (item.erase?.length ?? 0) >= MAX_ERASE_STROKES

  // the image with every committed stroke; a live stroke is stamped straight
  // onto this same canvas, and when it's committed the replay reproduces it
  const working = useMemo(() => renderErased(image, item.erase ?? []), [image, item.erase])

  // brush radius in image pixels: screen px → canvas units → image px
  const radiusPx = brushPx / 2 / (stageScale * item.scale) / u

  // where the pointer is, in the full image's pixels (crop/mirror/rotation undone)
  const pointerInImage = () => {
    const node = imageRef.current
    const pos = node?.getStage()?.getPointerPosition()
    if (!node || !pos) return null
    const local = node.getAbsoluteTransform().copy().invert().point(pos)
    return { x: crop.x * W + local.x / u, y: crop.y * H + local.y / u, screen: pos }
  }

  const moveCursor = () => {
    const node = imageRef.current
    const pos = node?.getStage()?.getPointerPosition()
    const layer = node?.getLayer()
    if (!pos || !layer) return
    setCursor(layer.getAbsoluteTransform().copy().invert().point(pos))
  }

  const stampTo = (to: { x: number; y: number }, from: { x: number; y: number }) => {
    const ctx = working.getContext('2d')
    if (!ctx) return
    eraseSegment(ctx, from.x, from.y, to.x, to.y, radiusPx)
    imageRef.current?.getLayer()?.batchDraw()
  }

  const down = (e: Konva.KonvaEventObject<PointerEvent>) => {
    moveCursor()
    // one finger erases; a second one is ignored, not a second stroke
    if (live.current || full) return
    const p = pointerInImage()
    if (!p) return
    live.current = {
      pointerId: e.evt.pointerId,
      last: p,
      screen: p.screen,
      points: [roundCoord(p.x / W), roundCoord(p.y / H)],
    }
    stampTo(p, p)
  }

  const move = (e: Konva.KonvaEventObject<PointerEvent>) => {
    moveCursor()
    const l = live.current
    if (!l || e.evt.pointerId !== l.pointerId) return
    const p = pointerInImage()
    if (!p) return
    if (Math.hypot(p.screen.x - l.screen.x, p.screen.y - l.screen.y) < MIN_POINT_GAP_PX) return
    // interpolated between samples — a fast swipe is a line, not dots
    stampTo(p, l.last)
    l.last = p
    l.screen = p.screen
    l.points.push(roundCoord(p.x / W), roundCoord(p.y / H))
  }

  const finish = (pointerId: number) => {
    const l = live.current
    if (!l || pointerId !== l.pointerId) return
    live.current = null
    onStroke({ r: roundCoord(radiusPx / W), p: l.points })
  }
  const up = (e: Konva.KonvaEventObject<PointerEvent>) => finish(e.evt.pointerId)

  // a finger lifted off the canvas (over the toolbar, say) never reaches the
  // stage — the stroke still ends there, rather than hanging open
  const finishRef = useRef(finish)
  useEffect(() => {
    finishRef.current = finish
  })
  useEffect(() => {
    const onWindowUp = (e: PointerEvent) => finishRef.current(e.pointerId)
    window.addEventListener('pointerup', onWindowUp)
    window.addEventListener('pointercancel', onWindowUp)
    return () => {
      window.removeEventListener('pointerup', onWindowUp)
      window.removeEventListener('pointercancel', onWindowUp)
    }
  }, [])

  return (
    <Layer name="erase-overlay">
      {/* dims everything else, and takes every touch while erasing */}
      <Rect
        x={-OUTSIDE}
        y={-OUTSIDE}
        width={OUTSIDE * 2}
        height={OUTSIDE * 2}
        fill={theme.pageBg}
        opacity={0.78}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <KonvaImage
        ref={imageRef}
        image={working}
        x={item.x}
        y={item.y}
        rotation={item.rotation}
        scaleX={item.scale * (item.mirrored ? -1 : 1)}
        scaleY={item.scale}
        width={width}
        height={height}
        offsetX={width / 2}
        offsetY={height / 2}
        crop={{ x: crop.x * W, y: crop.y * H, width: crop.width * W, height: crop.height * H }}
        opacity={item.opacity}
        listening={false}
      />
      <Circle
        x={cursor.x}
        y={cursor.y}
        radius={brushPx / 2 / stageScale}
        fill={theme.selectionColor}
        opacity={full ? 0.1 : 0.28}
        stroke={theme.selectionColor}
        strokeWidth={2}
        strokeScaleEnabled={false}
        listening={false}
      />
    </Layer>
  )
}
