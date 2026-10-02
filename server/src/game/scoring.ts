import { POINTS_PER_RATING_STAR } from '@smoosh/protocol'

export type ScoreReason = 'guessed_truth' | 'lie_picked' | 'picture_guessed'

export type ScoreDelta = {
  playerId: string
  points: number
  reason: ScoreReason
}

export type ScorePictureInput = {
  authorId: string
  truthOptionId: string
  lies: readonly { optionId: string; authorId: string }[]
  guesses: readonly { playerId: string; optionId: string }[]
}

const GUESS_TRUTH_POINTS = 1000
const LIE_PICKED_POINTS = 500
const PICTURE_GUESSED_POINTS = 1000

// pure — no Room/Socket.io coupling, directly unit-testable. A missing guess
// (timeout) simply has no entry in `guesses`, so it produces no delta and
// needs no special-casing here.
export function scorePicture(input: ScorePictureInput): ScoreDelta[] {
  const deltas: ScoreDelta[] = []
  const lieByOptionId = new Map(input.lies.map((lie) => [lie.optionId, lie.authorId]))

  for (const guess of input.guesses) {
    // defensive: the author never has a guess recorded for their own
    // picture, but ignore it outright if one somehow arrives
    if (guess.playerId === input.authorId) continue

    if (guess.optionId === input.truthOptionId) {
      deltas.push({ playerId: guess.playerId, points: GUESS_TRUTH_POINTS, reason: 'guessed_truth' })
      deltas.push({ playerId: input.authorId, points: PICTURE_GUESSED_POINTS, reason: 'picture_guessed' })
      continue
    }

    const lieAuthorId = lieByOptionId.get(guess.optionId)
    if (lieAuthorId !== undefined) {
      deltas.push({ playerId: lieAuthorId, points: LIE_PICKED_POINTS, reason: 'lie_picked' })
    }
  }

  return deltas
}

export type RatingSummary = {
  // null when nobody rated
  average: number | null
  // how many raters gave 1..5 stars (index 0 = one star)
  counts: [number, number, number, number, number]
  // what the author earns
  points: number
}

// Gallery: the author earns the average rating, scaled. The average, not the
// sum — a rater who timed out mustn't cost the author points, and a picture
// rated by fewer people (someone disconnected) isn't penalised.
export function scoreRatings(stars: readonly number[]): RatingSummary {
  const counts: RatingSummary['counts'] = [0, 0, 0, 0, 0]
  for (const s of stars) {
    const i = s - 1
    if (i >= 0 && i < 5) counts[i as 0 | 1 | 2 | 3 | 4] += 1
  }
  const valid = stars.filter((s) => s >= 1 && s <= 5)
  if (valid.length === 0) return { average: null, counts, points: 0 }
  const average = valid.reduce((a, b) => a + b, 0) / valid.length
  return { average, counts, points: Math.round(average * POINTS_PER_RATING_STAR) }
}
