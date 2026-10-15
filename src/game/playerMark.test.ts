import { describe, it, expect } from 'vitest'
import { initialOf, markFor, seatOf, SHAPES } from './playerMark'

const players = [
  { id: 'sam', presence: 'present' },
  { id: 'alice', presence: 'left' },
  { id: 'bob', presence: 'away' },
  { id: 'cara', presence: 'present' },
]

describe('seats', () => {
  it('is the position in the player list, whatever the presence', () => {
    expect(seatOf(players, 'sam')).toBe(0)
    expect(seatOf(players, 'alice')).toBe(1)
    // Alice left, and still holds seat 1: nobody after her shifts
    expect(seatOf(players, 'bob')).toBe(2)
    expect(seatOf(players, 'cara')).toBe(3)
  })

  it('is -1 for someone not in the room', () => {
    expect(seatOf(players, 'zed')).toBe(-1)
    expect(seatOf([], 'sam')).toBe(-1)
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

  it('draws an absent player as seat 0 rather than failing', () => {
    expect(markFor(-1)).toEqual(markFor(0))
    expect(markFor(seatOf(players, 'zed'))).toEqual({ shape: 'square', colour: 0 })
  })

  it('has eight different shapes', () => {
    expect(SHAPES).toHaveLength(8)
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
