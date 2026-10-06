import { z } from 'zod'

// Guess mode's scoring — pure, so the server, the solo walkthrough and the
// tests all count the same way.
//
// Every player, every round: builds ONE picture, makes N−1 guesses (one per
// other picture) and writes N−1 lies (one per other picture), where N is
// the table size. Each picture has N−1 guessers; each lie can fool at most
// the N−2 guessers who aren't its picture's author or its own writer.
//
// The values are set so a round is worth the same at any table size — a
// ceiling of 4200, which divides evenly by every N−1 from 2 to 7:
//   correct guess           = 4200 / (N−1)        guesser, every guess right:  4200
//   author, per right guess = 4200 / (N−1)        author, every guesser right: 4200
//   successful lie          = 2100 / ((N−1)(N−2)) liar, every lie fooling
//                                                   everyone it can:          2100
// Building and guessing are worth the same; lying, half. Every value comes
// out whole. Tune a row by hand here — nothing else derives from it.
//
// If 50 a lie at eight players feels flat in play, raise the lie ceiling
// above 2100 rather than nudging single rows: small numbers read as small
// rewards whatever they add up to.
export const GUESS_POINTS = {
  3: { correctGuess: 2100, authorPerCorrectGuess: 2100, lie: 1050 },
  4: { correctGuess: 1400, authorPerCorrectGuess: 1400, lie: 350 },
  5: { correctGuess: 1050, authorPerCorrectGuess: 1050, lie: 175 },
  6: { correctGuess: 840, authorPerCorrectGuess: 840, lie: 105 },
  7: { correctGuess: 700, authorPerCorrectGuess: 700, lie: 70 },
  8: { correctGuess: 600, authorPerCorrectGuess: 600, lie: 50 },
} as const satisfies Record<number, { correctGuess: number; authorPerCorrectGuess: number; lie: number }>

export type GuessPoints = (typeof GUESS_POINTS)[keyof typeof GUESS_POINTS]

// the row for a table of `players` — a room that has shrunk below three
// mid-game plays on the three-player row
export function guessPointsFor(players: number): GuessPoints {
  const n = Math.min(8, Math.max(3, Math.round(players))) as keyof typeof GUESS_POINTS
  return GUESS_POINTS[n]
}

export const SCORE_REASONS = ['guessed_truth', 'picture_guessed', 'lie_picked'] as const
export type ScoreReason = (typeof SCORE_REASONS)[number]

export type ScoreDelta = { playerId: string; points: number; reason: ScoreReason }

export type ScorePictureInput = {
  // the table size this round is scored at
  players: number
  authorId: string
  truthOptionId: string
  lies: readonly { optionId: string; authorId: string }[]
  guesses: readonly { playerId: string; optionId: string }[]
}

// Only ever called for a picture that was shown — a placeholder (no
// picture) is never scored. A missing guess (timeout) has no entry in
// `guesses` and simply scores nothing.
export function scorePicture(input: ScorePictureInput): ScoreDelta[] {
  const values = guessPointsFor(input.players)
  const deltas: ScoreDelta[] = []
  const lieByOptionId = new Map(input.lies.map((lie) => [lie.optionId, lie.authorId]))

  for (const guess of input.guesses) {
    // never score off your own picture or your own lie
    if (guess.playerId === input.authorId) continue

    if (guess.optionId === input.truthOptionId) {
      deltas.push({ playerId: guess.playerId, points: values.correctGuess, reason: 'guessed_truth' })
      deltas.push({ playerId: input.authorId, points: values.authorPerCorrectGuess, reason: 'picture_guessed' })
      continue
    }

    const lieAuthorId = lieByOptionId.get(guess.optionId)
    if (lieAuthorId !== undefined && lieAuthorId !== guess.playerId) {
      deltas.push({ playerId: lieAuthorId, points: values.lie, reason: 'lie_picked' })
    }
  }

  return deltas
}

// ---------- where a player's points came from, for the scoreboard

export const PointsBreakdownSchema = z.object({
  picture: z.number().int().nonnegative(), // others guessing your picture
  guessing: z.number().int().nonnegative(), // your correct guesses
  lies: z.number().int().nonnegative(), // others falling for your lies
})
export type PointsBreakdown = z.infer<typeof PointsBreakdownSchema>

export const EMPTY_BREAKDOWN: PointsBreakdown = { picture: 0, guessing: 0, lies: 0 }

export function addToBreakdown(b: PointsBreakdown, d: ScoreDelta): PointsBreakdown {
  switch (d.reason) {
    case 'guessed_truth':
      return { ...b, guessing: b.guessing + d.points }
    case 'lie_picked':
      return { ...b, lies: b.lies + d.points }
    case 'picture_guessed':
      return { ...b, picture: b.picture + d.points }
  }
}

export function breakdownTotal(b: PointsBreakdown): number {
  return b.picture + b.guessing + b.lies
}
