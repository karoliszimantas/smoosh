import {
  CHAIN_AWARDS_SEC,
  MISSING_PHASE_SEC,
  REVEAL_PHASE_SEC,
  SCORES_PHASE_SEC,
  passSeconds,
  type GameSettings,
  type PhaseState,
} from '@smoosh/protocol'

// How long a phase's clock runs from full, in seconds: what the timer tag's
// fuse is a fraction of. The client only ever gets a deadline, never a
// start, so this is the phase's length as the server sets it. Null: no
// clock (the lobby, the final scores).
export function phaseDurationSec(phase: PhaseState, settings: GameSettings): number | null {
  switch (phase.phase) {
    case 'lobby':
      return null
    // a player's own build clock starts when their prompt window closes and
    // runs buildTimeSec; until then the fuse is full
    case 'build':
      return settings.buildTimeSec
    case 'pass':
      return passSeconds(phase.pass, settings.buildTimeSec)
    case 'lie':
    case 'guess':
    case 'vote':
    case 'chainVote':
      return settings.answerTimeSec
    case 'reveal':
      return REVEAL_PHASE_SEC
    case 'missing':
      return MISSING_PHASE_SEC
    case 'scores':
      return phase.deadline === null ? null : SCORES_PHASE_SEC
    case 'chainAwards':
      return CHAIN_AWARDS_SEC
    // played on a timeline from startsAt
    case 'awards':
    case 'chainReveal':
      return Math.max(0, (phase.deadline - phase.startsAt) / 1000)
  }
}

// what's left of the fuse, 0 (spent) to 1 (full)
export function fuseFraction(remainingMs: number, durationSec: number | null): number {
  if (durationSec === null || durationSec <= 0) return 0
  return Math.min(1, Math.max(0, remainingMs / (durationSec * 1000)))
}
