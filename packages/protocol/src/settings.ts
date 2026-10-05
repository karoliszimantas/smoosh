import { z } from 'zod'

export const ROUND_OPTIONS = [3, 5, 10] as const
export const BUILD_TIME_OPTIONS = [60, 90, 120, 300] as const
// the time limit on every phase where players answer — writing a lie,
// guessing, rating. A phase still ends early once everyone has answered.
export const ANSWER_TIME_OPTIONS = [120, 180, 300] as const

// after the BUILD deadline the server keeps accepting uploads this long, so
// a picture auto-submitted at the deadline still makes it in (the phone has
// to export and upload it after its own timer runs out)
export const BUILD_GRACE_SEC = 5
export const REVEAL_PHASE_SEC = 8
// how long a missing picture's placeholder is shown
export const MISSING_PHASE_SEC = 4
// Gallery: everyone but the author rates each picture, then sees how it did
export const RATE_RESULT_PHASE_SEC = 6
export const SCORES_PHASE_SEC = 6

export const MAX_PLAYERS = 8
export const MIN_PLAYERS_TO_START = 3
export const DISPLAY_NAME_MAX_LEN = 12
export const LIE_TEXT_MAX_LEN = 80

// last N seconds of a countdown get progressively more urgent styling
export const TIMER_AMBER_THRESHOLD_SEC = 20
export const TIMER_RED_THRESHOLD_SEC = 10
export const TIMER_PULSE_THRESHOLD_SEC = 5

export const MIN_RATING = 1
export const MAX_RATING = 5
// a perfect average is worth the same as guessing the truth in Guess
export const POINTS_PER_RATING_STAR = 200

// guess:   everyone gets a secret prompt; the others invent fake prompts and
//          guess which is real
// gallery: everyone builds to the same prompt (or none — `prompted: false`,
//          "freestyle") and the others rate each picture 1-5
export const GAME_MODES = ['guess', 'gallery'] as const
export const GameModeSchema = z.enum(GAME_MODES)
export type GameMode = z.infer<typeof GameModeSchema>

export const GameSettingsSchema = z.object({
  rounds: z.union([z.literal(3), z.literal(5), z.literal(10)]),
  buildTimeSec: z.union([z.literal(60), z.literal(90), z.literal(120), z.literal(300)]),
  answerTimeSec: z.union([z.literal(120), z.literal(180), z.literal(300)]),
  mode: GameModeSchema,
  // only meaningful in gallery; guess always needs prompts (see
  // settingsProblem)
  prompted: z.boolean(),
})
export type GameSettings = z.infer<typeof GameSettingsSchema>

export const DEFAULT_SETTINGS: GameSettings = {
  rounds: 5,
  buildTimeSec: 90,
  answerTimeSec: 120,
  mode: 'guess',
  prompted: true,
}

// combinations the schema alone can't rule out — null when the settings are
// playable. Guess without prompts is meaningless: there'd be nothing secret
// to guess.
export function settingsProblem(settings: GameSettings): string | null {
  if (settings.mode === 'guess' && !settings.prompted) return 'Guess needs prompts — freestyle is a Gallery option'
  return null
}

// prompts a game will draw from the pool: a secret one per player per round
// in guess, one shared per round in prompted gallery, none in freestyle
export function promptsNeeded(settings: GameSettings, playerCount: number): number {
  if (settings.mode === 'guess') return settings.rounds * playerCount
  return settings.prompted ? settings.rounds : 0
}

// one formula shared by the host's live estimate and any server echo, so
// they can never drift apart
export function estimateDurationSec(settings: GameSettings, playerCount: number): number {
  // answer phases usually end early once everyone has answered, so this is
  // the worst case
  const answer = settings.answerTimeSec
  if (settings.mode === 'gallery') {
    // prompted and freestyle run the same phases, so the same estimate
    return settings.rounds * (settings.buildTimeSec + playerCount * (answer + RATE_RESULT_PHASE_SEC))
  }
  return settings.rounds * playerCount * (settings.buildTimeSec + answer + answer + REVEAL_PHASE_SEC)
}
