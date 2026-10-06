import { z } from 'zod'
import { PlayerIdSchema } from './ids.ts'
import { AwardSchema } from './gallery.ts'
import { PointsBreakdownSchema } from './guessScoring.ts'

const GuessOptionSchema = z.object({ id: z.string(), text: z.string() })

const RevealOptionSchema = GuessOptionSchema.extend({
  isTruth: z.boolean(),
  authorId: PlayerIdSchema.nullable(), // null for the truth option
  pickedBy: z.array(PlayerIdSchema),
})

const PictureContextSchema = z.object({
  round: z.number().int().positive(),
  totalRounds: z.number().int().positive(),
  pictureIndex: z.number().int().nonnegative(),
  pictureCount: z.number().int().positive(),
  authorId: PlayerIdSchema,
  imagePath: z.string(),
})

// a finished chain: its passes in order (each just that pass's layers, on
// a transparent ground), who made each, and the prompt it started from
const ChainShownSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  passes: z.array(z.object({ authorId: PlayerIdSchema, imagePath: z.string() })),
})

const ScoreboardEntrySchema = z.object({
  playerId: PlayerIdSchema,
  total: z.number().int(),
  // guess: where the points came from — this round, and the whole game so
  // far (each sums to what it's beside). Null in gallery.
  round: PointsBreakdownSchema.nullable(),
  game: PointsBreakdownSchema.nullable(),
})

export const PhaseStateSchema = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('lobby') }),

  z.object({
    phase: z.literal('build'),
    round: z.number().int().positive(),
    totalRounds: z.number().int().positive(),
    // when the phase closes: the latest of every player's own deadline (see
    // the snapshot's you.build — that's the one a player's clock shows)
    deadline: z.number(),
    // the deadline has passed and the server is waiting a few seconds for
    // the last uploads — a client that hasn't submitted should do so now
    collecting: z.boolean(),
  }),

  PictureContextSchema.extend({
    phase: z.literal('lie'),
    deadline: z.number(),
  }),

  PictureContextSchema.extend({
    phase: z.literal('guess'),
    options: z.array(GuessOptionSchema),
    deadline: z.number(),
  }),

  PictureContextSchema.extend({
    phase: z.literal('reveal'),
    options: z.array(RevealOptionSchema),
    realOptionId: z.string(),
    pointsThisPicture: z.array(z.object({ playerId: PlayerIdSchema, points: z.number().int() })),
    deadline: z.number(),
  }),

  // gallery: the whole round's pictures at once; everyone picks a favourite
  // and a runner-up among the others'. `prompt` is the shared one everybody
  // built to — empty in freestyle. A null imagePath is a picture that never
  // arrived: shown, so nobody is skipped silently, but not votable.
  z.object({
    phase: z.literal('vote'),
    round: z.number().int().positive(),
    totalRounds: z.number().int().positive(),
    prompt: z.string(),
    pictures: z.array(z.object({ authorId: PlayerIdSchema, imagePath: z.string().nullable() })),
    deadline: z.number(),
  }),

  // gallery: the verdict — counts only, never who voted for what. The
  // announcements play from `startsAt` on a fixed timeline (awardsTimeline);
  // `skipped` means the host cut to the full wall.
  z.object({
    phase: z.literal('awards'),
    round: z.number().int().positive(),
    totalRounds: z.number().int().positive(),
    prompt: z.string(),
    pictures: z.array(
      z.object({
        authorId: PlayerIdSchema,
        imagePath: z.string(),
        favourites: z.number().int().nonnegative(),
        runnerUps: z.number().int().nonnegative(),
        points: z.number().int().nonnegative(),
        award: AwardSchema.nullable(),
      }),
    ),
    announcements: z.array(AwardSchema),
    startsAt: z.number(),
    skipped: z.boolean(),
    deadline: z.number(),
  }),

  // chain: one pass — everyone with a chain this pass adds to it (each
  // player's chain is in their snapshot). `unit` names this pass's uploads.
  z.object({
    phase: z.literal('pass'),
    round: z.number().int().positive(),
    totalRounds: z.number().int().positive(),
    pass: z.number().int().nonnegative(),
    passCount: z.number().int().positive(),
    unit: z.number().int().positive(),
    deadline: z.number(),
    collecting: z.boolean(),
  }),

  // chain: each finished chain in turn — ghosts resolving pass by pass, its
  // prompt last, then its artists. Chains only one person added to are left
  // out. Played from `startsAt` on chainRevealTimeline; `skipped`: the host
  // cut straight to the vote.
  z.object({
    phase: z.literal('chainReveal'),
    round: z.number().int().positive(),
    totalRounds: z.number().int().positive(),
    chains: z.array(ChainShownSchema),
    startsAt: z.number(),
    skipped: z.boolean(),
    deadline: z.number(),
  }),

  // chain: everyone picks one favourite chain — never one they added to
  // (which ones those are is in each player's snapshot)
  z.object({
    phase: z.literal('chainVote'),
    round: z.number().int().positive(),
    totalRounds: z.number().int().positive(),
    chains: z.array(z.object({ id: z.string(), passes: z.array(z.string()) })),
    deadline: z.number(),
  }),

  // chain: the verdict — vote counts only, Best in Show to a chain, its
  // points shared by its artists
  z.object({
    phase: z.literal('chainAwards'),
    round: z.number().int().positive(),
    totalRounds: z.number().int().positive(),
    chains: z.array(
      ChainShownSchema.extend({
        votes: z.number().int().nonnegative(),
        best: z.boolean(),
        pointsEach: z.number().int().nonnegative(),
      }),
    ),
    deadline: z.number(),
  }),

  // a player's slot in the picture order whose picture never arrived — shown
  // to everyone, so a missing picture is visible rather than silently skipped
  PictureContextSchema.omit({ imagePath: true }).extend({
    phase: z.literal('missing'),
    deadline: z.number(),
  }),

  z.object({
    phase: z.literal('scores'),
    round: z.number().int().positive(),
    totalRounds: z.number().int().positive(),
    isFinalRound: z.boolean(),
    scoreboard: z.array(ScoreboardEntrySchema),
    // gallery: every round's Best in Show so far, in round order (ties: each
    // of them) — the final scores hang these as an exhibition. Empty in guess.
    exhibition: z.array(
      z.object({ round: z.number().int().positive(), prompt: z.string(), authorId: PlayerIdSchema, imagePath: z.string() }),
    ),
    deadline: z.number().nullable(),
  }),
])
export type PhaseState = z.infer<typeof PhaseStateSchema>

export type GuessOption = z.infer<typeof GuessOptionSchema>
export type RevealOption = z.infer<typeof RevealOptionSchema>
