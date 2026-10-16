import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RoomSnapshot } from '@smoosh/protocol'
import FinalView from './phases/FinalView'
import { ampersandList, finalPlaces, showsExhibition } from './finalStandings'
import { fixtureSnapshot } from '../dev/fixtures'

const emit = () => Promise.reject(new Error('not used'))
const noop = () => {}

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

// Sam (you, the host) 1500, Alice 2000, Bob 500, Cara 1000; with `tie`, Cara 1500
const final = (opts: { tie?: boolean } = {}): RoomSnapshot => fixtureSnapshot('scores', undefined, { final: true, ...opts })

function withTotals(totals: Record<string, number>): RoomSnapshot {
  const snap = final()
  if (snap.phase.phase !== 'scores') throw new Error('fixture')
  const scoreboard = snap.phase.scoreboard.map((e) => ({ ...e, total: totals[e.playerId] ?? e.total }))
  return { ...snap, phase: { ...snap.phase, scoreboard } }
}

const steps = (html: string) => [...html.matchAll(/<li class="podium-place (\w+)">/g)].map((m) => m[1])

describe('the final places', () => {
  it('groups players who finished level', () => {
    const snap = final({ tie: true })
    if (snap.phase.phase !== 'scores') throw new Error('fixture')
    expect(finalPlaces(snap.phase.scoreboard).map((p) => [p.rank, p.tied, p.entries.map((e) => e.playerId)])).toEqual([
      [1, false, ['alice']],
      [2, true, ['you', 'cara']],
      [4, false, ['bob']],
    ])
  })

  it('reads joint names with an ampersand', () => {
    expect(ampersandList(['Mara'])).toBe('Mara')
    expect(ampersandList(['Mara', 'Teo'])).toBe('Mara & Teo')
    expect(ampersandList(['Mara', 'Teo', 'Bob'])).toBe('Mara, Teo & Bob')
  })

  it('leaves Gallery’s ending to the exhibition', () => {
    expect(showsExhibition(fixtureSnapshot('scores', undefined, { exhibition: true }))).toBe(true)
    expect(showsExhibition(final())).toBe(false)
    expect(showsExhibition(fixtureSnapshot('scores'))).toBe(false)
  })
})

describe('game over', () => {
  it('names the winner on the banner, under the game’s length', () => {
    const text = textOf(renderToStaticMarkup(<FinalView snapshot={final()} emit={emit} onLeave={noop} />))
    expect(text).toMatch(/^Game over · 3 rounds Alice wins/)
  })

  it('stands first, second and third on the podium, the winner circled, the rest below', () => {
    const html = renderToStaticMarkup(<FinalView snapshot={final()} emit={emit} onLeave={noop} />)
    expect(steps(html)).toEqual(['first', 'second', 'third'])
    expect(html.match(/class="podium-ring"/g)).toHaveLength(1)
    expect(html).toContain('<span class="visually-hidden">First place:</span>')
    expect(textOf(html)).toContain('Fourth: B Bob 500')
  })

  it('shares a step on a tie, saying joint, and leaves an empty place off', () => {
    const html = renderToStaticMarkup(<FinalView snapshot={final({ tie: true })} emit={emit} onLeave={noop} />)
    // =2 for Sam and Cara: nobody is third, so the third step goes
    expect(steps(html)).toEqual(['first', 'second'])
    expect(html).toContain('<span class="visually-hidden">Joint second place:</span>')
    expect(textOf(html)).toContain('Sam & Cara joint')
    expect(html).toContain('podium-chip joint you')
  })

  it('names every winner on a tie for first', () => {
    const text = textOf(
      renderToStaticMarkup(<FinalView snapshot={withTotals({ alice: 2000, you: 2000 })} emit={emit} onLeave={noop} />),
    )
    expect(text).toContain('Sam & Alice win')
  })

  it('has fewer steps with fewer players', () => {
    const snap = final()
    if (snap.phase.phase !== 'scores') throw new Error('fixture')
    const two = { ...snap, phase: { ...snap.phase, scoreboard: snap.phase.scoreboard.slice(0, 2) } }
    expect(steps(renderToStaticMarkup(<FinalView snapshot={two} emit={emit} onLeave={noop} />))).toEqual(['first', 'second'])
  })

  it('gives the host the way on, and everyone else the wait, and everyone Leave', () => {
    const host = textOf(renderToStaticMarkup(<FinalView snapshot={final()} emit={emit} onLeave={noop} />))
    expect(host).toContain('Play again Change settings Leave')
    const snap = final()
    const guest = textOf(
      renderToStaticMarkup(<FinalView snapshot={{ ...snap, you: { ...snap.you, isHost: false } }} emit={emit} onLeave={noop} />),
    )
    expect(guest).not.toContain('Play again')
    expect(guest).toContain('Waiting for Sam to start a new game… Leave')
  })
})
