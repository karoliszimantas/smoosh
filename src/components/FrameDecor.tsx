import { Layer, Rect } from 'react-konva'
import { CANVAS_SIZE } from './layerItem'
import { NOT_IN_EXPORT } from './canvasExport'
import { parseHardShadow } from './hardShadow'

// how much of the page colour covers whatever hangs outside the frame
const OUTSIDE_DIM_OPACITY = 0.62
// far enough past the frame to cover any visible part of the stage
const OUTSIDE = 20000

// Over the layers, round the frame: the page colour dims whatever hangs
// outside it, so it reads as "not in the picture", and the paper casts the
// cards' hard shadow, drawn as two strips (right and bottom) a few screen
// pixels wide. None of it is ever exported, and it never takes a tap.
export default function FrameDecor({ scale, pageBg, shadow }: { scale: number; pageBg: string; shadow: string }) {
  const { x, y, color } = parseHardShadow(shadow)
  // screen pixels in canvas units
  const px = 1 / Math.max(scale, 1e-6)
  return (
    <Layer listening={false} name={NOT_IN_EXPORT}>
      <Rect x={-OUTSIDE} y={-OUTSIDE} width={2 * OUTSIDE + CANVAS_SIZE} height={OUTSIDE} fill={pageBg} opacity={OUTSIDE_DIM_OPACITY} />
      <Rect x={-OUTSIDE} y={CANVAS_SIZE} width={2 * OUTSIDE + CANVAS_SIZE} height={OUTSIDE} fill={pageBg} opacity={OUTSIDE_DIM_OPACITY} />
      <Rect x={-OUTSIDE} y={0} width={OUTSIDE} height={CANVAS_SIZE} fill={pageBg} opacity={OUTSIDE_DIM_OPACITY} />
      <Rect x={CANVAS_SIZE} y={0} width={OUTSIDE} height={CANVAS_SIZE} fill={pageBg} opacity={OUTSIDE_DIM_OPACITY} />
      <Rect name="frame-shadow" x={CANVAS_SIZE} y={y * px} width={x * px} height={CANVAS_SIZE} fill={color} />
      <Rect name="frame-shadow" x={x * px} y={CANVAS_SIZE} width={CANVAS_SIZE - x * px} height={y * px} fill={color} />
    </Layer>
  )
}
