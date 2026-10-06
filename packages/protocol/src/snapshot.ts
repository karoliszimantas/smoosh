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
    // this round's prompt during BUILD — secret in guess, shared in gallery,
    // "" in freestyle (the client shows a placeholder instead)
    secretPrompt: z.string().nullable(),
    hasActedThisPhase: z.boolean(),
    // during GUESS, the id of the option that is this player's own lie (if
    // they submitted one) — options otherwise omit authorId so the truth
    // can't be inferred before reveal, but the client still needs to grey
    // out "you can't pick your own lie" without waiting for reveal to know
    // which one that is
    ownOptionId: z.string().nullable(),
    // during gallery VOTE, this player's own votes — nobody else's are ever
    // sent: votes are anonymous, only counts are shown
    ownVote: z.object({ favourite: PlayerIdSchema, runnerUp: PlayerIdSchema.nullable() }).nullable(),
    // during BUILD, this player's own clock. `windowEndsAt` is set while
    // their prompt window is open (the clock hasn't started); `deadline` is
    // when their build ends — each player's is their own. `offered`: the
    // prompt a swap brought up, while they choose between the two
    // chain, during a pass: the chain this player adds to (null: none this
    // pass — one-picture chains, waiting their turn), its prompt (first pass
    // only — nobody after sees it), the earlier passes to show as ghosts,
    // and which pass is theirs next when waiting
    pass: z
      .object({
        chainId: z.string().nullable(),
        prompt: z.string().nullable(),
        underlay: z.array(z.string()),
        nextPass: z.number().int().nonnegative().nullable(),
      })
      .nullable(),
    // chain, during the vote: the chains this player may vote for, and their vote
    chainVote: z.object({ votable: z.array(z.string()), own: z.string().nullable() }).nullable(),
    build: z
      .object({
        windowEndsAt: z.number().nullable(),
        deadline: z.number(),
        swapsLeft: z.number().int().nonnegative(),
        canSwap: z.boolean(),
        offered: z.string().nullable(),
      })
      .nullable(),
  }),
  // who the current phase is still waiting on — in BUILD, whoever hasn't
  // sent a picture in yet, away players included
  waitingOn: z.array(PlayerIdSchema),
})
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>
