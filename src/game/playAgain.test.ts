import { describe, it, expect } from 'vitest'
import type { GameConnection } from './useGameConnection'
import { playAgain, takeSettingsRequest } from './playAgain'

// a socket stand-in: records what was sent and answers each event as told
function fakeEmit(answer: { ok: true; data: undefined } | { ok: false; code: string } = { ok: true, data: undefined }) {
  const sent: string[] = []
  const emit = ((event: string) => {
    sent.push(event)
    return Promise.resolve(answer)
  }) as unknown as GameConnection['emit']
  return { emit, sent }
}

describe('play again', () => {
  it('takes everyone back to the lobby, and nothing more', async () => {
    const { emit, sent } = fakeEmit()
    await playAgain(emit)
    expect(sent).toEqual(['room:playAgain'])
    expect(takeSettingsRequest()).toBe(false)
  })

  it('Change settings goes the same way, then asks the lobby to open on the settings — once', async () => {
    const { emit, sent } = fakeEmit()
    await playAgain(emit, { changeSettings: true })
    expect(sent).toEqual(['room:playAgain'])
    expect(takeSettingsRequest()).toBe(true)
    expect(takeSettingsRequest()).toBe(false)
  })

  it('asks the lobby before the answer, since the lobby can arrive first', async () => {
    let seenInFlight: boolean | null = null
    const emit = (() => {
      seenInFlight = takeSettingsRequest()
      return Promise.resolve({ ok: true, data: undefined })
    }) as unknown as GameConnection['emit']
    await playAgain(emit, { changeSettings: true })
    expect(seenInFlight).toBe(true)
  })

  it('forgets the settings request when the server says no', async () => {
    const { emit } = fakeEmit({ ok: false, code: 'NOT_HOST' })
    const res = await playAgain(emit, { changeSettings: true })
    expect(res.ok).toBe(false)
    expect(takeSettingsRequest()).toBe(false)
  })
})
