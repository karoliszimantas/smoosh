import type { CSSProperties } from 'react'
import type { Player } from '@smoosh/protocol'
import { useTheme } from '../themes/useTheme'
import { initialOf, markOf, type Shape } from './playerMark'

// a seat's shape, drawn in a 10×10 box and filled with the current colour.
// `size` is the drawn size in px: 9 on a chip's badge, 7 on a dot's (the
// star 8 there — it's the spikiest, and reads small at 7)
export function ShapeGlyph({ shape, size }: { shape: Shape; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" focusable="false">
      {shape === 'square' && <rect x="1" y="1" width="8" height="8" />}
      {shape === 'circle' && <circle cx="5" cy="5" r="4.2" />}
      {shape === 'triangle' && <polygon points="5,0.8 9.4,9 0.6,9" />}
      {shape === 'star' && <polygon points="5,0.5 6.2,3.6 9.5,3.8 7,5.9 7.8,9.2 5,7.4 2.2,9.2 3,5.9 0.5,3.8 3.8,3.6" />}
      {shape === 'diamond' && <polygon points="5,0.6 9.4,5 5,9.4 0.6,5" />}
      {shape === 'pentagon' && <polygon points="5,0.6 9.4,3.8 7.7,9.2 2.3,9.2 0.6,3.8" />}
      {shape === 'cross' && <path d="M3.6 0.8h2.8v2.8h2.8v2.8H6.4v2.8H3.6V6.4H0.8V3.6h2.8z" />}
      {shape === 'sparkle' && <polygon points="5,0.4 6.3,3.7 9.6,5 6.3,6.3 5,9.6 3.7,6.3 0.4,5 3.7,3.7" />}
    </svg>
  )
}

// A player, as a paper pill: their seat's coloured avatar with its shape
// badge, their name, and a tag — You, Host, or Away. Away matters most in a
// lobby, so it replaces the other two; a host who is you is You.
export default function PlayerChip({
  player,
  youId,
  onPaper = false,
}: {
  player: Player
  youId: string
  // sitting on a paper card rather than the desk: the You ring is drawn in ink
  onPaper?: boolean
}) {
  const theme = useTheme()
  const { shape, colour } = markOf(player)
  const seat = theme.players[colour] ?? theme.players[0]
  const style = { '--p-bg': seat?.bg, '--p-fg': seat?.fg } as CSSProperties

  const you = player.id === youId
  const away = player.presence === 'away'
  const tag = away ? 'Away' : you ? 'You' : player.isHost ? 'Host' : null
  const className = `player-chip${you ? ' you' : ''}${away ? ' away' : ''}${onPaper ? ' on-paper' : ''}`

  return (
    <span className={className} style={style}>
      <span className="player-avatar" aria-hidden="true">
        {initialOf(player.name)}
        <span className="player-badge">
          <ShapeGlyph shape={shape} size={9} />
        </span>
      </span>
      <span className="player-name">{player.name}</span>
      {/* a space, so a screen reader hears "Mara Host", not "MaraHost" */}
      {tag && (
        <>
          {' '}
          <span className="player-tag">{tag}</span>
        </>
      )}
    </span>
  )
}
