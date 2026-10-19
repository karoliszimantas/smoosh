import { useEffect, useMemo, useRef } from 'react'
import { Layer, Rect, Circle, Group, Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import { baseSize, FULL_CROP, MAX_ERASE_STROKES, type EraseStroke, type LayerItem } from './layerItem'
import { eraseSegment, renderErased, roundCoord } from './erase'
import { eraseOffset } from './eraseReach'
import { useTheme } from '../themes/useTheme'

const OUTSIDE = 20000
// a new path point once the finger has moved this far (screen px) — the
// segments between points are interpolated, so this only bounds data size
const MIN_POINT_GAP_PX = 3

type Point = { x: number; y: number }
type Live = { pointerId: number; last: Point; screen: Point; points: number[] }

// Erase mode: the rest of the canvas dims, the layer shows as it really is
// (crop, mirror, rotation, opacity), and a finger dragged over it erases.
// The stroke is stamped live onto a working copy of the image and handed
// up as data on finger-up — one finger-down to finger-up is one undoable
// stroke. Strokes are kept in the full image's own space, so they move with
// the picture through every later transform.
//
// On touch the brush works above the finger, not under it (eraseReach.ts),
// from the first contact; the brush ring shows where, and how big. A stroke
// follows its finger even off the canvas — over the layer strip, say — so
// the bottom edge can be reached with the brush still above the finger.
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
  // the brush ring: starts on the layer so the size is visible before the
  // first touch, then moved straight on the node — no render per move
  const cursorRef = useRef<Konva.Group>(null)

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

  // where the brush is for this pointer event, in stage pixels: above a
  // finger, right at a mouse or a stylus. Read from the event itself, not
  // the stage, so it holds with the finger off the canvas — but the brush
  // itself stays on it: a finger dragged on down past the bottom runs it
  // along the edge, the ring still in sight, never under the strip or tools
  const brushAt = (evt: PointerEvent): Point | null => {
    const stage = imageRef.current?.getStage()
    if (!stage) return null
    const box = stage.container().getBoundingClientRect()
    const x = evt.clientX - box.left
    const y = evt.clientY - box.top
    const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v))
    return { x: clamp(x, stage.width()), y: clamp(y - eraseOffset(evt.pointerType, y, brushPx), stage.height()) }
  }

  // a stage point in the full image's pixels (crop/mirror/rotation undone)
  const inImage = (screen: Point) => {
    const node = imageRef.current
    if (!node) return null
    const local = node.getAbsoluteTransform().copy().invert().point(screen)
    return { x: crop.x * W + local.x / u, y: crop.y * H + local.y / u, screen }
  }

  const moveCursor = (screen: Point) => {
    const ring = cursorRef.current
    const layer = ring?.getLayer()
    if (!ring || !layer) return
    ring.position(layer.getAbsoluteTransform().copy().invert().point(screen))
    layer.batchDraw()
  }

  const stampTo = (to: { x: number; y: number }, from: { x: number; y: number }) => {
    const ctx = working.getContext('2d')
    if (!ctx) return
    eraseSegment(ctx, from.x, from.y, to.x, to.y, radiusPx)
    imageRef.current?.getLayer()?.batchDraw()
  }

  const down = (e: Konva.KonvaEventObject<PointerEvent>) => {
    // one finger erases; a second one is ignored, not a second stroke
    if (live.current) return
    const at = brushAt(e.evt)
    if (!at) return
    moveCursor(at)
    if (full) return
    const p = inImage(at)
    if (!p) return
    live.current = {
      pointerId: e.evt.pointerId,
      last: p,
      screen: p.screen,
      points: [roundCoord(p.x / W), roundCoord(p.y / H)],
    }
    stampTo(p, p)
  }

  // a mouse or a stylus hovering: the ring follows, ready
  const hover = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (live.current) return
    const at = brushAt(e.evt)
    if (at) moveCursor(at)
  }

  // a stroke under way — heard from the window, so it carries on past the
  // canvas's edge
  const move = (evt: PointerEvent) => {
    const l = live.current
    if (!l || evt.pointerId !== l.pointerId) return
    const at = brushAt(evt)
    if (!at) return
    moveCursor(at)
    const p = inImage(at)
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
  const handlers = useRef({ move, finish })
  useEffect(() => {
    handlers.current = { move, finish }
  })
  useEffect(() => {
    const onWindowMove = (e: PointerEvent) => handlers.current.move(e)
    const onWindowUp = (e: PointerEvent) => handlers.current.finish(e.pointerId)
    window.addEventListener('pointermove', onWindowMove)
    window.addEventListener('pointerup', onWindowUp)
    window.addEventListener('pointercancel', onWindowUp)
    return () => {
      window.removeEventListener('pointermove', onWindowMove)
      window.removeEventListener('pointerup', onWindowUp)
      window.removeEventListener('pointercancel', onWindowUp)
    }
  }, [])

  const ringRadius = brushPx / 2 / stageScale

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
        onPointerMove={hover}
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
      {/* the brush: a ring the size of what it removes, with nothing over
          the middle — that's the edge being worked on — but a dot to aim
          with. A ring in the page's colour inside the coloured one keeps it
          seen on any picture, light or dark */}
      <Group ref={cursorRef} x={item.x} y={item.y} opacity={full ? 0.35 : 1} listening={false}>
        <Circle radius={ringRadius} stroke={theme.selectionColor} strokeWidth={2} strokeScaleEnabled={false} />
        <Circle radius={Math.max(0, ringRadius - 2 / stageScale)} stroke={theme.pageBg} strokeWidth={1} strokeScaleEnabled={false} />
        <Circle radius={1.5 / stageScale} fill={theme.selectionColor} />
      </Group>
    </Layer>
  )
}
