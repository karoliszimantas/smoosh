// Where the eraser works, against where the finger is. A fingertip covers
// what it touches, so on touch the brush works above it, clear of the
// finger, and the brush circle shows where. A mouse or a stylus covers
// nothing: no offset.

// from the touch point to the brush's lower edge, in screen px: about the
// part of a fingertip pad that lies above where the screen reads the touch
export const FINGER_CLEARANCE_PX = 36

// Within twice the offset of the stage's top, the offset eases off to
// nothing at the very top, so the topmost part of a layer can still be
// reached with a finger that stays on the screen. Twice, not less: the brush
// then keeps moving the way the finger does (at half its speed there) — it
// never stalls or doubles back, and there's no jump as the finger crosses in.
const TOP_BAND_FACTOR = 2

// how far above the pointer (screen px) the eraser works. `y` is the
// pointer's distance from the stage's top; `brushPx` the brush diameter
export function eraseOffset(pointerType: string, y: number, brushPx: number): number {
  if (pointerType !== 'touch') return 0
  const full = FINGER_CLEARANCE_PX + brushPx / 2
  return full * Math.min(1, Math.max(0, y / (full * TOP_BAND_FACTOR)))
}
