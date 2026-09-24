import { z } from 'zod'
import { PlayerIdSchema } from './ids.ts'

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

const ScoreboardEntrySchema = z.object({ playerId: PlayerIdSchema, total: z.number().int() })

export const PhaseStateSchema = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('lobby') }),

  z.object({
    phase: z.literal('build'),
    round: z.number().int().positive(),
    totalRounds: z.number().int().positive(),
    deadline: z.number(),
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

  z.object({
    phase: z.literal('scores'),
    round: z.number().int().positive(),
    totalRounds: z.number().int().positive(),
    isFinalRound: z.boolean(),
    scoreboard: z.array(ScoreboardEntrySchema),
    deadline: z.number().nullable(),
  }),
])
export type PhaseState = z.infer<typeof PhaseStateSchema>

export type GuessOption = z.infer<typeof GuessOptionSchema>
export type RevealOption = z.infer<typeof RevealOptionSchema>
