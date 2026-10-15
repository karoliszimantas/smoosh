import { describe, it, expect } from 'vitest'
import { createClockOffset } from './serverClock'

describe('server clock offset', () => {
  it('is 0 before any snapshot', () => {
    expect(createClockOffset().offset()).toBe(0)
  })

  it('keeps the sample that waited least on the way', () => {
    // the phone runs 3s behind the server; trips take 40–400ms
    const clock = createClockOffset()
    const trueOffset = 3_000
    for (const [sentAt, latency] of [
      [1_000, 400],
      [2_000, 40],
      [3_000, 250],
    ] as const) {
      clock.sample(sentAt + trueOffset, sentAt + latency)
    }
    expect(clock.offset()).toBe(trueOffset - 40)
  })

  it('works for a phone that runs ahead too', () => {
    const clock = createClockOffset()
    clock.sample(10_000, 15_100) // 5s ahead, 100ms trip
    clock.sample(11_000, 16_020) // 20ms trip
    expect(clock.offset()).toBe(-5_020)
  })

  it('forgets samples older than the window', () => {
    const clock = createClockOffset(3)
    clock.sample(10_000, 0) // the phone's clock was then corrected
    for (let i = 0; i < 3; i++) clock.sample(1_000 + i, i)
    expect(clock.offset()).toBe(1_000)
  })

  it('ignores a missing server time', () => {
    const clock = createClockOffset()
    clock.sample(500, 0)
    clock.sample(Number.NaN, 0)
    expect(clock.offset()).toBe(500)
  })
})
