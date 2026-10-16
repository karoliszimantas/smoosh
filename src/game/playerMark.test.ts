import { describe, it, expect } from 'vitest'
import { MARK_COUNT } from '@smoosh/protocol'
import { initialOf, initialsFor, markFor, markOf, SHAPES } from './playerMark'

describe('seats', () => {
  it('is the seat number the server handed out, not the place in the list', () => {
    // Bob joined third; whoever sat between went, and he keeps his mark
    expect(markOf({ seat: 2 })).toEqual({ shape: 'triangle', colour: 2 })
    expect(markOf({ seat: 0 })).toEqual(markFor(0))
  })
})

describe('marks', () => {
  it('starts green square, blue circle, yellow triangle, pink star', () => {
    expect([0, 1, 2, 3].map((s) => markFor(s))).toEqual([
      { shape: 'square', colour: 0 },
      { shape: 'circle', colour: 1 },
      { shape: 'triangle', colour: 2 },
      { shape: 'star', colour: 3 },
    ])
  })

  it('wraps at eight', () => {
    expect(markFor(8)).toEqual(markFor(0))
    expect(markFor(13)).toEqual(markFor(5))
    expect(markFor(7)).toEqual({ shape: 'sparkle', colour: 7 })
  })

  it('draws a bad seat number as seat 0 rather than failing', () => {
    expect(markFor(-1)).toEqual(markFor(0))
    expect(markFor(Number.NaN)).toEqual({ shape: 'square', colour: 0 })
  })

  it('has eight different shapes', () => {
    expect(SHAPES).toHaveLength(MARK_COUNT)
    expect(new Set(SHAPES).size).toBe(8)
  })
})

describe('initials', () => {
  it('is the first letter, in capitals', () => {
    expect(initialOf('mara')).toBe('M')
    expect(initialOf('Teo')).toBe('T')
  })

  it('keeps an accented letter whole', () => {
    expect(initialOf('élan')).toBe('É')
    // e + combining acute: two code points, one letter
    expect(initialOf('élan')).toBe('É')
  })

  it('takes a whole emoji, not half of one', () => {
    expect(initialOf('👩‍🎨Ana')).toBe('👩‍🎨')
    expect(initialOf('🦊')).toBe('🦊')
  })

  it('is ? for an empty name', () => {
    expect(initialOf('')).toBe('?')
    expect(initialOf('   ')).toBe('?')
  })
})

describe('initials on the dots', () => {
  const ids = (names: string[]) => names.map((name, i) => ({ id: `p${i}`, name }))
  const letters = (names: string[]) => [...initialsFor(ids(names)).values()]

  it('one letter where it is theirs alone', () => {
    expect(letters(['Mara', 'Teo', 'Bob'])).toEqual(['M', 'T', 'B'])
  })

  it('two letters where initials match: the first and the second', () => {
    expect(letters(['Mara', 'Teo', 'Mx', 'Bob'])).toEqual(['Ma', 'T', 'Mx', 'B'])
    expect(letters(['mara', 'Milo'])).toEqual(['Ma', 'Mi'])
  })

  it('the first and the last where the second matches too', () => {
    expect(letters(['Mara', 'Max'])).toEqual(['Ma', 'Mx'])
    expect(letters(['Teo', 'Tea', 'Tom'])).toEqual(['To', 'Ta', 'To'])
  })

  it('counts a whole emoji or accented letter as one, and skips spaces', () => {
    expect(letters(['🦊 fox', '🦊 kit'])).toEqual(['🦊f', '🦊k'])
    expect(letters(['Élan', 'Émile'])).toEqual(['Él', 'Ém'])
  })

  it('eight players still get a short mark each', () => {
    const all = letters(['Mara', 'Max', 'Milo', 'Teo', 'Tom', 'Bob', 'Bea', 'Ilya'])
    expect(all).toEqual(['Ma', 'Mx', 'Mi', 'Te', 'To', 'Bo', 'Be', 'I'])
    expect(all.every((l) => [...l].length <= 2)).toBe(true)
  })
})
