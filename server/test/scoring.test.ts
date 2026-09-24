import { describe, it, expect } from 'vitest'
import { scorePicture } from '../src/game/scoring.ts'

describe('scorePicture', () => {
  it('awards the guesser and the author 1000 each when the truth is guessed', () => {
    const deltas = scorePicture({
      authorId: 'author',
      truthOptionId: 'truth',
      lies: [],
      guesses: [{ playerId: 'guesser', optionId: 'truth' }],
    })
    expect(deltas).toEqual(
      expect.arrayContaining([
        { playerId: 'guesser', points: 1000, reason: 'guessed_truth' },
        { playerId: 'author', points: 1000, reason: 'picture_guessed' },
      ]),
    )
    expect(deltas).toHaveLength(2)
  })

  it('awards the author 1000 for each separate guesser who finds the truth', () => {
    const deltas = scorePicture({
      authorId: 'author',
      truthOptionId: 'truth',
      lies: [],
      guesses: [
        { playerId: 'p1', optionId: 'truth' },
        { playerId: 'p2', optionId: 'truth' },
      ],
    })
    const authorDeltas = deltas.filter((d) => d.playerId === 'author')
    expect(authorDeltas).toHaveLength(2)
    expect(authorDeltas.every((d) => d.points === 1000 && d.reason === 'picture_guessed')).toBe(true)
  })

  it('awards a lie author 500 for each guesser who picks their lie, independently', () => {
    const deltas = scorePicture({
      authorId: 'author',
      truthOptionId: 'truth',
      lies: [{ optionId: 'lieA', authorId: 'liar' }],
      guesses: [
        { playerId: 'p1', optionId: 'lieA' },
        { playerId: 'p2', optionId: 'lieA' },
      ],
    })
    const liarDeltas = deltas.filter((d) => d.playerId === 'liar')
    expect(liarDeltas).toHaveLength(2)
    expect(liarDeltas.every((d) => d.points === 500 && d.reason === 'lie_picked')).toBe(true)
  })

  it('produces no delta for a missing guess (timeout)', () => {
    const deltas = scorePicture({
      authorId: 'author',
      truthOptionId: 'truth',
      lies: [{ optionId: 'lieA', authorId: 'liar' }],
      guesses: [],
    })
    expect(deltas).toEqual([])
  })

  it('scores a truth guess correctly even with zero submitted lies', () => {
    const deltas = scorePicture({
      authorId: 'author',
      truthOptionId: 'truth',
      lies: [],
      guesses: [{ playerId: 'guesser', optionId: 'truth' }],
    })
    expect(deltas).toHaveLength(2)
  })

  it('ignores a guess recorded from the author themselves (defensive)', () => {
    const deltas = scorePicture({
      authorId: 'author',
      truthOptionId: 'truth',
      lies: [],
      guesses: [{ playerId: 'author', optionId: 'truth' }],
    })
    expect(deltas).toEqual([])
  })

  it('splits a mixed set of guessers across the truth and two distinct lies correctly', () => {
    const deltas = scorePicture({
      authorId: 'author',
      truthOptionId: 'truth',
      lies: [
        { optionId: 'lieA', authorId: 'liarA' },
        { optionId: 'lieB', authorId: 'liarB' },
      ],
      guesses: [
        { playerId: 'p1', optionId: 'truth' },
        { playerId: 'p2', optionId: 'lieA' },
        { playerId: 'p3', optionId: 'lieB' },
      ],
    })
    expect(deltas).toEqual(
      expect.arrayContaining([
        { playerId: 'p1', points: 1000, reason: 'guessed_truth' },
        { playerId: 'author', points: 1000, reason: 'picture_guessed' },
        { playerId: 'liarA', points: 500, reason: 'lie_picked' },
        { playerId: 'liarB', points: 500, reason: 'lie_picked' },
      ]),
    )
    expect(deltas).toHaveLength(4)
  })
})
