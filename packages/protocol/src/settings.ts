import { z } from 'zod'
import { AWARDS_MAX_SEC } from './gallery.ts'
import { CHAIN_AWARDS_SEC, CHAIN_INTRO_MS, CHAIN_PASS_MS, CHAIN_PLACARD_MS, CHAIN_PROMPT_MS, ChainStructureSchema, FIRST_PASS_BONUS_SEC, chainCount, planChains } from './chain.ts'

export const ROUND_OPTIONS = [3, 5, 10] as const
export const BUILD_TIME_OPTIONS = [60, 90, 120, 300] as const
// the time limit on every phase where players answer — writing a lie,
// guessing, voting. A phase still ends early once everyone has answered.
export const ANSWER_TIME_OPTIONS = [120, 180, 300] as const

// after the BUILD deadline the server keeps accepting uploads this long, so
// a picture auto-submitted at the deadline still makes it in (the phone has
// to export and upload it after its own timer runs out)
export const BUILD_GRACE_SEC = 5
export const REVEAL_PHASE_SEC = 8
// how long a missing picture's placeholder is shown
export const MISSING_PHASE_SEC = 4
export const SCORES_PHASE_SEC = 6

export const MAX_PLAYERS = 8
export const MIN_PLAYERS_TO_START = 3
export const DISPLAY_NAME_MAX_LEN = 12
export const LIE_TEXT_MAX_LEN = 80

// last N seconds of a countdown get progressively more urgent styling
export const TIMER_AMBER_THRESHOLD_SEC = 20
export const TIMER_RED_THRESHOLD_SEC = 10
export const TIMER_PULSE_THRESHOLD_SEC = 5

// guess:   everyone gets a secret prompt; the others invent fake prompts and
//          guess which is real
// gallery: everyone builds to the same prompt (or none — `prompted: false`,
//          "freestyle"), then everyone votes for a favourite and a
//          runner-up among the others' pictures (see gallery.ts)
// chain:   exquisite corpse — pictures pass between players, each adding
//          two layers to what they can only half see (see chain.ts)
export const GAME_MODES = ['guess', 'gallery', 'chain'] as const
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
  // Players may add photos from their own phones. A photo never leaves the
  // phone that took it — it's cut there and reaches the others only as
  // pixels in a finished picture — so the room deciding is the whole of the
  // moderation story: proportionate for people who know each other.
  // Opening this beyond a private room needs reporting, blocking and a way
  // to end a room (DSA), none of which exist yet. Absent from an older
  // client's settings: on.
  allowPhotos: z.boolean().default(true),
  // chain only: how the room is split into chains (see chain.ts). In chain
  // mode buildTimeSec is the time per pass
  chainStructure: ChainStructureSchema.default('rotate'),
})
export type GameSettings = z.infer<typeof GameSettingsSchema>

export const DEFAULT_SETTINGS: GameSettings = {
  rounds: 5,
  buildTimeSec: 90,
  answerTimeSec: 120,
  mode: 'guess',
  prompted: true,
  allowPhotos: true,
  chainStructure: 'rotate',
}

// combinations the schema alone can't rule out — null when the settings are
// playable. Guess without prompts is meaningless: there'd be nothing secret
// to guess.
export function settingsProblem(settings: GameSettings): string | null {
  if (settings.mode === 'guess' && !settings.prompted) return 'Guess needs prompts — freestyle is a Gallery option'
  if (settings.mode === 'chain' && !settings.prompted) return 'Chain needs prompts — the first player builds to one'
  if (settings.mode === 'chain' && settings.buildTimeSec > 120) return 'A pass is 60, 90 or 120 seconds'
  return null
}

// prompts a game will draw from the pool: a secret one per player per round
// in guess, one shared per round in prompted gallery, none in freestyle
export function promptsNeeded(settings: GameSettings, playerCount: number): number {
  if (settings.mode === 'guess') return settings.rounds * playerCount
  if (settings.mode === 'chain') return settings.rounds * chainCount(playerCount, settings.chainStructure)
  return settings.prompted ? settings.rounds : 0
}

// one formula shared by the host's live estimate and any server echo, so
// they can never drift apart
export function estimateDurationSec(settings: GameSettings, playerCount: number): number {
  // answer phases usually end early once everyone has answered, so this is
  // the worst case
  const answer = settings.answerTimeSec
  if (settings.mode === 'chain') return settings.rounds * chainRoundSec(settings, playerCount, answer)
  if (settings.mode === 'gallery') {
    // prompted and freestyle run the same phases, so the same estimate: one
    // vote for the whole round, then the awards
    return settings.rounds * (settings.buildTimeSec + answer + AWARDS_MAX_SEC)
  }
  return settings.rounds * playerCount * (settings.buildTimeSec + answer + answer + REVEAL_PHASE_SEC)
}

// Chain: every pass (the first 30s longer) and its grace, then each chain's
// reveal, the vote and the awards
function chainRoundSec(settings: GameSettings, playerCount: number, answer: number): number {
  const players = Array.from({ length: Math.max(3, playerCount) }, (_, i) => `p${i}`)
  const plan = planChains(players, settings.chainStructure)
  const building = plan.passCount * (settings.buildTimeSec + BUILD_GRACE_SEC) + FIRST_PASS_BONUS_SEC
  const revealMs = plan.chains.length * (CHAIN_INTRO_MS + plan.passCount * CHAIN_PASS_MS + CHAIN_PROMPT_MS + CHAIN_PLACARD_MS)
  return building + Math.ceil(revealMs / 1000) + answer + CHAIN_AWARDS_SEC
}

// the building alone in one chain round — what the host sees beside the
// time setting
export function chainBuildingSec(settings: GameSettings, playerCount: number): number {
  const players = Array.from({ length: Math.max(3, playerCount) }, (_, i) => `p${i}`)
  return planChains(players, settings.chainStructure).passCount * settings.buildTimeSec + FIRST_PASS_BONUS_SEC
}
