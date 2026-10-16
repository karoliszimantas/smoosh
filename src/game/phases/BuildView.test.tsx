import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RoomSnapshot } from '@smoosh/protocol'
import BuildView from './BuildView'
import { fixtureSnapshot } from '../../dev/fixtures'

const noop = () => {}
const emit = () => Promise.reject(new Error('not used'))

// rendered HTML with tags stripped and whitespace collapsed
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const line = (html: string) => html.match(/<p class="notice auto-send-line"[^>]*>([^<]*)<\/p>/)
const said = (html: string) => html.match(/<p class="visually-hidden" role="status">([^<]*)<\/p>/)?.[1]
const done = (html: string) => {
  const button = html.match(/<button class="prompt-bar-submit[^"]*"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? ''
  return { label: button.match(/aria-label="([^"]*)"/)?.[1], text: textOf(button) }
}

// Build seconds before this player's own clock runs out
describe('Build says the picture is about to go', () => {
  let snapshot: RoomSnapshot
  let deadline: number
  beforeEach(() => {
    vi.useFakeTimers()
    snapshot = fixtureSnapshot('build')
    deadline = snapshot.you.build?.deadline ?? 0
  })
  afterEach(() => vi.useRealTimers())

  const at = (msLeft: number, s: RoomSnapshot = snapshot, promptWindowOpen = false) => {
    vi.setSystemTime(deadline - msLeft)
    return renderToStaticMarkup(<BuildView snapshot={s} emit={emit} onNotice={noop} promptWindowOpen={promptWindowOpen} />)
  }

  it('says nothing before the last ten seconds', () => {
    const html = at(10_500)
    expect(line(html)).toBeNull()
    expect(said(html)).toBe('')
    expect(done(html)).toEqual({ label: 'Done — press and hold', text: 'Done hold' })
  })

  it('from ten seconds out, counts down under the strip, out of the way of touches', () => {
    const html = at(10_000)
    expect(line(html)?.[1]).toBe('Sending what you have in 10…')
    // the line itself is never read out every second, and takes no touch (CSS)
    expect(line(html)?.[0]).toContain('aria-hidden="true"')
    expect(line(at(9_001))?.[1]).toBe('Sending what you have in 10…')
    expect(line(at(9_000))?.[1]).toBe('Sending what you have in 9…')
    expect(line(at(400))?.[1]).toBe('Sending what you have in 1…')
  })

  it('is announced once, politely', () => {
    const html = at(10_000)
    expect(html).toContain('<p class="visually-hidden" role="status">')
    expect(said(html)).toBe('Sending what you have in 10…')
  })

  it('Done says it too, the same count, and is still held to send', () => {
    expect(done(at(10_000))).toEqual({ label: 'Done · auto in 10 — press and hold', text: 'Done · auto in 10' })
    expect(done(at(3_200))).toEqual({ label: 'Done · auto in 4 — press and hold', text: 'Done · auto in 4' })
    expect(at(3_200)).toContain('prompt-bar-submit hold counting')
  })

  it('stops once the picture is going, or has gone', () => {
    expect(line(at(0))).toBeNull()
    const submitted = { ...snapshot, you: { ...snapshot.you, hasActedThisPhase: true } }
    const html = at(5_000, submitted)
    expect(line(html)).toBeNull()
    expect(done(html).text).toBe('Done hold')
  })

  it('says nothing while the prompt window is up', () => {
    expect(line(at(5_000, snapshot, true))).toBeNull()
  })
})
