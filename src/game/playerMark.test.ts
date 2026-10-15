import { describe, it, expect } from 'vitest'
import { MARK_COUNT } from '@smoosh/protocol'
import { initialOf, markFor, markOf, SHAPES } from './playerMark'

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
