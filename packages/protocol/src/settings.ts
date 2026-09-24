import { z } from 'zod'

export const ROUND_OPTIONS = [3, 5, 10] as const
export const BUILD_TIME_OPTIONS = [60, 90, 120, 300] as const

export const LIE_PHASE_SEC = 25
export const GUESS_PHASE_SEC = 20
export const REVEAL_PHASE_SEC = 8
export const SCORES_PHASE_SEC = 6

export const MAX_PLAYERS = 4
export const MIN_PLAYERS_TO_START = 3
export const DISPLAY_NAME_MAX_LEN = 12
export const LIE_TEXT_MAX_LEN = 80

// last N seconds of a countdown get progressively more urgent styling
export const TIMER_AMBER_THRESHOLD_SEC = 20
export const TIMER_RED_THRESHOLD_SEC = 10
export const TIMER_PULSE_THRESHOLD_SEC = 5

export const GameSettingsSchema = z.object({
  rounds: z.union([z.literal(3), z.literal(5), z.literal(10)]),
  buildTimeSec: z.union([z.literal(60), z.literal(90), z.literal(120), z.literal(300)]),
})
export type GameSettings = z.infer<typeof GameSettingsSchema>

export const DEFAULT_SETTINGS: GameSettings = { rounds: 5, buildTimeSec: 90 }

// one formula shared by the host's live estimate and any server echo, so
// they can never drift apart
export function estimateDurationSec(settings: GameSettings, playerCount: number): number {
  return settings.rounds * playerCount * (settings.buildTimeSec + LIE_PHASE_SEC + GUESS_PHASE_SEC + REVEAL_PHASE_SEC)
}
