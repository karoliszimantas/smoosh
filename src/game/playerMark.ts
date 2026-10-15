// How a player is told apart at a glance: a seat colour and a shape on a
// small white badge, together — so a colour-blind player can still tell the
// seats apart. Both come from the seat number the server hands out when a
// player first joins (player.seat): it's never reused in a room, so nobody's
// colour or shape shifts when someone before them leaves, lobby or not.

// in seat order: 0 is the host's seat in a fresh room. The first four match
// the first four of the theme's player colours (green, blue, yellow, pink)
export const SHAPES = ['square', 'circle', 'triangle', 'star', 'diamond', 'pentagon', 'cross', 'sparkle'] as const
export type Shape = (typeof SHAPES)[number]

// the shape and the theme's players[] index for a seat number. Wraps at
// MARK_COUNT; the server never seats two people wearing the same mark at
// once. A bad seat number is drawn as seat 0 rather than failing
export function markFor(seat: number): { shape: Shape; colour: number } {
  const i = seat > 0 ? Math.floor(seat) % SHAPES.length : 0
  return { shape: SHAPES[i] ?? 'square', colour: i }
}

// a player's mark, from their seat number
export function markOf(player: { seat: number }): { shape: Shape; colour: number } {
  return markFor(player.seat)
}

// the letter on the avatar: the name's first character as a reader sees it
// (an accented letter or a whole emoji, not half of one), in capitals
export function initialOf(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') return '?'
  let first: string | undefined
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    first = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)[Symbol.iterator]().next().value
      ?.segment
  } else {
    first = String.fromCodePoint(trimmed.codePointAt(0) ?? 63)
  }
  return (first ?? '?').toUpperCase()
}
