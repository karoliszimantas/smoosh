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

// How long a game typically takes, for the lobby's "about N min". One
// formula, so anything else that shows it can't drift from the lobby.
//
// It follows the server's phases (server/src/game/phaseMachine.ts), round
// by round, taking each at a typical length rather than its limit:
// - BUILD: each player's clock starts once they've read their prompt
//   (guess only; the window allows up to PROMPT_WINDOW_SEC), runs the full
//   build time — players use the time they're given — and the phase closes
//   once the last pictures, sent as the clocks run out, have landed (the
//   grace allows up to BUILD_GRACE_SEC). Players build at the same time,
//   so a round has one build, whatever the table's size.
// - Guess, per picture: everyone writes a lie, everyone guesses, the
//   reveal. Answer phases end as soon as the last player has answered —
//   usually well inside the limit — so they count at a typical time, capped
//   by the limit. A missing picture (a short placeholder) is rare: not
//   counted.
// - Gallery: one vote for the whole round, then the awards.
// - Chain: every pass, each chain's reveal, the vote, the awards.
// - Then the standings, between rounds only: the final ones wait for the host.
const TYPICAL_PROMPT_READ_SEC = 10
const TYPICAL_LANDING_SEC = 2
// the slowest at the table: a lie is typed on a phone, a guess is one tap
// among a few, a vote looks over every picture first
const TYPICAL_LIE_SEC = 45
const TYPICAL_GUESS_SEC = 20
const TYPICAL_VOTE_SEC = 40

export function estimateDurationSec(settings: GameSettings, playerCount: number): number {
  const answer = (typical: number) => Math.min(typical, settings.answerTimeSec)
  const build = settings.buildTimeSec + TYPICAL_LANDING_SEC
  let round: number
  if (settings.mode === 'chain') {
    round = chainRoundSec(settings, playerCount) + answer(TYPICAL_VOTE_SEC) + CHAIN_AWARDS_SEC
  } else if (settings.mode === 'gallery') {
    // prompted and freestyle run the same phases. The awards are a set show,
    // at most AWARDS_MAX_SEC, depending only on which prizes are given
    round = build + answer(TYPICAL_VOTE_SEC) + AWARDS_MAX_SEC
  } else {
    // one picture per player, each told in turn
    const picture = answer(TYPICAL_LIE_SEC) + answer(TYPICAL_GUESS_SEC) + REVEAL_PHASE_SEC
    round = TYPICAL_PROMPT_READ_SEC + build + playerCount * picture
  }
  return settings.rounds * round + (settings.rounds - 1) * SCORES_PHASE_SEC
}

// Chain: every pass (the first 30s longer) with its last pictures landing,
// then each chain's reveal
function chainRoundSec(settings: GameSettings, playerCount: number): number {
  const players = Array.from({ length: Math.max(3, playerCount) }, (_, i) => `p${i}`)
  const plan = planChains(players, settings.chainStructure)
  const building = plan.passCount * (settings.buildTimeSec + TYPICAL_LANDING_SEC) + FIRST_PASS_BONUS_SEC
  const revealMs = plan.chains.length * (CHAIN_INTRO_MS + plan.passCount * CHAIN_PASS_MS + CHAIN_PROMPT_MS + CHAIN_PLACARD_MS)
  return building + Math.ceil(revealMs / 1000)
}

// the building alone in one chain round — what the host sees beside the
// time setting
export function chainBuildingSec(settings: GameSettings, playerCount: number): number {
  const players = Array.from({ length: Math.max(3, playerCount) }, (_, i) => `p${i}`)
  return planChains(players, settings.chainStructure).passCount * settings.buildTimeSec + FIRST_PASS_BONUS_SEC
}
