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

// a name's characters as a reader sees them (an accented letter or a whole
// emoji is one, not half of one), spaces left out
function graphemes(name: string): string[] {
  const text = name.replace(/\s+/g, '')
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment)
  }
  return [...text]
}

// the letter on the avatar: the name's first character, in capitals
export function initialOf(name: string): string {
  return (graphemes(name.trim())[0] ?? '?').toUpperCase()
}

// The letters on each player's dot, told apart: one initial where it's
// theirs alone; where two or more share it, two letters — the first and
// the second ("Ma", "Mx"), or, if those still match, the first and the
// last. Who left isn't counted (their dot is gone).
export function initialsFor(players: readonly { id: string; name: string }[]): Map<string, string> {
  const byInitial = new Map<string, { id: string; letters: string[] }[]>()
  for (const p of players) {
    const letters = graphemes(p.name.trim())
    const first = (letters[0] ?? '?').toUpperCase()
    byInitial.set(first, [...(byInitial.get(first) ?? []), { id: p.id, letters }])
  }
  const out = new Map<string, string>()
  for (const [first, group] of byInitial) {
    if (group.length < 2) {
      for (const g of group) out.set(g.id, first)
      continue
    }
    const two = (g: { letters: string[] }, at: number) => first + (g.letters[at] ?? '').toLowerCase()
    const seconds = group.map((g) => two(g, 1))
    for (const [i, g] of group.entries()) {
      const second = seconds[i] ?? first
      const shared = seconds.filter((s) => s === second).length > 1
      out.set(g.id, shared && g.letters.length > 2 ? two(g, g.letters.length - 1) : second)
    }
  }
  // in the players' own order
  return new Map(players.map((p) => [p.id, out.get(p.id) ?? '?']))
}
