import { describe, it, expect } from 'vitest'
import { rankLabel, rankName, rankWithTies } from './ranking'

const byScore = (scores: Record<string, number>) =>
  rankWithTies(Object.entries(scores), ([, s]) => s).map((r) => [r.item[0], rankLabel(r)])

describe('ranking with ties', () => {
  it('ranks highest first, 1 to n, when nobody ties', () => {
    expect(byScore({ teo: 2000, mara: 4500, ilya: 3000 })).toEqual([
      ['mara', '1'],
      ['ilya', '2'],
      ['teo', '3'],
    ])
  })

  it('shares a place between equal scores and skips the places they take', () => {
    expect(byScore({ mara: 4500, ilya: 3000, bob: 3000, teo: 2000 })).toEqual([
      ['mara', '1'],
      ['ilya', '=2'],
      ['bob', '=2'],
      ['teo', '4'],
    ])
  })

  it('handles a tie at the top, at the bottom, and everyone level', () => {
    expect(byScore({ a: 10, b: 10, c: 5 })).toEqual([
      ['a', '=1'],
      ['b', '=1'],
      ['c', '3'],
    ])
    expect(byScore({ a: 10, b: 5, c: 5 })).toEqual([
      ['a', '1'],
      ['b', '=2'],
      ['c', '=2'],
    ])
    expect(byScore({ a: 0, b: 0, c: 0 }).map(([, r]) => r)).toEqual(['=1', '=1', '=1'])
  })

  it('keeps equal scores in the order they came', () => {
    expect(byScore({ z: 1, a: 1 }).map(([id]) => id)).toEqual(['z', 'a'])
  })

  it('is empty for nobody', () => {
    expect(rankWithTies([], () => 0)).toEqual([])
  })
})

describe('ranks read aloud', () => {
  it('says joint places in words', () => {
    expect(rankName({ rank: 1, tied: false })).toBe('First')
    expect(rankName({ rank: 2, tied: true })).toBe('Joint second')
    expect(rankName({ rank: 4, tied: false })).toBe('Fourth')
    expect(rankName({ rank: 8, tied: true })).toBe('Joint eighth')
    expect(rankName({ rank: 11, tied: false })).toBe('11th')
    expect(rankName({ rank: 22, tied: true })).toBe('Joint 22nd')
  })
})
