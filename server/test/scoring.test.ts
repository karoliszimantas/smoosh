import { describe, it, expect } from 'vitest'
import { scorePicture, scoreRatings } from '../src/game/scoring.ts'

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

describe('scoreRatings', () => {
  it('scores the average, 200 points per star', () => {
    expect(scoreRatings([5, 5, 5])).toEqual({ average: 5, counts: [0, 0, 0, 0, 3], points: 1000 })
    expect(scoreRatings([1, 2])).toEqual({ average: 1.5, counts: [1, 1, 0, 0, 0], points: 300 })
  })

  it('rounds to whole points', () => {
    expect(scoreRatings([4, 4, 5]).points).toBe(867)
  })

  it('is unaffected by how many people rated — a timeout does not cost the author', () => {
    expect(scoreRatings([4]).points).toBe(scoreRatings([4, 4, 4, 4]).points)
  })

  it('no ratings: no average, no points', () => {
    expect(scoreRatings([])).toEqual({ average: null, counts: [0, 0, 0, 0, 0], points: 0 })
  })
})
