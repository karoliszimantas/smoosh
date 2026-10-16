import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SearchResult } from '../assets'
import { ResultCard } from './AssetSheet'
import { CUT_FAILED_TEXT, CUT_TOO_SLOW_TEXT, dropCut, notesOnCut } from './cutSwap'
import type { LayerItem } from './layerItem'

const noop = () => {}

// a Pixabay result nobody has cut yet: only this phone can cut it
const uncut: SearchResult = {
  key: 'px-1',
  tier: 3,
  label: 'pug',
  pixabayId: 1,
  thumb: 'thumb.jpg',
  cut: null,
  rect: { full: 'full.jpg', thumb: 'thumb.jpg' },
  isBackground: false,
}
const alreadyCut: SearchResult = { ...uncut, key: 'px-2', pixabayId: 2, tier: 2, cut: { full: 'cut.webp', thumb: 'cut.webp' } }

const card = (result: SearchResult, opts: { cutAvailable?: boolean; downloadNote?: boolean } = {}) =>
  renderToStaticMarkup(
    <ResultCard
      result={result}
      cutAvailable={opts.cutAvailable ?? true}
      downloadNote={opts.downloadNote ?? false}
      onCut={noop}
      onFull={noop}
      onReport={noop}
    />,
  )
const buttons = (html: string) => [...html.matchAll(/<button class="result-action[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])

const layer = (id: string, cutting?: string): LayerItem => ({
  id,
  src: 'full.jpg',
  thumb: 'thumb.jpg',
  label: 'pug',
  x: 500,
  y: 500,
  scale: 1,
  rotation: 0,
  mirrored: false,
  opacity: 1,
  ...(cutting ? { cutting } : {}),
})

describe('Cut on a phone too slow to cut', () => {
  it('stays on every card, next to Full', () => {
    // the phone's state doesn't reach the card: being slow never hides Cut
    expect(buttons(card(uncut))).toEqual(['Cut', 'Full'])
    expect(buttons(card(alreadyCut))).toEqual(['Cut', 'Full'])
  })

  it('keeps the whole picture placed for the cut, and says so on that layer', () => {
    // the layer placed whole when Cut was tapped, and a duplicate of it
    const items = [layer('a', 't1'), layer('b'), layer('c', 't1')]
    expect(notesOnCut(items, 't1', CUT_TOO_SLOW_TEXT)).toEqual([
      { id: 'a', label: 'Too slow to cut here — kept the full image' },
      { id: 'c', label: 'Too slow to cut here — kept the full image' },
    ])
    // it stops waiting on the cut, and stays the full image
    const kept = dropCut(items, 't1')
    expect(kept.map((i) => [i.id, i.src, i.cutting])).toEqual([
      ['a', 'full.jpg', undefined],
      ['b', 'full.jpg', undefined],
      ['c', 'full.jpg', undefined],
    ])
  })

  it('a cut that just went wrong is still a passing note', () => {
    expect(CUT_FAILED_TEXT).toBe('Couldn’t cut that one. Kept the full image.')
  })
})

describe('Cut that has a download to make first', () => {
  it('the card says so quietly, and Cut is described by it', () => {
    const html = card(uncut, { downloadNote: true })
    expect(html).toContain('<p id="')
    expect(html).toMatch(/class="result-note">Cut works after a short download<\/p>/)
    const id = html.match(/<p id="([^"]+)" class="result-note">/)?.[1]
    expect(html).toContain(`aria-describedby="${id}"`)
  })

  it('never on a card whose cut is already made, or a phone that cannot cut', () => {
    expect(card(alreadyCut, { downloadNote: true })).not.toContain('result-note')
    expect(card(uncut, { downloadNote: true, cutAvailable: false })).not.toContain('result-note')
    expect(card(uncut)).not.toContain('result-note')
  })
})
