import { describe, it, expect } from 'vitest'
import { lieCountNote, oneLine, showLieCount } from './lieText'

describe('a lie is one line', () => {
  it('turns a typed or pasted newline into a space', () => {
    expect(oneLine('Sloth on\nlifeguard  \r\n  probation')).toBe('Sloth on lifeguard probation')
    expect(oneLine('no breaks here')).toBe('no breaks here')
  })
})

describe('the counter', () => {
  it('shows from 60 characters', () => {
    expect(showLieCount(59)).toBe(false)
    expect(showLieCount(60)).toBe(true)
  })

  it('speaks in steps, not on every keystroke', () => {
    expect(lieCountNote(10)).toBe('')
    expect(lieCountNote(59)).toBe('')
    // the same words from 60 to 69, so a screen reader hears them once
    expect(lieCountNote(60)).toBe('20 or fewer characters left')
    expect(lieCountNote(69)).toBe('20 or fewer characters left')
    expect(lieCountNote(70)).toBe('10 or fewer characters left')
    expect(lieCountNote(79)).toBe('10 or fewer characters left')
    expect(lieCountNote(80)).toBe('No characters left')
  })
})
