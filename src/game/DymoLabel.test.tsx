import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DymoLabel from './DymoLabel'

describe('the room code label', () => {
  it('spells the code for a screen reader, one letter at a time', () => {
    const html = renderToStaticMarkup(<DymoLabel code="KRPT" />)
    expect(html).toMatch(/^<span class="dymo dymo-lg" role="img" aria-label="Room code K R P T">/)
  })

  it('hides the punched letters themselves', () => {
    const html = renderToStaticMarkup(<DymoLabel code="krpt" size="sm" />)
    expect(html).toContain('class="dymo dymo-sm"')
    expect(html).toContain('aria-label="Room code K R P T"')
    const letters = [...html.matchAll(/<span aria-hidden="true">([A-Z])<\/span>/g)].map((m) => m[1])
    expect(letters).toEqual(['K', 'R', 'P', 'T'])
    // nothing to read outside the label
    expect(html.replace(/<span aria-hidden="true">[A-Z]<\/span>/g, '').replace(/<[^>]+>/g, '')).toBe('')
  })
})
