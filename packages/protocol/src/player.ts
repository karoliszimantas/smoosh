import { z } from 'zod'
import { PlayerIdSchema } from './ids.ts'

// public player view — never carries sessionId, which is a secret reconnect
// credential. Leaking it (even to its own owner) would let a client replay
// it from devtools and hijack another seat.
export const PlayerSchema = z.object({
  id: PlayerIdSchema,
  name: z.string().min(1).max(12),
  isHost: z.boolean(),
  // present: here now. away: gone for now (closed tab, lost signal, phone
  // in a pocket) — the seat is held. left: chose to leave.
  presence: z.enum(['present', 'away', 'left']),
  score: z.number().int(),
})
export type Player = z.infer<typeof PlayerSchema>
export type Presence = Player['presence']
