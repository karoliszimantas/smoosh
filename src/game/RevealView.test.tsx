import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RoomSnapshot } from '@smoosh/protocol'
import RevealView from './phases/RevealView'
import { fixtureSnapshot, YOU_ID } from '../dev/fixtures'

const emit = () => Promise.reject(new Error('not used'))

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

// the fixture: Alice's picture; you fell for Bob's lie, Bob fell for yours
function found(): RoomSnapshot {
  const snap = fixtureSnapshot('reveal')
  if (snap.phase.phase !== 'reveal') throw new Error('fixture')
  const options = snap.phase.options.map((o) =>
    o.isTruth ? { ...o, pickedBy: [YOU_ID, 'cara'] } : o.authorId === 'bob' ? { ...o, pickedBy: [] } : o,
  )
  return {
    ...snap,
    phase: {
      ...snap.phase,
      options,
      pointsThisPicture: [
        { playerId: YOU_ID, points: 1750 },
        { playerId: 'cara', points: 1400 },
        { playerId: 'alice', points: 2800 },
      ],
    },
  }
}

describe('the reveal', () => {
  it('stamps the real prompt for the eye and says so for a screen reader', () => {
    const html = renderToStaticMarkup(<RevealView snapshot={found()} emit={emit} />)
    expect(html).toContain('<section class="torn torn-c reveal-truth-card" aria-label="The real prompt">')
    expect(html).toContain('<span class="real-stamp"><span aria-hidden="true">Real</span><span class="visually-hidden">This is the real prompt</span></span>')
  })

  it('bursts with your points when you won some', () => {
    const html = renderToStaticMarkup(<RevealView snapshot={found()} emit={emit} />)
    expect(html).toContain('class="burst" role="img" aria-label="Plus 1750 points: you found it"')
    expect(textOf(html)).toContain('Found it · +1,400 each')
    expect(html).toContain('aria-label="Found by you and Cara"')
  })

  it('has no burst when you won nothing, just the note', () => {
    const snap = fixtureSnapshot('reveal')
    if (snap.phase.phase !== 'reveal') throw new Error('fixture')
    const html = renderToStaticMarkup(
      <RevealView snapshot={{ ...snap, phase: { ...snap.phase, pointsThisPicture: [] } }} emit={emit} />,
    )
    expect(html).not.toContain('class="burst"')
    expect(html).toContain('<p class="reveal-note">Bob fooled you</p>')
  })

  it('prices each lie, names who fell for it, and marks the best fib', () => {
    const text = textOf(renderToStaticMarkup(<RevealView snapshot={found()} emit={emit} />))
    // yours fooled Bob; Bob's fooled nobody this time
    expect(text).toContain('a dog in a bathtub Fake · by you · +350 ×1')
    expect(text).toContain('grandma at the beach Fake · by Bob · no takers')
    const html = renderToStaticMarkup(<RevealView snapshot={found()} emit={emit} />)
    expect(html.match(/class="best-fib"/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Picked by Bob"')
  })

  it('runs the scores so far along the foot, with this picture’s points', () => {
    const text = textOf(renderToStaticMarkup(<RevealView snapshot={found()} emit={emit} />))
    expect(text).toContain('Sam: 1,500, up 1,750')
    expect(text).toContain('Bob: 500 B Bob 500')
  })
})
