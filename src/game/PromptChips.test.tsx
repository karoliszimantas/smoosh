import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PromptChips from './PromptChips'
import { promptSegments, promptTabs } from '../assets/search'

describe('cutting a prompt into chips', () => {
  it('splits words that get a tab from the text between them', () => {
    expect(promptSegments('Sloth Working as a Lifeguard')).toEqual([
      { kind: 'word', text: 'Sloth', label: 'Sloth', term: 'sloth' },
      { kind: 'connector', text: 'Working as a' },
      { kind: 'word', text: 'Lifeguard', label: 'Lifeguard', term: 'lifeguard' },
    ])
  })

  it('makes a chip of exactly the words the asset sheet makes a tab of', () => {
    for (const prompt of ['Crab performing heart surgery', 'Pug Chainsawing a Birthday Cake', "A Pirate's Parrot and a Parrot"]) {
      const chipTerms = [...new Set(promptSegments(prompt).flatMap((s) => (s.kind === 'word' ? [s.term] : [])))]
      expect(chipTerms).toEqual(promptTabs(prompt).map((t) => t.term))
    }
  })

  it('keeps a repeated word in place, under the one term', () => {
    const words = promptSegments('Parrot Teaching a Parrot').filter((s) => s.kind === 'word')
    expect(words.map((s) => s.term)).toEqual(['parrot', 'teaching', 'parrot'])
  })
})

describe('PromptChips', () => {
  const html = renderToStaticMarkup(<PromptChips prompt="Crab performing heart surgery" />)

  it('labels the paragraph with the prompt as written', () => {
    expect(html).toMatch(/^<p class="prompt-chips" aria-label="Crab performing heart surgery">/)
    expect(html).toContain('<span class="visually-hidden">Crab performing heart surgery</span>')
  })

  it('hides every chip and connector from screen readers', () => {
    const spans = html.match(/<span [^>]*class="prompt-(chip|connector)[^"]*"[^>]*>/g) ?? []
    expect(spans).toHaveLength(4)
    for (const span of spans) expect(span).toContain('aria-hidden="true"')
  })

  it('cycles the chip colours over the words alone', () => {
    const chips = [...html.matchAll(/class="prompt-chip (prompt-chip-\d)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]])
    expect(chips).toEqual([
      ['prompt-chip-0', 'Crab'],
      ['prompt-chip-1', 'heart'],
      ['prompt-chip-2', 'surgery'],
    ])
    expect(html).toContain('<span aria-hidden="true" class="prompt-connector">performing</span>')
  })
})
