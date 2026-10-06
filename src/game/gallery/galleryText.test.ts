import { describe, it, expect } from 'vitest'
import { countLine, titleFor } from './galleryText'

describe('placard text', () => {
  it('freestyle hangs as Untitled', () => {
    expect(titleFor('')).toBe('Untitled')
    expect(titleFor('   ')).toBe('Untitled')
  })

  it('a lower-case prompt is set as a title; one with capitals is left alone', () => {
    expect(titleFor('two ducks on a date')).toBe('Two Ducks on a Date')
    expect(titleFor('Cat Wearing Sunglasses')).toBe('Cat Wearing Sunglasses')
    expect(titleFor('NASA at the beach')).toBe('NASA at the beach')
  })

  it('vote counts only — and nothing at all for no votes', () => {
    expect(countLine(2, 1)).toBe('2 favourites · 1 runner-up')
    expect(countLine(0, 3)).toBe('3 runner-ups')
    expect(countLine(0, 0)).toBeNull()
  })
})
