import { describe, it, expect } from 'vitest'
import type { LabelRow } from '@smoosh/protocol'
import { completeTag, isLoneTag, suggestTags, tagVocabulary } from './suggest'

const row = (id: string, label: string, tags: string[], remove = false): LabelRow => ({
  id, category: 'animals', label, tags, remove, note: '', editedBy: '', editedAt: '',
})
const rows = [
  row('a', 'Pug', ['pug', 'dog', 'puppy', 'hound']),
  row('b', 'Black Pug', ['pug', 'dog', 'black']),
  row('c', 'Bird', ['bird', 'feathers']),
  row('d', 'Small Birds', ['birds', 'bird', 'flock']),
  row('e', 'Gone Pug', ['pug', 'ghost'], true),
  row('f', 'Goat', ['goat', 'birdie']),
]

describe('tagging help', () => {
  it('the second pug is offered the first pug’s tags, most shared first', () => {
    expect(suggestTags('Pug', rows, 'new', [])).toEqual(['dog', 'pug', 'hound', 'puppy', 'black'])
  })

  it('never offers what’s already there, or tags from removed assets', () => {
    const s = suggestTags('Pug', rows, 'new', ['pug', 'dog'])
    expect(s).not.toContain('pug')
    expect(s).not.toContain('ghost')
  })

  it('a word in common is enough — plurals included', () => {
    expect(suggestTags('Birds on a Wire', rows, 'new', [])).toContain('bird')
  })

  it('typing offers the tags already in use, prefix first', () => {
    const vocab = tagVocabulary(rows)
    expect(completeTag('bir', vocab, [])).toEqual(['bird', 'birdie', 'birds'])
    expect(completeTag('bir', vocab, ['bird'])).not.toContain('bird')
  })

  it('a tag on one asset only is flagged', () => {
    const vocab = tagVocabulary(rows)
    expect(isLoneTag('birdie', vocab, true)).toBe(true)
    expect(isLoneTag('bird', vocab, true)).toBe(false)
    expect(isLoneTag('brand-new', vocab, false)).toBe(true)
  })
})
