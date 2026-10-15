import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SETTINGS,
  FIRST_PASS_BONUS_SEC,
  MISSING_PHASE_SEC,
  REVEAL_PHASE_SEC,
  SCORES_PHASE_SEC,
  type GameSettings,
  type PhaseState,
} from '@smoosh/protocol'
import { fuseFraction, phaseDurationSec } from './phaseDuration'

const settings: GameSettings = { ...DEFAULT_SETTINGS, buildTimeSec: 120, answerTimeSec: 180 }
const picture = { round: 1, totalRounds: 3, pictureIndex: 0, pictureCount: 3, authorId: 'a', imagePath: 'x', deadline: 0 }

describe('phaseDurationSec', () => {
  it('is the build time while building, longer on a chain’s first pass', () => {
    expect(phaseDurationSec({ phase: 'build', round: 1, totalRounds: 3, deadline: 0, collecting: false }, settings)).toBe(120)
    const pass = { phase: 'pass', round: 1, totalRounds: 3, passCount: 3, unit: 10, deadline: 0, collecting: false } as const
    expect(phaseDurationSec({ ...pass, pass: 0 }, settings)).toBe(120 + FIRST_PASS_BONUS_SEC)
    expect(phaseDurationSec({ ...pass, pass: 1 }, settings)).toBe(120)
  })

  it('is the answer time for lies, guesses and votes', () => {
    expect(phaseDurationSec({ ...picture, phase: 'lie' }, settings)).toBe(180)
    expect(phaseDurationSec({ ...picture, phase: 'guess', options: [] }, settings)).toBe(180)
    expect(
      phaseDurationSec({ phase: 'vote', round: 1, totalRounds: 3, prompt: '', pictures: [], deadline: 0 }, settings),
    ).toBe(180)
    expect(phaseDurationSec({ phase: 'chainVote', round: 1, totalRounds: 3, chains: [], deadline: 0 }, settings)).toBe(180)
  })

  it('is the fixed pause for reveal, a missing picture and the scores', () => {
    const reveal: PhaseState = { ...picture, phase: 'reveal', options: [], realOptionId: 'r', pointsThisPicture: [] }
    expect(phaseDurationSec(reveal, settings)).toBe(REVEAL_PHASE_SEC)
    const missing = { round: 1, totalRounds: 3, pictureIndex: 0, pictureCount: 3, authorId: 'a', deadline: 0 }
    expect(phaseDurationSec({ ...missing, phase: 'missing' }, settings)).toBe(MISSING_PHASE_SEC)
    const scores = { phase: 'scores' as const, round: 1, totalRounds: 3, isFinalRound: false, scoreboard: [], exhibition: [] }
    expect(phaseDurationSec({ ...scores, deadline: 6000 }, settings)).toBe(SCORES_PHASE_SEC)
  })

  it('is null with no clock', () => {
    expect(phaseDurationSec({ phase: 'lobby' }, settings)).toBeNull()
    const final = { phase: 'scores' as const, round: 3, totalRounds: 3, isFinalRound: true, scoreboard: [], exhibition: [] }
    expect(phaseDurationSec({ ...final, deadline: null }, settings)).toBeNull()
  })

  it('runs a timeline phase from its start to its deadline', () => {
    const reveal = { phase: 'chainReveal' as const, round: 1, totalRounds: 3, chains: [], skipped: false }
    expect(phaseDurationSec({ ...reveal, startsAt: 1000, deadline: 31_000 }, settings)).toBe(30)
  })
})

describe('fuseFraction', () => {
  it('is what is left of the phase, between 0 and 1', () => {
    expect(fuseFraction(47_000, 90)).toBeCloseTo(47 / 90)
    // a prompt window still open: more than the build time left, a full fuse
    expect(fuseFraction(150_000, 120)).toBe(1)
    expect(fuseFraction(0, 90)).toBe(0)
    expect(fuseFraction(-5, 90)).toBe(0)
    expect(fuseFraction(5000, null)).toBe(0)
  })
})
