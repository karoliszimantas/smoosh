import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RoomSnapshot } from '@smoosh/protocol'
import ScoresView from './phases/ScoresView'
import { fixtureSnapshot } from '../dev/fixtures'

const emit = () => Promise.reject(new Error('not used'))

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

// Sam (you) 1500, Alice 2000, Bob 500, Cara 1000 — with `tie`, Cara 1500
const scores = (opts: { tie?: boolean } = {}): RoomSnapshot => fixtureSnapshot('scores', undefined, opts)

describe('the standings after a round', () => {
  it('heads the screen with where the game is', () => {
    expect(renderToStaticMarkup(<ScoresView snapshot={scores()} emit={emit} />)).toContain(
      '<h1 class="round-heading scores-title">After round 1 of 3</h1>',
    )
  })

  it('ranks highest first, sharing a place on a tie, said aloud as joint', () => {
    const html = renderToStaticMarkup(<ScoresView snapshot={scores({ tie: true })} emit={emit} />)
    const ranks = [...html.matchAll(/<span class="standing-rank"><span aria-hidden="true">([^<]*)<\/span><span class="visually-hidden">([^<]*)<\/span>/g)].map(
      (m) => [m[1], m[2]],
    )
    expect(ranks).toEqual([
      ['1', 'First:'],
      ['=2', 'Joint second:'],
      ['=2', 'Joint second:'],
      ['4', 'Fourth:'],
    ])
  })

  it('marks your row, tapes the leader, and prints totals with separators', () => {
    const html = renderToStaticMarkup(<ScoresView snapshot={scores()} emit={emit} />)
    expect(html.match(/<li class="standing you">/g)).toHaveLength(1)
    expect(html).toContain('<span class="standing-you">You</span>')
    expect(html.match(/class="tape"/g)).toHaveLength(1)
    expect(textOf(html)).toContain('Alice , this round +2275 , total 2,000')
  })

  it('keeps the away and left markers', () => {
    const snap = scores()
    const players = snap.players.map((p) =>
      p.id === 'bob' ? { ...p, presence: 'away' as const } : p.id === 'cara' ? { ...p, presence: 'left' as const } : p,
    )
    const html = renderToStaticMarkup(<ScoresView snapshot={{ ...snap, players }} emit={emit} />)
    expect(html).toContain('Bob</span><span class="away-marker">away</span>')
    expect(html).toContain('Cara</span><span class="away-marker">left</span>')
  })

  it('says when the next round starts', () => {
    expect(textOf(renderToStaticMarkup(<ScoresView snapshot={scores()} emit={emit} />))).toMatch(/Next: Round 2 in \d+ …$/)
  })

  it('shows no per-round points where the mode doesn’t keep them', () => {
    const snap = scores()
    if (snap.phase.phase !== 'scores') throw new Error('fixture')
    const scoreboard = snap.phase.scoreboard.map((e) => ({ ...e, round: null, game: null }))
    const html = renderToStaticMarkup(<ScoresView snapshot={{ ...snap, phase: { ...snap.phase, scoreboard } }} emit={emit} />)
    expect(html).not.toContain('standing-delta')
  })
})
