import { Layer, Group, Rect, Circle, Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import { baseSize, cropCenterOffset, FULL_CROP, type CropRect, type LayerItem } from './layerItem'
import { useTheme } from '../themes/useTheme'

// screen pixels, whatever the layer's scale: handles look small but take a
// fingertip-sized touch
const HANDLE_HIT_PX = 22 // radius → 44px target
const HANDLE_DOT_PX = 7
// the crop can't shrink below this on screen, so it stays grabbable
const MIN_CROP_PX = 40
const OUTSIDE = 20000

// which edges a handle moves: l/r/t/b, corners move two
const HANDLES = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'] as const
type Handle = (typeof HANDLES)[number]

export default function CropOverlay({
  item,
  image,
  draft,
  stageScale,
  onDraftChange,
}: {
  item: LayerItem
  image: HTMLImageElement
  draft: CropRect
  // canvas units → screen pixels
  stageScale: number
  onDraftChange: (draft: CropRect) => void
}) {
  const theme = useTheme()
  // everything below is drawn in the FULL image's own space (0..W, 0..H),
  // under the layer's scale, flips and rotation — so handles sit on the
  // image however it's turned, and re-cropping always works against the
  // original bounds, never the current crop
  const base = baseSize(image)
  const W = base.w
  const H = base.h
  const offset = cropCenterOffset(item.crop ?? FULL_CROP, base, item)
  const fullCenter = { x: item.x - offset.x, y: item.y - offset.y }

  // one local unit is this many screen pixels
  const k = stageScale * item.scale
  const hitR = HANDLE_HIT_PX / k
  const dotR = HANDLE_DOT_PX / k
  const minW = Math.min(W, MIN_CROP_PX / k)
  const minH = Math.min(H, MIN_CROP_PX / k)

  const left = draft.x * W
  const top = draft.y * H
  const right = (draft.x + draft.width) * W
  const bottom = (draft.y + draft.height) * H

  const commit = (l: number, t: number, r: number, b: number) =>
    onDraftChange({ x: l / W, y: t / H, width: (r - l) / W, height: (b - t) / H })

  const handlePos = (h: Handle, l = left, t = top, r = right, b = bottom) => ({
    x: h.includes('l') ? l : h.includes('r') ? r : (l + r) / 2,
    y: h.includes('t') ? t : h.includes('b') ? b : (t + b) / 2,
  })

  const dragHandle = (h: Handle) => (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target
    let l = left
    let t = top
    let r = right
    let b = bottom
    if (h.includes('l')) l = Math.min(Math.max(node.x(), 0), r - minW)
    if (h.includes('r')) r = Math.max(Math.min(node.x(), W), l + minW)
    if (h.includes('t')) t = Math.min(Math.max(node.y(), 0), b - minH)
    if (h.includes('b')) b = Math.max(Math.min(node.y(), H), t + minH)
    // pin the handle to where the clamped edge actually is — an edge
    // handle slides along one axis only
    node.position(handlePos(h, l, t, r, b))
    commit(l, t, r, b)
  }

  const dragBody = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target
    const w = right - left
    const h = bottom - top
    const l = Math.min(Math.max(node.x(), 0), W - w)
    const t = Math.min(Math.max(node.y(), 0), H - h)
    node.position({ x: l, y: t })
    commit(l, t, l + w, t + h)
  }

  return (
    <Layer name="crop-overlay">
      {/* everything but the layer being cropped fades back */}
      <Rect
        x={-OUTSIDE}
        y={-OUTSIDE}
        width={OUTSIDE * 2}
        height={OUTSIDE * 2}
        fill={theme.pageBg}
        opacity={0.78}
        listening={false}
      />
      <Group
        x={fullCenter.x}
        y={fullCenter.y}
        rotation={item.rotation}
        scaleX={item.scale * (item.flipX ? -1 : 1)}
        scaleY={item.scale * (item.flipY ? -1 : 1)}
        offsetX={W / 2}
        offsetY={H / 2}
      >
        {/* the whole original, faint, so the player sees what they can get back */}
        <KonvaImage image={image} width={W} height={H} opacity={0.3} listening={false} />
        <KonvaImage
          image={image}
          x={left}
          y={top}
          width={right - left}
          height={bottom - top}
          crop={{
            x: draft.x * image.width,
            y: draft.y * image.height,
            width: draft.width * image.width,
            height: draft.height * image.height,
          }}
          listening={false}
        />
        <Rect
          x={left}
          y={top}
          width={right - left}
          height={bottom - top}
          // invisible fill so the whole inside takes the drag
          fill="transparent"
          stroke={theme.selectionColor}
          strokeWidth={2}
          strokeScaleEnabled={false}
          draggable
          onDragMove={dragBody}
        />
        {HANDLES.map((h) => {
          const pos = handlePos(h)
          return (
            <Group key={h} x={pos.x} y={pos.y} draggable onDragMove={dragHandle(h)}>
              <Circle radius={hitR} fill="transparent" />
              <Circle
                radius={dotR}
                fill={theme.selectionColor}
                stroke={theme.canvasBg}
                strokeWidth={1.5}
                strokeScaleEnabled={false}
                listening={false}
              />
            </Group>
          )
        })}
      </Group>
    </Layer>
  )
}
