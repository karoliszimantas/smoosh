import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PromptBar, { PromptWords } from './PromptBar'
import { usedPromptWords } from './layerItem'
import { commitDoc, undoDoc, type Doc } from './history'

const noop = () => {}

function words(used: string[]) {
  return renderToStaticMarkup(<PromptWords text="Sloth Working as a Lifeguard" usedWords={new Set(used)} onWord={noop} />)
}

describe('the prompt row’s word chips', () => {
  it('is one group, a button per word that gets a search tab', () => {
    const html = words([])
    expect(html).toContain('role="group" aria-label="Your prompt. Tap a word to search it"')
    expect(html.match(/<button /g)).toHaveLength(2)
    expect(html).toContain('aria-label="Sloth. Search it"')
    expect(html).toContain('aria-label="Lifeguard. Search it"')
    expect(html).toContain('<span class="prompt-words-connector" aria-hidden="true">Working as a</span>')
  })

  it('marks a word used, with a check, once a layer came from its tab', () => {
    const html = words(['sloth'])
    expect(html).toContain('class="prompt-word used" aria-label="Sloth, used. Search it"')
    expect(html).toContain('class="prompt-word" aria-label="Lifeguard. Search it"')
    expect(html.match(/prompt-word-check/g)).toHaveLength(1)
  })

  it('reads a freestyle line instead of offering words', () => {
    const html = renderToStaticMarkup(
      <PromptBar
        text="Build whatever you want"
        freestyle
        usedWords={new Set()}
        onWord={noop}
        canUndo={false}
        onUndo={noop}
        submitLabel="Done"
        onSubmit={noop}
        holdToSubmit
      />,
    )
    expect(html).toContain('<p class="prompt-bar-text">Build whatever you want</p>')
    expect(html).not.toContain('prompt-words')
  })

  it('describes Done with its "hold" label', () => {
    const html = renderToStaticMarkup(
      <PromptBar
        text="Sloth Working as a Lifeguard"
        freestyle={false}
        usedWords={new Set()}
        onWord={noop}
        canUndo
        onUndo={noop}
        submitLabel="Done"
        onSubmit={noop}
        holdToSubmit
      />,
    )
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1]
    expect(describedBy).toBeTruthy()
    expect(html).toContain(`<span id="${describedBy}" class="prompt-bar-hold">hold</span>`)
  })
})

describe('which words are used', () => {
  it('follows the layers, so undoing the add un-uses the word', () => {
    type Item = { id: string; fromWord?: string }
    let doc: Doc<Item[]> = { items: [], past: [] }
    doc = commitDoc(doc, (prev) => [...prev, { id: 'a', fromWord: 'sloth' }])
    doc = commitDoc(doc, (prev) => [...prev, { id: 'b' }])
    expect([...usedPromptWords(doc.items)]).toEqual(['sloth'])
    doc = undoDoc(undoDoc(doc))
    expect(usedPromptWords(doc.items).size).toBe(0)
  })

  it('counts a word once however many layers came from it', () => {
    expect([...usedPromptWords([{ fromWord: 'sloth' }, { fromWord: 'sloth' }, { fromWord: 'lifeguard' }])]).toEqual([
      'sloth',
      'lifeguard',
    ])
  })
})
