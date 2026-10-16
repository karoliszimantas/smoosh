import { describe, it, expect, beforeEach } from 'vitest'
import { howToPlaySeen, markHowToPlaySeen, resetHowToPlayVisit } from './howToPlaySeen'

function memoryStore() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

const throwing = {
  getItem: (): string | null => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

describe('how to play, seen once', () => {
  beforeEach(resetHowToPlayVisit)

  it('is unseen on a first visit, and seen once shown', () => {
    const store = memoryStore()
    expect(howToPlaySeen(store)).toBe(false)
    markHowToPlaySeen(store)
    expect(store.data.get('smoosh_how_to_play_seen')).toBe('1')
    resetHowToPlayVisit()
    // a later visit, same device
    expect(howToPlaySeen(store)).toBe(true)
  })

  it('shows again when storage refuses, but not twice in one visit', () => {
    expect(howToPlaySeen(throwing)).toBe(false)
    expect(() => markHowToPlaySeen(throwing)).not.toThrow()
    expect(howToPlaySeen(throwing)).toBe(true)
    resetHowToPlayVisit()
    expect(howToPlaySeen(throwing)).toBe(false)
  })

  it('copes with no storage at all', () => {
    expect(howToPlaySeen(null)).toBe(false)
    expect(() => markHowToPlaySeen(null)).not.toThrow()
    // and in this test run there's no localStorage global either
    resetHowToPlayVisit()
    expect(howToPlaySeen()).toBe(false)
    expect(() => markHowToPlaySeen()).not.toThrow()
  })
})
