import { Shape } from 'react-konva'
import type Konva from 'konva'
import { CANVAS_SIZE } from './layerItem'
import { CANVAS_UNITS_PER_THEME_PX } from './paper'
import type { Theme } from '../themes'

// The meander (Greek key) as one line, in grid units: the key sits in a
// band 6 units deep, between two thin rules. One period, 4 units long, from
// the bottom up the stem, across, down, back, and on along the bottom into
// the next period:
//
//    ┌──────┐
//    │  ┌─┐ │
//    │  │ └─┘   ← (y grows inward, away from the frame's outer edge)
//    │  │
//   ─┘  └─────
const KEY: readonly (readonly [number, number])[] = [
  [0, 5],
  [0, 1],
  [3, 1],
  [3, 3],
  [1, 3],
  [1, 5],
  [4, 5],
]
const BAND_UNITS = 6
const PERIOD_UNITS = 4

// one edge, drawn along +x with the band on +y (outer edge at y = 0). The
// key runs between the corners; each edge draws the corner at its start, a
// small square, so all four corners are drawn exactly once
function traceEdge(ctx: Konva.Context, length: number, band: number): void {
  const g = band / BAND_UNITS
  // the rules run the full edge
  for (const y of [0.2, BAND_UNITS - 0.2]) {
    ctx.moveTo(0, y * g)
    ctx.lineTo(length, y * g)
  }
  // corner motif
  ctx.rect(band / 2 - g, band / 2 - g, g * 2, g * 2)

  const run = length - band * 2
  const periods = Math.max(1, Math.round(run / (PERIOD_UNITS * g)))
  // stretch the period a touch so a whole number of keys fills the edge
  const step = run / periods
  const sx = step / PERIOD_UNITS
  for (let p = 0; p < periods; p++) {
    const x0 = band + p * step
    KEY.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x0 + x * sx, y * g)
      else ctx.lineTo(x0 + x * sx, y * g)
    })
  }
}

// a decorative band round the inside of the frame, under the layers: part of
// the picture (so it's exported) but it never covers a layer, and the stage,
// the frame and every coordinate stay exactly as they are
export default function CanvasFrame({ frame }: { frame: Theme['canvasFrame'] }) {
  if (!frame || frame.pattern === 'none' || frame.width <= 0) return null
  const band = frame.width * CANVAS_UNITS_PER_THEME_PX
  const L = CANVAS_SIZE

  return (
    <Shape
      listening={false}
      stroke={frame.color}
      strokeWidth={(band / BAND_UNITS) * 0.55}
      lineCap="square"
      lineJoin="miter"
      sceneFunc={(ctx, shape) => {
        ctx.beginPath()
        // top, right, bottom, left — each rotated so the band faces inward
        const edges: readonly [number, number, number][] = [
          [0, 0, 0],
          [L, 0, 90],
          [L, L, 180],
          [0, L, 270],
        ]
        for (const [x, y, deg] of edges) {
          ctx.save()
          ctx.translate(x, y)
          ctx.rotate((deg * Math.PI) / 180)
          traceEdge(ctx, L, band)
          ctx.restore()
        }
        ctx.strokeShape(shape)
      }}
    />
  )
}
