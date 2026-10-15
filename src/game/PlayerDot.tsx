import type { CSSProperties } from 'react'
import type { Player } from '@smoosh/protocol'
import { useTheme } from '../themes/useTheme'
import { ShapeGlyph } from './PlayerChip'
import { initialOf, markFor, seatOf } from './playerMark'

// A player, small: their seat's coloured avatar with its shape badge, for
// rows and strips. `pending` is someone the room is still waiting on — a
// dashed outline, no colour yet.
//
// With no visible name beside it the dot is an image named for the player;
// pass `labelled` when their name follows it, and it stays out of the way.
export default function PlayerDot({
  player,
  players,
  pending = false,
  away = false,
  labelled = false,
  youId,
}: {
  player: Player
  players: readonly Player[]
  pending?: boolean
  away?: boolean
  labelled?: boolean
  // name your own dot "You" rather than your name
  youId?: string
}) {
  const theme = useTheme()
  const { shape, colour } = markFor(seatOf(players, player.id))
  const seat = theme.players[colour] ?? theme.players[0]
  const style = { '--p-bg': seat?.bg, '--p-fg': seat?.fg } as CSSProperties

  const name = player.id === youId ? 'You' : player.name
  const label = name + (away ? ', away' : pending ? ', not done yet' : '')
  const a11y = labelled ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label }

  return (
    <span className={`player-dot${pending ? ' pending' : ''}${away ? ' away' : ''}`} style={style} {...a11y}>
      {initialOf(player.name)}
      {!pending && (
        <span className="player-badge">
          <ShapeGlyph shape={shape} size={shape === 'star' ? 8 : 7} />
        </span>
      )}
    </span>
  )
}
