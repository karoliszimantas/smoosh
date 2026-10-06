import { describe, it, expect } from 'vitest'
import {
  AWARDS,
  announcements,
  awardsTimeline,
  galleryResults,
  runnerUpRequired,
  type GalleryVote,
  type PictureResult,
} from '@smoosh/protocol'

const vote = (voterId: string, favourite: string, runnerUp: string | null = null): GalleryVote => ({
  voterId,
  favourite,
  runnerUp,
})
const awardOf = (results: PictureResult[]) => Object.fromEntries(results.map((r) => [r.authorId, r.award]))

describe('gallery votes', () => {
  it('favourite 2, runner-up 1, counted per picture', () => {
    const r = galleryResults(['a', 'b', 'c'], [vote('a', 'b', 'c'), vote('b', 'c', 'a'), vote('c', 'b', 'a')])
    expect(r.map((x) => [x.authorId, x.favourites, x.runnerUps, x.points])).toEqual([
      ['a', 0, 2, 2],
      ['b', 2, 0, 4],
      ['c', 1, 1, 3],
    ])
  })

  it('a vote for your own picture counts for nothing', () => {
    const r = galleryResults(['a', 'b'], [vote('a', 'a', 'b')])
    expect(r.every((x) => x.points === 0)).toBe(true)
  })

  it('runner-up is optional below three eligible pictures', () => {
    expect(runnerUpRequired(2)).toBe(false)
    expect(runnerUpRequired(3)).toBe(true)
  })
})

describe('awards', () => {
  it('Best in Show: most favourites; Second Prize: next highest total', () => {
    const r = galleryResults(['a', 'b', 'c'], [vote('a', 'b', 'c'), vote('b', 'c', 'a'), vote('c', 'b', 'a')])
    expect(awardOf(r)).toEqual({ b: 'best', c: 'second', a: 'everybodysSecond' })
  })

  it('ties share the award — never broken arbitrarily', () => {
    const r = galleryResults(['a', 'b', 'c', 'd'], [vote('a', 'b', 'c'), vote('b', 'a', 'c'), vote('c', 'a', 'd'), vote('d', 'b', 'c')])
    // a and b: two favourites each
    expect(awardOf(r)).toMatchObject({ a: 'best', b: 'best' })
  })

  it('Most Divisive: favourites, and nothing at all from several who judged', () => {
    // six players. b: best (3 favourites). c: one favourite, and three judges
    // gave it nothing — the room split over it
    const r = galleryResults(
      ['a', 'b', 'c', 'd', 'e', 'f'],
      [
        vote('a', 'b', 'd'),
        vote('c', 'b', 'd'),
        vote('d', 'b', 'e'),
        vote('e', 'c', 'd'),
        vote('f', 'd', 'b'),
        vote('b', 'd', 'e'),
      ],
    )
    expect(awardOf(r)).toMatchObject({ b: 'best', d: 'second', c: 'divisive' })
  })

  it('Everybody’s Second: the most runner-ups with no favourites at all', () => {
    const r = galleryResults(
      ['a', 'b', 'c', 'd', 'e'],
      [vote('a', 'b', 'e'), vote('b', 'c', 'e'), vote('c', 'b', 'e'), vote('d', 'b', 'c'), vote('e', 'c', 'd')],
    )
    expect(awardOf(r)).toMatchObject({ b: 'best', c: 'second', e: 'everybodysSecond' })
  })

  it('Honourable Mention: a single vote is still recognised; no votes, no award', () => {
    const r = galleryResults(
      ['a', 'b', 'c', 'd', 'e'],
      [vote('a', 'b', 'c'), vote('b', 'c', 'e'), vote('c', 'b', 'e'), vote('d', 'b', 'c'), vote('e', 'b', 'd')],
    )
    expect(awardOf(r)).toMatchObject({ b: 'best', c: 'second', e: 'everybodysSecond' })
    // d: one runner-up vote, and nothing else to its name
    expect(r.find((x) => x.authorId === 'd')?.award).toBe('honourable')
    expect(r.find((x) => x.authorId === 'a')?.award).toBeNull()
  })

  it('nobody voted: no awards at all', () => {
    expect(galleryResults(['a', 'b', 'c'], []).every((r) => r.award === null)).toBe(true)
  })

  it('announced lowest first, building to Best in Show', () => {
    const r = galleryResults(['a', 'b', 'c'], [vote('a', 'b', 'c'), vote('b', 'c', 'a'), vote('c', 'b', 'a')])
    expect(announcements(r)).toEqual(['everybodysSecond', 'second', 'best'])
  })
})

describe('the reveal’s pacing', () => {
  it('three players fit in 15 seconds; eight take barely longer', () => {
    // the most a 3-player round can announce: best, second and one more
    expect(awardsTimeline(['honourable', 'second', 'best']).totalMs).toBeLessThanOrEqual(15_000)
    // every award at once — the most any room size can produce
    expect(awardsTimeline(AWARDS).totalMs).toBeLessThanOrEqual(20_000)
  })
})
