import type { RoomSnapshot } from '@smoosh/protocol'
import type { GameConnection } from './useGameConnection'

export type PhaseProps = {
  snapshot: RoomSnapshot
  emit: GameConnection['emit']
}
