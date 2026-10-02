import { z } from 'zod'

export const ROUND_OPTIONS = [3, 5, 10] as const
export const BUILD_TIME_OPTIONS = [60, 90, 120, 300] as const

export const LIE_PHASE_SEC = 25
export const GUESS_PHASE_SEC = 20
export const REVEAL_PHASE_SEC = 8
// Gallery: everyone but the author rates each picture, then sees how it did
export const RATE_PHASE_SEC = 15
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
  mode: GameModeSchema,
  // only meaningful in gallery; guess always needs prompts (see
  // settingsProblem)
  prompted: z.boolean(),
})
export type GameSettings = z.infer<typeof GameSettingsSchema>

export const DEFAULT_SETTINGS: GameSettings = { rounds: 5, buildTimeSec: 90, mode: 'guess', prompted: true }

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
  if (settings.mode === 'gallery') {
    // prompted and freestyle run the same phases, so the same estimate
    return settings.rounds * (settings.buildTimeSec + playerCount * (RATE_PHASE_SEC + RATE_RESULT_PHASE_SEC))
  }
  return settings.rounds * playerCount * (settings.buildTimeSec + LIE_PHASE_SEC + GUESS_PHASE_SEC + REVEAL_PHASE_SEC)
}
