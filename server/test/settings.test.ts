import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SETTINGS,
  GameSettingsSchema,
  estimateDurationSec,
  promptsNeeded,
  settingsProblem,
  type GameSettings,
} from '@smoosh/protocol'

const settings = (patch: Partial<GameSettings>): GameSettings => ({ ...DEFAULT_SETTINGS, ...patch })

describe('game settings', () => {
  it('rejects freestyle in guess mode', () => {
    expect(settingsProblem(settings({ mode: 'guess', prompted: false }))).not.toBeNull()
  })

  it('accepts every other combination', () => {
    expect(settingsProblem(settings({ mode: 'guess', prompted: true }))).toBeNull()
    expect(settingsProblem(settings({ mode: 'gallery', prompted: true }))).toBeNull()
    expect(settingsProblem(settings({ mode: 'gallery', prompted: false }))).toBeNull()
  })

  it('requires mode and prompted on the wire', () => {
    expect(GameSettingsSchema.safeParse({ rounds: 5, buildTimeSec: 90 }).success).toBe(false)
    expect(GameSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, mode: 'bogus' }).success).toBe(false)
  })

  it('counts the prompts a game draws', () => {
    expect(promptsNeeded(settings({ mode: 'guess', rounds: 5 }), 4)).toBe(20)
    expect(promptsNeeded(settings({ mode: 'gallery', prompted: true, rounds: 5 }), 4)).toBe(5)
    expect(promptsNeeded(settings({ mode: 'gallery', prompted: false, rounds: 5 }), 4)).toBe(0)
  })

  // a default game (guess, 5 rounds, 90s builds, 120s to answer), as
  // typically played: 5 × (10 + 92 + n × (45 + 20 + 7 + 1.8 × (n − 1))) +
  // 4 × 6 seconds — each reveal runs longer the more fakes it has
  it.each([
    [3, 1668, 28],
    [5, 2514, 42],
    [8, 3918, 65],
  ])('estimates a default game for %i players at %is, about %i min', (players, sec, min) => {
    expect(estimateDurationSec(DEFAULT_SETTINGS, players)).toBeCloseTo(sec, 6)
    expect(Math.round(sec / 60)).toBe(min)
  })

  it('counts one build a round, however many build at once', () => {
    const at = (buildTimeSec: GameSettings['buildTimeSec'], players: number) =>
      estimateDurationSec(settings({ buildTimeSec }), players)
    expect(at(120, 8) - at(90, 8)).toBe(5 * 30)
    expect(at(120, 3) - at(90, 3)).toBe(5 * 30)
  })

  it('takes answers at a typical time, never past the limit', () => {
    // the typical answer is already inside every limit: a longer limit
    // changes nothing
    expect(estimateDurationSec(settings({ answerTimeSec: 300 }), 5)).toBe(estimateDurationSec(DEFAULT_SETTINGS, 5))
    for (const mode of ['guess', 'gallery', 'chain'] as const) {
      const s = settings({ mode, prompted: true })
      expect(estimateDurationSec(s, 5)).toBeGreaterThan(0)
      expect(estimateDurationSec(s, 8)).toBeGreaterThanOrEqual(estimateDurationSec(s, 3))
    }
  })

  it('estimates prompted and freestyle gallery the same', () => {
    const prompted = estimateDurationSec(settings({ mode: 'gallery', prompted: true }), 5)
    const freestyle = estimateDurationSec(settings({ mode: 'gallery', prompted: false }), 5)
    expect(prompted).toBe(freestyle)
  })
})
