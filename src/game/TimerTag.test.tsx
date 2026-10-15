import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TimerTag from './TimerTag'
import { announce, clockText, timeLeftText, type Announcer } from './timerText'

const NOW = 1_000_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the clock, in digits and in words', () => {
  it('reads m:ss', () => {
    expect(clockText(47)).toBe('0:47')
    expect(clockText(100)).toBe('1:40')
    expect(clockText(8)).toBe('0:08')
    expect(clockText(0)).toBe('0:00')
  })

  it('says how long is left', () => {
    expect(timeLeftText(47)).toBe('47 seconds left')
    expect(timeLeftText(100)).toBe('1 minute 40 seconds left')
    expect(timeLeftText(60)).toBe('1 minute left')
    expect(timeLeftText(1)).toBe('1 second left')
    expect(timeLeftText(0)).toBe('Time’s up')
  })
})

describe('announcements', () => {
  // the announcer fed once a tick by the clock, as the tag is
  function run(deadline: number, ms: number, from: Announcer | null = null) {
    let state = from
    const said: string[] = []
    const end = Date.now() + ms
    while (Date.now() < end) {
      vi.advanceTimersByTime(200)
      const next = announce(state, deadline, Math.ceil(Math.max(0, deadline - Date.now()) / 1000))
      if (next.said !== (state?.said ?? '') && next.said) said.push(next.said)
      state = next
    }
    return { said, state }
  }

  it('speaks at 1 minute, 30 and 10 seconds, and when time is up — once each', () => {
    const { said } = run(NOW + 75_000, 80_000)
    expect(said).toEqual(['1 minute left', '30 seconds left', '10 seconds left', 'Time’s up'])
  })

  it('says nothing on first sight, even with 8 seconds left', () => {
    expect(announce(null, NOW + 8000, 8).said).toBe('')
    // and from there only the next mark
    const { said } = run(NOW + 8000, 9000)
    expect(said).toEqual(['Time’s up'])
  })

  it('starts over, silently, for a new deadline', () => {
    const before = announce(announce(null, NOW + 61_000, 61), NOW + 61_000, 60)
    expect(before.said).toBe('1 minute left')
    expect(announce(before, NOW + 90_000, 59).said).toBe('')
  })

  it('says only the latest mark when the clock jumps past several', () => {
    const asleep = announce(null, NOW + 65_000, 65)
    expect(announce(asleep, NOW + 65_000, 5).said).toBe('10 seconds left')
  })
})

describe('the tag', () => {
  it('is a calm paper tag with the time, a timer named in words', () => {
    const html = renderToStaticMarkup(<TimerTag deadline={NOW + 47_000} durationSec={90} />)
    expect(html).toContain('class="timer-tag"')
    expect(html).toContain('role="timer" aria-live="off" aria-label="47 seconds left">0:47<')
    // a polite region, empty until a mark passes
    expect(html).toMatch(/role="status" aria-live="polite"><\/span>/)
  })

  it('turns hot at 10 seconds and stays hot at 0', () => {
    expect(renderToStaticMarkup(<TimerTag deadline={NOW + 10_500} durationSec={90} />)).toContain('class="timer-tag"')
    expect(renderToStaticMarkup(<TimerTag deadline={NOW + 10_000} durationSec={90} />)).toContain('class="timer-tag hot"')
    expect(renderToStaticMarkup(<TimerTag deadline={NOW + 8000} durationSec={90} />)).toContain('class="timer-tag hot"')
    expect(renderToStaticMarkup(<TimerTag deadline={NOW - 1000} durationSec={90} />)).toContain('class="timer-tag hot"')
  })

  it('burns the fuse down to what is left of the phase', () => {
    expect(renderToStaticMarkup(<TimerTag deadline={NOW + 45_000} durationSec={90} />)).toContain('width:50.00%')
    // a prompt window still open: more than the build time left
    expect(renderToStaticMarkup(<TimerTag deadline={NOW + 200_000} durationSec={90} />)).toContain('width:100.00%')
    expect(renderToStaticMarkup(<TimerTag deadline={NOW - 1} durationSec={90} />)).toContain('width:0.00%')
  })

  it('names the phase instead on Reveal, never hot, with no timer to read', () => {
    const html = renderToStaticMarkup(<TimerTag deadline={NOW + 3000} durationSec={8} word="Reveal" />)
    expect(html).toContain('<span class="timer-tag-word">Reveal</span>')
    expect(html).toContain('class="timer-tag"')
    expect(html).not.toContain('role="timer"')
    expect(html).not.toContain('aria-live')
    expect(html).toContain('width:37.50%')
  })
})
