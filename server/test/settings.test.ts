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

  it('estimates prompted and freestyle gallery the same', () => {
    const prompted = estimateDurationSec(settings({ mode: 'gallery', prompted: true }), 5)
    const freestyle = estimateDurationSec(settings({ mode: 'gallery', prompted: false }), 5)
    expect(prompted).toBe(freestyle)
  })
})
