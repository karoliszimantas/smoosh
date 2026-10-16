import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LobbyView from './phases/LobbyView'
import { HOW_TO_PLAY_STEPS } from './howToPlayText'
import { resetHowToPlayVisit } from './howToPlaySeen'
import { fixtureSnapshot } from '../dev/fixtures'

const emit = () => Promise.reject(new Error('not used'))

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

describe('how to play in a first lobby', () => {
  beforeEach(resetHowToPlayVisit)
  afterEach(() => vi.unstubAllGlobals())

  it('is a quiet note between the players and the settings — no dialog over the code', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
    const html = renderToStaticMarkup(<LobbyView snapshot={fixtureSnapshot('lobby')} emit={emit} />)
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('aria-modal')
    const seats = html.indexOf('class="lobby-seats"')
    const note = html.indexOf('class="paper-card lobby-howto"')
    const settings = html.indexOf('aria-label="Game settings"')
    expect(seats).toBeGreaterThan(-1)
    expect(note).toBeGreaterThan(seats)
    expect(settings).toBeGreaterThan(note)
    expect(textOf(html)).toContain(
      'Spot it. Find the real one: points for you and the builder. Fool someone: points for you. Got it',
    )
  })

  it('once put away, stays away', () => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'smoosh_how_to_play_seen' ? '1' : null), setItem: () => {} })
    const html = renderToStaticMarkup(<LobbyView snapshot={fixtureSnapshot('lobby')} emit={emit} />)
    expect(html).not.toContain('lobby-howto')
  })

  it('promises no point values: they depend on the table', () => {
    for (const step of HOW_TO_PLAY_STEPS) expect(step.text).not.toMatch(/\d/)
  })
})
