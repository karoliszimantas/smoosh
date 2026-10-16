import type { CSSProperties } from 'react'
import type { Player } from '@smoosh/protocol'
import { useTheme } from '../themes/useTheme'
import { markOf } from './playerMark'

// a seat's colours as the inline custom properties (--p-bg, --p-fg) the
// avatar and the dot read
export function useSeatStyle(player: Player): CSSProperties {
  const theme = useTheme()
  const seat = theme.players[markOf(player).colour] ?? theme.players[0]
  return { '--p-bg': seat?.bg, '--p-fg': seat?.fg } as CSSProperties
}
