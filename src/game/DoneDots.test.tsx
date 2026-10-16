import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Presence, RoomSnapshot } from '@smoosh/protocol'
import DoneDots from './DoneDots'
import { whoIsDone } from './whoIsDone'
import { fixtureSnapshot, FIXTURE_BASE, type FixturePhase } from '../dev/fixtures'

// You are Sam; the others are Alice, Bob and Cara, in seat order
function snap(
  phase: FixturePhase,
  waitingOn: string[],
  presence: Record<string, Presence> = {},
  authorId?: string,
): RoomSnapshot {
  const snapshot = fixtureSnapshot(phase, FIXTURE_BASE, authorId ? { authorId } : {})
  snapshot.waitingOn = waitingOn
  snapshot.players = snapshot.players.map((p) => ({ ...p, presence: presence[p.id] ?? p.presence }))
  return snapshot
}

describe('who is done, in a sentence', () => {
  it('names who has built and who is still building', () => {
    expect(whoIsDone(snap('build', ['bob', 'cara'])).label).toBe('Alice and you are done. Bob and Cara are still building.')
    expect(whoIsDone(snap('build', ['you'])).label).toBe('Alice, Bob and Cara are done. You are still building.')
  })

  it('leaves the picture’s author out of lies and guesses, and says who is away', () => {
    const lie = whoIsDone(snap('lie', ['bob'], { cara: 'away' }, 'alice'))
    expect(lie.label).toBe('You have sent a lie. Bob is still writing. Cara is away.')
    expect(lie.dots.map((d) => [d.player.name, d.state])).toEqual([
      ['Sam', 'done'],
      ['Bob', 'pending'],
      ['Cara', 'away'],
    ])
    expect(whoIsDone(snap('guess', ['you', 'cara'], {}, 'bob')).label).toBe(
      'Alice has locked in. Cara and you are still choosing.',
    )
  })

  it('between pictures, just says who is playing — not who left', () => {
    const reveal = whoIsDone(snap('reveal', [], { bob: 'away', cara: 'left' }))
    expect(reveal.label).toBe('Playing: Alice and you. Bob is away.')
    expect(reveal.dots.map((d) => d.state)).toEqual(['here', 'here', 'away'])
  })
})

describe('the dots', () => {
  it('is one image, named by the sentence, with a check for each player done', () => {
    const html = renderToStaticMarkup(<DoneDots snapshot={snap('build', ['bob'], { cara: 'away' })} />)
    expect(html).toMatch(/^<div class="done-dots" role="img" aria-label="Alice and you are done. Bob is still building. Cara is away.">/)
    expect(html.match(/class="player-dot"/g)).toHaveLength(2)
    expect(html.match(/<path d="M1.6 5.4/g)).toHaveLength(2)
    expect(html).toContain('class="player-dot pending"')
    expect(html).toContain('class="player-dot away"')
    // nothing in it speaks on its own
    expect(html.match(/aria-label=/g)).toHaveLength(1)
  })

  it('draws everyone plain between pictures: no checks, no ghosts', () => {
    const html = renderToStaticMarkup(<DoneDots snapshot={snap('scores', [])} />)
    expect(html.match(/class="player-dot"/g)).toHaveLength(4)
    expect(html).not.toContain('M1.6 5.4')
  })

  it('tells Mara from Max with two letters, and keeps a waiting player’s colour and shape', () => {
    const snapshot = snap('build', ['alice'])
    snapshot.players = snapshot.players.map((p) =>
      p.id === 'alice' ? { ...p, name: 'Mara' } : p.id === 'bob' ? { ...p, name: 'Max' } : p,
    )
    const html = renderToStaticMarkup(<DoneDots snapshot={snapshot} />)
    const pending = html.match(/<span class="player-dot pending" style="([^"]*)"[^>]*>([^<]*)<span class="player-badge">(<svg[^]*?<\/svg>)/)
    expect(pending?.[1]).toContain('--p-bg:')
    expect(pending?.[2]).toBe('Ma')
    // the seat's shape (Alice's circle), not a blank ghost
    expect(pending?.[3]).toContain('<circle')
    expect(html).toMatch(/>Mx<span class="player-badge">/)
    expect(html).toMatch(/>S<span class="player-badge">/)
  })
})
