import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LieView from './phases/LieView'
import { fixtureSnapshot, YOU_ID } from '../dev/fixtures'

const emit = () => Promise.reject(new Error('not used'))

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

describe('writing a lie', () => {
  it('is a real form: a labelled one-line box of 80 and a send button', () => {
    const html = renderToStaticMarkup(<LieView snapshot={fixtureSnapshot('lie')} emit={emit} />)
    expect(html).toContain('<form class="lie-form">')
    expect(html).toContain('<label class="field-label" for="lie-text">Your fake prompt</label>')
    expect(html).toMatch(/<textarea id="lie-text"[^>]*rows="3"[^>]*maxLength="80"/)
    expect(html).toContain('type="submit"')
    expect(textOf(html)).toContain('Real prompts look like: someone, in something, doing something, somewhere')
    expect(textOf(html)).toContain('Send lie')
    // no counter until it's worth watching
    expect(html).not.toContain('lie-count')
    // the picture, taped down
    expect(html).toContain('class="picture-frame"')
    expect(html).toContain('class="tape"')
  })

  it('after a reload into it, says the lie is in and who it waits for', () => {
    const snap = fixtureSnapshot('lie')
    const html = renderToStaticMarkup(
      <LieView snapshot={{ ...snap, waitingOn: ['bob'], you: { ...snap.you, hasActedThisPhase: true } }} emit={emit} />,
    )
    const text = textOf(html)
    expect(text).toContain('Your lie is in.')
    expect(text).toContain('Waiting for Bob')
    expect(html).not.toContain('<form')
  })

  it('the picture’s author keeps a straight face instead', () => {
    const snap = fixtureSnapshot('lie', undefined, { authorId: YOU_ID })
    const html = renderToStaticMarkup(<LieView snapshot={{ ...snap, waitingOn: ['bob', 'cara'] }} emit={emit} />)
    const text = textOf(html)
    expect(text).toContain('This one’s yours. Keep a straight face.')
    expect(text).toContain('Waiting for Bob and Cara')
    expect(html).not.toContain('<form')
  })
})
