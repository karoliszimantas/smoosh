// A strip of yellow tape holding a paper card (or the canvas) to the desk:
// pure decoration, so it's hidden from screen readers and never takes a tap.
// Placed by its top-left corner relative to the card it holds (a positioned
// parent); the default hangs it off the card's top-left corner, as drawn.
export default function Tape({ x = -12, y = -10, className }: { x?: number; y?: number; className?: string }) {
  return <span className={className ? `tape ${className}` : 'tape'} style={{ left: x, top: y }} aria-hidden="true" />
}
