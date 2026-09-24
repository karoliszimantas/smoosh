import { z } from 'zod'
import { PlayerIdSchema } from './ids.ts'

// public player view — never carries sessionId, which is a secret reconnect
// credential. Leaking it (even to its own owner) would let a client replay
// it from devtools and hijack another seat.
export const PlayerSchema = z.object({
  id: PlayerIdSchema,
  name: z.string().min(1).max(12),
  isHost: z.boolean(),
  connected: z.boolean(),
  score: z.number().int(),
})
export type Player = z.infer<typeof PlayerSchema>
