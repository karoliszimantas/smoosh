import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Wordmark from './Wordmark'

const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0

describe('the wordmark', () => {
  it('is one image called smoosh, its six cut letters hidden', () => {
    const html = renderToStaticMarkup(<Wordmark />)
    expect(html).toMatch(/^<span class="wordmark wordmark-lg" role="img" aria-label="smoosh">/)
    expect(count(html, /class="wordmark-tile [a-z]+"[^>]*aria-hidden="true"/g)).toBe(6)
    // the letters, in order, spell it for anyone reading the markup
    expect(html.replace(/<[^>]+>/g, '')).toBe('smoosh')
  })

  it('is held down by one strip of tape, at either size', () => {
    for (const size of ['lg', 'sm'] as const) {
      const html = renderToStaticMarkup(<Wordmark size={size} />)
      expect(count(html, /class="tape[ "]/g)).toBe(1)
      expect(html).toMatch(/class="tape[^"]*"[^>]*aria-hidden="true"/)
    }
  })

  it('paints each scrap its own colour, from the theme', () => {
    const html = renderToStaticMarkup(<Wordmark size="sm" />)
    expect(html).toContain('class="wordmark wordmark-sm"')
    for (let i = 0; i < 6; i++) expect(html).toContain(`background:var(--wordmark-${i})`)
  })
})
