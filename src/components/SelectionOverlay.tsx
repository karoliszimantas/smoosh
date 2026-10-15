import { Shape } from 'react-konva'
import type Konva from 'konva'
import { NOT_IN_EXPORT } from './canvasExport'

// screen pixels, whatever the stage's scale or the layer's
const OUTLINE_GAP = 6
const OUTLINE_WIDTH = 2
const OUTLINE_DASH = [6, 4]
const HANDLE_SIZE = 14
const HANDLE_STROKE = 2.5
const HANDLE_FILL = '#FFFFFF'

// The selected layer's marks, as Build.dc.html draws them: a dashed outline
// a little outside its box, turned with it, and a square white handle on
// each corner, kept level. Drawn last in the layers' own Konva layer, from
// the selected node as it is at that moment, so they follow a drag, a pinch
// or a slider frame by frame without React. They take no taps (Canvas's
// gestures and hit tests are untouched) and are never exported.
export default function SelectionOverlay({
  targetId,
  stageScale,
  color,
  handles,
}: {
  targetId: string
  stageScale: number
  color: string
  // a locked layer can't be moved: the outline only
  handles: boolean
}) {
  return (
    <Shape
      name={`selection-overlay ${NOT_IN_EXPORT}`}
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx, shape) => drawSelection(ctx, shape, targetId, stageScale, color, handles)}
    />
  )
}

function drawSelection(
  ctx: Konva.Context,
  shape: Konva.Shape,
  targetId: string,
  stageScale: number,
  color: string,
  handles: boolean,
) {
  const node = shape.getLayer()?.findOne<Konva.Image>(`#${targetId}`)
  // nothing to mark, or crop/erase has the layer (its node steps aside)
  if (!node || !node.isVisible()) return

  // this shape sits untransformed in the same Konva layer as the node, so
  // the node's own transform takes its corners into these coordinates; one
  // screen pixel is 1/stageScale of them
  const px = 1 / Math.max(stageScale, 1e-6)
  const gapX = (OUTLINE_GAP * px) / Math.max(Math.abs(node.scaleX()), 1e-6)
  const gapY = (OUTLINE_GAP * px) / Math.max(Math.abs(node.scaleY()), 1e-6)
  const w = node.width()
  const h = node.height()
  const transform = node.getTransform()
  const corners = [
    { x: -gapX, y: -gapY },
    { x: w + gapX, y: -gapY },
    { x: w + gapX, y: h + gapY },
    { x: -gapX, y: h + gapY },
  ].map((p) => transform.point(p))

  const c = ctx._context
  c.save()
  c.beginPath()
  corners.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)))
  c.closePath()
  c.setLineDash(OUTLINE_DASH.map((d) => d * px))
  c.lineWidth = OUTLINE_WIDTH * px
  c.strokeStyle = color
  c.stroke()

  if (handles) {
    // the stroke is centred on the square's edge: the outer size is HANDLE_SIZE
    const side = (HANDLE_SIZE - HANDLE_STROKE) * px
    c.setLineDash([])
    c.lineWidth = HANDLE_STROKE * px
    c.fillStyle = HANDLE_FILL
    for (const p of corners) {
      c.beginPath()
      c.rect(p.x - side / 2, p.y - side / 2, side, side)
      c.fill()
      c.stroke()
    }
  }
  c.restore()
}
