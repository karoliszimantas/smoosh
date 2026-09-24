import { z } from 'zod'
import { PlayerSchema } from './player.ts'
import { PhaseStateSchema } from './phase.ts'
import { GameSettingsSchema } from './settings.ts'
import { RoomCodeSchema, PlayerIdSchema } from './ids.ts'

// the only state-propagation event. Personalized per recipient (the `you`
// block differs per socket), so it is always sent to one socket at a time —
// never broadcast verbatim to a whole room.
export const RoomSnapshotSchema = z.object({
  roomCode: RoomCodeSchema,
  settings: GameSettingsSchema,
  players: z.array(PlayerSchema),
  phase: PhaseStateSchema,
  you: z.object({
    playerId: PlayerIdSchema,
    isHost: z.boolean(),
    secretPrompt: z.string().nullable(),
    hasActedThisPhase: z.boolean(),
    // during GUESS, the id of the option that is this player's own lie (if
    // they submitted one) — options otherwise omit authorId so the truth
    // can't be inferred before reveal, but the client still needs to grey
    // out "you can't pick your own lie" without waiting for reveal to know
    // which one that is
    ownOptionId: z.string().nullable(),
  }),
})
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>
