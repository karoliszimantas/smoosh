import { useEffect, useMemo, useRef } from 'react'
import { Layer, Shape } from 'react-konva'
import Konva from 'konva'
import { NOT_IN_EXPORT } from './canvasExport'

// one sweep of the shimmer across a layer, then the next
const SWEEP_MS = 1400
// the band's half-width, as a share of the layer's diagonal
const BAND = 0.18
const VEIL = 'rgba(255,255,255,.16)'
const GLINT = 'rgba(255,255,255,.55)'
// the chip, in screen px whatever the stage's scale
const CHIP_FONT_PX = 11
const CHIP_PAD_X = 8
const CHIP_HEIGHT = 22
const CHIP_LINE = 1.5
const CHIP_DROP = { x: 2, y: 3, color: 'rgba(0,0,0,.55)' }

// Over a layer whose cut-out is still being made: a light sweeping across
// it and a small chip saying where the cut has got to. A layer of its own
// above the layers, redrawn every frame by a Konva animation while any cut
// is running — so it follows a drag or a pinch without React, and costs
// nothing once none is. The status is read as it's drawn (`status`), never
// rendered. It takes no taps, and the export leaves it out. With reduced
// motion the light stands still. The same chip, without the light, also
// carries a few words about a cut that didn't happen (`notes`).
export default function CutOverlay({
  cutting,
  notes = [],
  stageScale,
  status,
  paper,
  ink,
  font,
}: {
  // the layers waiting on a cut, and the cut each waits on
  cutting: readonly { id: string; token: string }[]
  // words on a layer for a moment, chip only
  notes?: readonly { id: string; label: string }[]
  stageScale: number
  status: (token: string) => string
  paper: string
  ink: string
  font: string
}) {
  const layerRef = useRef<Konva.Layer>(null)
  const active = cutting.length > 0 || notes.length > 0
  const still = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])

  useEffect(() => {
    const layer = layerRef.current
    if (!active || !layer) return
    const animation = new Konva.Animation(() => {}, layer)
    animation.start()
    return () => {
      animation.stop()
    }
  }, [active])

  if (!active) return null
  return (
    <Layer ref={layerRef} listening={false} name={NOT_IN_EXPORT}>
      <Shape
        listening={false}
        perfectDrawEnabled={false}
        sceneFunc={(ctx, shape) => {
          for (const { id, token } of cutting) drawCutting(ctx, shape, id, status(token), stageScale, still, { paper, ink, font })
          for (const { id, label } of notes) drawNote(ctx, shape, id, label, stageScale, { paper, ink, font })
        }}
      />
    </Layer>
  )
}

function drawCutting(
  ctx: Konva.Context,
  shape: Konva.Shape,
  id: string,
  label: string,
  stageScale: number,
  still: boolean,
  look: { paper: string; ink: string; font: string },
) {
  const node = shape.getStage()?.findOne<Konva.Image>(`#${id}`)
  // gone, or crop/erase has it (its node steps aside)
  if (!node || !node.isVisible()) return
  const w = node.width()
  const h = node.height()
  // both layers sit untransformed on the stage, so the node's own transform
  // takes its box into this one's coordinates
  const transform = node.getTransform()
  const [m0 = 1, m1 = 0, m2 = 0, m3 = 1, m4 = 0, m5 = 0] = transform.getMatrix()
  const c = ctx._context

  c.save()
  c.transform(m0, m1, m2, m3, m4, m5)
  c.beginPath()
  c.rect(0, 0, w, h)
  c.clip()
  c.fillStyle = VEIL
  c.fillRect(0, 0, w, h)
  if (!still) {
    // a band of light down the diagonal, from corner to corner
    const diagonal = Math.hypot(w, h)
    const dx = w / diagonal
    const dy = h / diagonal
    const band = diagonal * BAND
    const t = (performance.now() % SWEEP_MS) / SWEEP_MS
    const at = -band + t * (diagonal + 2 * band)
    const glint = c.createLinearGradient(dx * (at - band), dy * (at - band), dx * (at + band), dy * (at + band))
    glint.addColorStop(0, 'rgba(255,255,255,0)')
    glint.addColorStop(0.5, GLINT)
    glint.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = glint
    c.fillRect(0, 0, w, h)
  }
  c.restore()

  drawChip(c, transform.point({ x: w / 2, y: h / 2 }), label, stageScale, look)
}

// just the chip, on a layer that's still there and showing
function drawNote(
  ctx: Konva.Context,
  shape: Konva.Shape,
  id: string,
  label: string,
  stageScale: number,
  look: { paper: string; ink: string; font: string },
) {
  const node = shape.getStage()?.findOne<Konva.Image>(`#${id}`)
  if (!node || !node.isVisible()) return
  const centre = node.getTransform().point({ x: node.width() / 2, y: node.height() / 2 })
  drawChip(ctx._context, centre, label, stageScale, look)
}

// the chip, level and screen-sized, centred on `centre`
function drawChip(
  c: CanvasRenderingContext2D,
  centre: { x: number; y: number },
  label: string,
  stageScale: number,
  look: { paper: string; ink: string; font: string },
) {
  const px = 1 / Math.max(stageScale, 1e-6)
  c.save()
  c.font = `700 ${CHIP_FONT_PX * px}px ${look.font}`
  const width = c.measureText(label).width + 2 * CHIP_PAD_X * px
  const height = CHIP_HEIGHT * px
  const x = centre.x - width / 2
  const y = centre.y - height / 2
  c.fillStyle = CHIP_DROP.color
  c.fillRect(x + CHIP_DROP.x * px, y + CHIP_DROP.y * px, width, height)
  c.fillStyle = look.paper
  c.fillRect(x, y, width, height)
  c.lineWidth = CHIP_LINE * px
  c.strokeStyle = look.ink
  c.strokeRect(x, y, width, height)
  c.fillStyle = look.ink
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(label, centre.x, centre.y + 0.5 * px)
  c.restore()
}
