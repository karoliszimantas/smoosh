import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import GuessView from './phases/GuessView'
import { fixtureSnapshot } from '../dev/fixtures'

const emit = () => Promise.reject(new Error('not used'))

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

// the fixture's options: their lie, the truth, then your own lie
const radios = (html: string) => [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0])

describe('guessing', () => {
  it('asks the question over a radio group of torn scraps', () => {
    const html = renderToStaticMarkup(<GuessView snapshot={fixtureSnapshot('guess')} emit={emit} />)
    expect(html).toContain('<h1 id="guess-question" class="round-heading">Which one is real?</h1>')
    expect(html).toContain('role="radiogroup" aria-labelledby="guess-question"')
    const r = radios(html)
    expect(r).toHaveLength(3)
    expect(r.every((b) => b.includes('aria-checked="false"'))).toBe(true)
    expect(r.every((b) => / class="guess-option torn/.test(b))).toBe(true)
    // one tab stop: the first pickable option
    expect(r.map((b) => b.includes('tabindex="0"'))).toEqual([true, false, false])
  })

  it('lays your own lie flat, greyed and unpickable, and says why', () => {
    const html = renderToStaticMarkup(<GuessView snapshot={fixtureSnapshot('guess')} emit={emit} />)
    const own = radios(html)[2] ?? ''
    expect(own).toContain('aria-disabled="true"')
    expect(own).toContain('own-lie torn-flat')
    expect(html).toContain('<span class="your-lie-label">Your lie</span>')
  })

  it('waits for a pick before Lock in does anything', () => {
    const html = renderToStaticMarkup(<GuessView snapshot={fixtureSnapshot('guess')} emit={emit} />)
    expect(html).toMatch(/<button class="btn btn-primary btn-block" disabled="">Lock in<\/button>/)
    expect(html).not.toContain('picked-label')
  })

  it('once locked in, shows the pick as locked and who is still choosing', () => {
    const snap = fixtureSnapshot('guess')
    const phase = snap.phase
    if (phase.phase !== 'guess') throw new Error('fixture')
    const html = renderToStaticMarkup(
      <GuessView
        snapshot={{ ...snap, waitingOn: ['cara'], you: { ...snap.you, hasActedThisPhase: true, ownGuessId: 'opt-truth' } }}
        emit={emit}
      />,
    )
    const r = radios(html)
    expect(r.map((b) => b.includes('aria-checked="true"'))).toEqual([false, true, false])
    expect(r.every((b) => b.includes('aria-disabled="true"'))).toBe(true)
    expect(html).toContain('<span class="picked-label" aria-hidden="true">Locked</span>')
    expect(textOf(html)).toContain('Waiting for Cara')
    expect(textOf(html)).not.toContain('Lock in')
  })
})
