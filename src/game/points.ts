// Every points figure in the game, one way: with a thousands comma, as the
// artboards print it — 4,000, and a gain as +1,400.
const POINTS = new Intl.NumberFormat('en-US')

export function formatPoints(points: number): string {
  return POINTS.format(points)
}

// a gain (or, should one ever come, a loss) with its sign
export function signedPoints(points: number): string {
  return points < 0 ? `−${POINTS.format(-points)}` : `+${POINTS.format(points)}`
}
