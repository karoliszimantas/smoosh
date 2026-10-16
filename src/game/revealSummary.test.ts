import { describe, it, expect } from 'vitest'
import type { RevealOption, RoomSnapshot } from '@smoosh/protocol'
import { nameList, revealSummary } from './revealSummary'
import { formatPoints, signedPoints } from './points'
import { fixtureSnapshot, YOU_ID } from '../dev/fixtures'

// Sam (you), Alice, Bob, Cara: four at the table, so a right guess is worth
// 1400 and a lie 350 a head. Alice drew the picture unless said otherwise.
function reveal(
  options: RevealOption[],
  points: Record<string, number>,
  authorId = 'alice',
): RoomSnapshot {
  const snap = fixtureSnapshot('reveal', undefined, { authorId })
  if (snap.phase.phase !== 'reveal') throw new Error('fixture')
  return {
    ...snap,
    phase: {
      ...snap.phase,
      authorId,
      options,
      pointsThisPicture: Object.entries(points).map(([playerId, p]) => ({ playerId, points: p })),
    },
  }
}

const truth = (pickedBy: string[]): RevealOption => ({ id: 't', text: 'real', isTruth: true, authorId: null, pickedBy })
const lie = (id: string, authorId: string, pickedBy: string[]): RevealOption => ({
  id,
  text: `lie by ${authorId}`,
  isTruth: false,
  authorId,
  pickedBy,
})

describe('the reveal, summed up', () => {
  it('prices the truth and the lies at the table size', () => {
    const s = revealSummary(reveal([lie('b', 'bob', ['cara']), truth([YOU_ID])], { [YOU_ID]: 1400, alice: 1400, bob: 350 }))
    expect(s?.foundEach).toBe(1400)
    expect(s?.lies.map((l) => [l.authorId, l.pointsEach, l.fooled])).toEqual([['bob', 350, ['cara']]])
  })

  it('puts the lie that fooled most first and calls it the best fib', () => {
    const s = revealSummary(
      reveal([lie('y', YOU_ID, []), lie('c', 'cara', ['bob']), truth([]), lie('b', 'bob', [YOU_ID, 'cara'])], {}),
    )
    expect(s?.lies.map((l) => [l.authorId, l.bestFib])).toEqual([
      ['bob', true],
      ['cara', false],
      [YOU_ID, false],
    ])
  })

  it('gives every lie sharing the most a best fib, and none when nobody fell for any', () => {
    const tied = revealSummary(reveal([lie('c', 'cara', ['bob']), lie('b', 'bob', ['cara']), truth([YOU_ID])], {}))
    expect(tied?.lies.map((l) => l.bestFib)).toEqual([true, true])
    const none = revealSummary(reveal([lie('c', 'cara', []), lie('b', 'bob', []), truth([YOU_ID, 'bob', 'cara'])], {}))
    expect(none?.lies.map((l) => l.bestFib)).toEqual([false, false])
  })

  it('says what the picture did for you', () => {
    const note = (s: RoomSnapshot) => revealSummary(s)?.you
    // found it
    expect(note(reveal([truth([YOU_ID]), lie('b', 'bob', [])], { [YOU_ID]: 1400, alice: 1400 }))).toEqual({
      points: 1400,
      note: 'you found it',
    })
    // missed it, but your lie paid
    expect(note(reveal([truth([]), lie('y', YOU_ID, ['cara']), lie('b', 'bob', [YOU_ID])], { [YOU_ID]: 350, bob: 350 }))).toEqual({
      points: 350,
      note: '1 fell for it',
    })
    // missed it, nothing won: who fooled you
    expect(note(reveal([truth([]), lie('y', YOU_ID, []), lie('b', 'bob', [YOU_ID])], { bob: 350 }))).toEqual({
      points: 0,
      note: 'Bob fooled you',
    })
    // no guess in time
    expect(note(reveal([truth(['bob']), lie('y', YOU_ID, [])], { bob: 1400, alice: 1400 }))?.note).toBe('no guess this time')
  })

  it('tells the author how their picture did', () => {
    const mine = (pickedBy: string[], points: number) =>
      revealSummary(reveal([truth(pickedBy), lie('b', 'bob', [])], { [YOU_ID]: points }, YOU_ID))?.you
    expect(mine(['bob', 'cara'], 2800)).toEqual({ points: 2800, note: '2 found yours' })
    expect(mine([], 0)).toEqual({ points: 0, note: 'nobody got yours' })
  })

  it('is nothing outside the reveal', () => {
    expect(revealSummary(fixtureSnapshot('guess'))).toBeNull()
  })
})

describe('words and figures', () => {
  it('lists names as a sentence', () => {
    expect(nameList([])).toBe('')
    expect(nameList(['Mara'])).toBe('Mara')
    expect(nameList(['Mara', 'Teo'])).toBe('Mara and Teo')
    expect(nameList(['Mara', 'Teo', 'Bob'])).toBe('Mara, Teo and Bob')
  })

  it('prints points with thousands separators', () => {
    expect(formatPoints(0)).toBe('0')
    expect(formatPoints(4000)).toBe('4,000')
    expect(formatPoints(12600)).toBe('12,600')
  })

  it('signs a gain the same way', () => {
    expect(signedPoints(1400)).toBe('+1,400')
    expect(signedPoints(350)).toBe('+350')
    expect(signedPoints(0)).toBe('+0')
  })
})
