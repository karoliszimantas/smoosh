import { describe, it, expect } from 'vitest'
import {
  GUESS_POINTS,
  addToBreakdown,
  breakdownTotal,
  EMPTY_BREAKDOWN,
  guessPointsFor,
  scorePicture,
  type ScoreDelta,
} from '@smoosh/protocol'

// A whole round at table size n: players p0..p(n-1), each builds one
// picture. `guess(picture author, guesser)` says what the guesser picks:
// 'truth', or the id of the player whose lie they fall for.
function playRound(n: number, guess: (author: number, guesser: number) => 'truth' | number | null) {
  const totals = new Map<string, number>()
  const all: ScoreDelta[] = []
  for (let a = 0; a < n; a++) {
    const lies = Array.from({ length: n }, (_, w) => w)
      .filter((w) => w !== a)
      .map((w) => ({ optionId: `lie-${a}-${w}`, authorId: `p${w}` }))
    const guesses = Array.from({ length: n }, (_, g) => g)
      .filter((g) => g !== a)
      .flatMap((g) => {
        const pick = guess(a, g)
        if (pick === null) return []
        return [{ playerId: `p${g}`, optionId: pick === 'truth' ? 'truth' : `lie-${a}-${pick}` }]
      })
    const deltas = scorePicture({ players: n, authorId: `p${a}`, truthOptionId: 'truth', lies, guesses })
    all.push(...deltas)
    for (const d of deltas) totals.set(d.playerId, (totals.get(d.playerId) ?? 0) + d.points)
  }
  return { totals, all, score: (i: number) => totals.get(`p${i}`) ?? 0 }
}

const SIZES = [3, 4, 5, 6, 7, 8]

describe('the points table', () => {
  it('every value is a whole number', () => {
    for (const row of Object.values(GUESS_POINTS)) {
      for (const v of Object.values(row)) expect(Number.isInteger(v)).toBe(true)
    }
  })

  it.each(SIZES)('%i players: a perfect author round is 4200', (n) => {
    // everyone guesses p0's picture right; everything else goes nowhere
    const { all } = playRound(n, (a) => (a === 0 ? 'truth' : null))
    const fromPicture = all.filter((d) => d.playerId === 'p0' && d.reason === 'picture_guessed')
    expect(fromPicture.reduce((s, d) => s + d.points, 0)).toBe(4200)
  })

  it.each(SIZES)('%i players: a perfect guessing round is 4200', (n) => {
    const { all } = playRound(n, (_a, g) => (g === 0 ? 'truth' : null))
    const fromGuessing = all.filter((d) => d.playerId === 'p0' && d.reason === 'guessed_truth')
    expect(fromGuessing.reduce((s, d) => s + d.points, 0)).toBe(4200)
  })

  it.each(SIZES)('%i players: every lie landing is 2100', (n) => {
    // on every picture but p0's own, every guesser who can falls for p0's lie
    const { all } = playRound(n, (a, g) => (g === 0 ? null : a === 0 ? null : 0))
    const fromLies = all.filter((d) => d.playerId === 'p0' && d.reason === 'lie_picked')
    expect(fromLies.reduce((s, d) => s + d.points, 0)).toBe(2100)
  })

  it('a table outside 3–8 plays on the nearest row', () => {
    expect(guessPointsFor(2)).toEqual(GUESS_POINTS[3])
    expect(guessPointsFor(9)).toEqual(GUESS_POINTS[8])
  })
})

describe('a picture nobody got', () => {
  it('earns its author nothing', () => {
    // 5 players: everyone falls for p1's lie on p0's picture
    const deltas = scorePicture({
      players: 5,
      authorId: 'p0',
      truthOptionId: 'truth',
      lies: [{ optionId: 'l1', authorId: 'p1' }],
      guesses: ['p2', 'p3', 'p4'].map((playerId) => ({ playerId, optionId: 'l1' })),
    })
    expect(deltas.filter((d) => d.playerId === 'p0')).toEqual([])
    expect(deltas.filter((d) => d.playerId === 'p1')).toHaveLength(3)
  })

  it('a guesser who gets nothing right scores nothing', () => {
    const { score } = playRound(4, (_a, g) => (g === 3 ? null : 'truth'))
    // p3 guessed nothing; everyone else guessed p3's picture
    expect(score(3)).toBe(4200) // only from their picture
  })
})

describe('what stays the same', () => {
  it('a correct guess pays guesser and author the same', () => {
    for (const players of SIZES) {
      const deltas = scorePicture({ players, authorId: 'a', truthOptionId: 't', lies: [], guesses: [{ playerId: 'g', optionId: 't' }] })
      const [g, a] = [deltas.find((d) => d.playerId === 'g'), deltas.find((d) => d.playerId === 'a')]
      expect(g?.points).toBe(a?.points)
    }
  })

  it('nobody scores from their own picture or their own lie', () => {
    const deltas = scorePicture({
      players: 4,
      authorId: 'a',
      truthOptionId: 't',
      lies: [{ optionId: 'la', authorId: 'b' }],
      guesses: [
        { playerId: 'a', optionId: 't' }, // the author "guessing" their own
        { playerId: 'b', optionId: 'la' }, // picking your own lie
      ],
    })
    // neither counts
    expect(deltas).toEqual([])
  })

  it('a timeout costs nothing', () => {
    const deltas = scorePicture({ players: 4, authorId: 'a', truthOptionId: 't', lies: [], guesses: [{ playerId: 'g', optionId: 't' }] })
    expect(deltas.every((d) => d.points > 0)).toBe(true)
    expect(deltas.some((d) => d.playerId === 'timed-out')).toBe(false)
  })

  it('an easy picture is never penalised: everyone right is full marks', () => {
    const { score } = playRound(6, () => 'truth')
    for (let i = 0; i < 6; i++) expect(score(i)).toBe(4200 + 4200)
  })
})

describe('the breakdown', () => {
  it('sums to the total, by source', () => {
    const { all, totals } = playRound(5, (a, g) => (a === 1 ? (g === 0 ? 2 : 0) : (a + g) % 2 === 0 ? 'truth' : null))
    for (const [playerId, total] of totals) {
      const b = all.filter((d) => d.playerId === playerId).reduce(addToBreakdown, EMPTY_BREAKDOWN)
      expect(breakdownTotal(b)).toBe(total)
    }
  })
})
