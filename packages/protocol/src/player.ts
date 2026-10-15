import { z } from 'zod'
import { PlayerIdSchema } from './ids.ts'

// how many seat marks (colour + shape pairs) there are: a seat number's mark
// is seat % MARK_COUNT. The same as MAX_PLAYERS, so a full room never has to
// share one
export const MARK_COUNT = 8

// public player view — never carries sessionId, which is a secret reconnect
// credential. Leaking it (even to its own owner) would let a client replay
// it from devtools and hijack another seat.
export const PlayerSchema = z.object({
  id: PlayerIdSchema,
  // stable for the room's lifetime, never reused: picks the colour and shape
  seat: z.number().int().nonnegative(),
  name: z.string().min(1).max(12),
  isHost: z.boolean(),
  // present: here now. away: gone for now (closed tab, lost signal, phone
  // in a pocket) — the seat is held. left: chose to leave.
  presence: z.enum(['present', 'away', 'left']),
  score: z.number().int(),
})
export type Player = z.infer<typeof PlayerSchema>
export type Presence = Player['presence']
