// How a player is told apart at a glance: a seat colour and a shape on a
// small white badge, together — so a colour-blind player can still tell the
// seats apart. Both come from the seat, which is the player's position in
// snapshot.players. Players who leave stay in that list, so nobody's seat
// (or colour, or shape) shifts when someone goes.

// in seat order: 0 is the host's seat in a fresh room. The first four match
// the first four of the theme's player colours (green, blue, yellow, pink)
export const SHAPES = ['square', 'circle', 'triangle', 'star', 'diamond', 'pentagon', 'cross', 'sparkle'] as const
export type Shape = (typeof SHAPES)[number]

// a player's seat: their index in snapshot.players, -1 if they're not in it
export function seatOf(players: readonly { id: string }[], playerId: string): number {
  return players.findIndex((p) => p.id === playerId)
}

// the shape and the theme's players[] index for a seat. Wraps at 8; an
// absent player (-1) is drawn as seat 0 rather than failing
export function markFor(seat: number): { shape: Shape; colour: number } {
  const i = seat > 0 ? Math.floor(seat) % SHAPES.length : 0
  return { shape: SHAPES[i] ?? 'square', colour: i }
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
