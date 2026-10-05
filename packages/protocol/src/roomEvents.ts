import { z } from 'zod'
import { PlayerIdSchema } from './ids.ts'

// things that happened in the room, as one-off notices — the snapshot
// carries the state, these carry the news
export const RoomEventSchema = z.discriminatedUnion('type', [
  // someone chose to leave
  z.object({ type: z.literal('left'), playerId: PlayerIdSchema, name: z.string() }),
  // the host role moved — the old host left, or has been gone a while
  z.object({ type: z.literal('hostChanged'), playerId: PlayerIdSchema, name: z.string() }),
  // to a returning player only: what went by while they were away
  z.object({
    type: z.literal('caughtUp'),
    roundsFinished: z.number().int().nonnegative(),
    picturesMissed: z.number().int().nonnegative(),
    pointsGained: z.number().int(),
    rank: z.number().int().positive(),
    playerCount: z.number().int().positive(),
  }),
  // to a socket only: the same player opened the game somewhere else, which
  // took over the seat
  z.object({ type: z.literal('replaced') }),
])
export type RoomEvent = z.infer<typeof RoomEventSchema>
