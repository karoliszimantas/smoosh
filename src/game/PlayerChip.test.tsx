import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Player } from '@smoosh/protocol'
import PlayerChip from './PlayerChip'
import PlayerDot from './PlayerDot'

const players: Player[] = [
  { id: 'mara', name: 'Mara', isHost: true, presence: 'present', score: 0 },
  { id: 'teo', name: 'Teo', isHost: false, presence: 'away', score: 0 },
  { id: 'ilya', name: 'Ilya', isHost: false, presence: 'present', score: 0 },
]
const [mara, teo, ilya] = players as [Player, Player, Player]

// what a screen reader gets: the text, minus anything aria-hidden
function spoken(html: string): string {
  return html
    .replace(/<span[^>]*aria-hidden="true"[^>]*>.*?<\/svg><\/span><\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

describe('player chips', () => {
  it('names the player, then Host — and You for yourself, even as host', () => {
    expect(spoken(renderToStaticMarkup(<PlayerChip player={mara} players={players} youId="ilya" />))).toBe('Mara Host')
    const own = renderToStaticMarkup(<PlayerChip player={mara} players={players} youId="mara" />)
    expect(spoken(own)).toBe('Mara You')
    expect(own).toContain('class="player-chip you"')
    expect(spoken(renderToStaticMarkup(<PlayerChip player={ilya} players={players} youId="mara" />))).toBe('Ilya')
  })

  it('says Away in place of the other tags', () => {
    const html = renderToStaticMarkup(<PlayerChip player={teo} players={players} youId="teo" />)
    expect(spoken(html)).toBe('Teo Away')
    expect(html).toContain('class="player-chip you away"')
  })

  it('takes its colour and shape from the seat', () => {
    // seat 2: yellow, triangle
    const html = renderToStaticMarkup(<PlayerChip player={ilya} players={players} youId="mara" />)
    expect(html).toContain('<polygon points="5,0.8 9.4,9 0.6,9"')
    expect(html).toMatch(/--p-bg:#FFC93C/i)
  })
})

describe('player dots', () => {
  it('is an image named for the player, away or not done yet', () => {
    expect(renderToStaticMarkup(<PlayerDot player={mara} players={players} />)).toContain('role="img" aria-label="Mara"')
    expect(renderToStaticMarkup(<PlayerDot player={teo} players={players} away />)).toContain('aria-label="Teo, away"')
    const pending = renderToStaticMarkup(<PlayerDot player={ilya} players={players} pending />)
    expect(pending).toContain('aria-label="Ilya, not done yet"')
    expect(pending).not.toContain('<svg')
  })

  it('stays out of the way when the name is written beside it', () => {
    const html = renderToStaticMarkup(<PlayerDot player={mara} players={players} labelled />)
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('role="img"')
  })

  it('calls you You when asked to', () => {
    expect(renderToStaticMarkup(<PlayerDot player={ilya} players={players} youId="ilya" />)).toContain('aria-label="You"')
  })
})
