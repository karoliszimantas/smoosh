import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import StatusStrip from './StatusStrip'
import { statusLine } from './statusLine'
import { fixtureSnapshot, type FixturePhase } from '../dev/fixtures'

const noop = () => {}

function strip(phase: FixturePhase) {
  const snapshot = fixtureSnapshot(phase)
  const status = statusLine(snapshot)
  if (!status) throw new Error(`no strip in ${phase}`)
  return renderToStaticMarkup(<StatusStrip snapshot={snapshot} status={status} onLeave={noop} />)
}

describe('where the game is', () => {
  it('names the round and the step', () => {
    const where = (phase: FixturePhase) => {
      const s = statusLine(fixtureSnapshot(phase))
      return s && [s.round, s.step, s.word]
    }
    // the fixture is round 1 of 3, its second picture of four
    expect(where('build')).toEqual(['Round 1/3', 'Building', null])
    expect(where('lie')).toEqual(['Round 1/3', 'Picture 2/4', null])
    expect(where('guess')).toEqual(['Round 1/3', 'Picture 2/4', null])
    expect(where('reveal')).toEqual(['Round 1/3', 'Picture 2/4', 'Reveal'])
    expect(where('missing')).toEqual(['Round 1/3', 'Picture 2/4', 'Skip'])
    expect(where('scores')).toEqual(['Round 1/3', 'Standings', 'Scores'])
    expect(where('vote')).toEqual(['Round 1/3', 'Voting', null])
    expect(where('pass')).toEqual(['Round 1/3', 'Pass 2/3', null])
    expect(where('chainReveal')).toEqual(['Round 1/3', 'Chains', 'Reveal'])
    expect(where('chainVote')).toEqual(['Round 1/3', 'Voting', null])
  })

  it('has no strip in the lobby, the awards or the final scores', () => {
    expect(statusLine(fixtureSnapshot('lobby'))).toBeNull()
    expect(statusLine(fixtureSnapshot('awards'))).toBeNull()
    expect(statusLine(fixtureSnapshot('chainAwards'))).toBeNull()
    const scores = fixtureSnapshot('scores')
    if (scores.phase.phase !== 'scores') throw new Error('not scores')
    expect(statusLine({ ...scores, phase: { ...scores.phase, isFinalRound: true, deadline: null } })).toBeNull()
  })

  it('times a build by your own clock', () => {
    const snapshot = fixtureSnapshot('build')
    if (!snapshot.you.build) throw new Error('fixture has no build window')
    expect(statusLine(snapshot)?.deadline).toBe(snapshot.you.build.deadline)
  })
})

describe('the strip', () => {
  it('holds the tag, the dots, the theme switch and the menu', () => {
    const html = strip('guess')
    expect(html).toMatch(/^<header class="status-strip">/)
    expect(html).toContain('role="timer"')
    expect(html).toContain('class="done-dots" role="img"')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-label="Game menu"')
    expect(html).toContain('class="game-menu in-strip"')
  })

  it('names the phase on the tag on Reveal', () => {
    const html = strip('reveal')
    expect(html).toContain('<span class="timer-tag-word">Reveal</span>')
    expect(html).not.toContain('role="timer"')
  })
})
