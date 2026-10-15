import type { CSSProperties } from 'react'
import type { Player } from '@smoosh/protocol'
import { useTheme } from '../themes/useTheme'
import { ShapeGlyph } from './PlayerChip'
import { initialOf, markOf } from './playerMark'

// A player, small: their seat's coloured avatar with its shape badge, for
// rows and strips. `pending` is someone the room is still waiting on — a
// dashed outline, no colour yet; `done`, someone who has answered — a check
// on the badge in place of the shape.
//
// With no visible name beside it the dot is an image named for the player;
// pass `labelled` when their name follows it, and it stays out of the way.
export default function PlayerDot({
  player,
  pending = false,
  done = false,
  away = false,
  labelled = false,
  youId,
}: {
  player: Player
  pending?: boolean
  done?: boolean
  away?: boolean
  labelled?: boolean
  // name your own dot "You" rather than your name
  youId?: string
}) {
  const theme = useTheme()
  const { shape, colour } = markOf(player)
  const seat = theme.players[colour] ?? theme.players[0]
  const style = { '--p-bg': seat?.bg, '--p-fg': seat?.fg } as CSSProperties

  const name = player.id === youId ? 'You' : player.name
  const label = name + (away ? ', away' : pending ? ', not done yet' : done ? ', done' : '')
  const a11y = labelled ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label }

  return (
    <span className={`player-dot${pending ? ' pending' : ''}${away ? ' away' : ''}`} style={style} {...a11y}>
      {initialOf(player.name)}
      {!pending && (
        <span className="player-badge">
          {done ? (
            <svg width={8} height={8} viewBox="0 0 10 10" aria-hidden="true" focusable="false">
              <path d="M1.6 5.4 4 7.8 8.6 2.4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <ShapeGlyph shape={shape} size={shape === 'star' ? 8 : 7} />
          )}
        </span>
      )}
    </span>
  )
}
