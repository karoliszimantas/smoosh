import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AUTO_LOCK_LEAD_MS, scheduleAutoLock } from './autoLock'

const NOW = 1_000_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('locking in a pick as time runs out', () => {
  it('sends the pick once, a second before the deadline', () => {
    const send = vi.fn()
    scheduleAutoLock(NOW + 30_000, true, send)
    vi.advanceTimersByTime(30_000 - AUTO_LOCK_LEAD_MS - 1)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(send).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('arms nothing without a pick to send: none, locked in already, or the picture’s author', () => {
    const send = vi.fn()
    expect(scheduleAutoLock(NOW + 30_000, false, send)).toBeUndefined()
    vi.advanceTimersByTime(60_000)
    expect(send).not.toHaveBeenCalled()
  })

  it('arms nothing without a deadline', () => {
    const send = vi.fn()
    expect(scheduleAutoLock(null, true, send)).toBeUndefined()
    vi.runAllTimers()
    expect(send).not.toHaveBeenCalled()
  })

  it('sends at once a pick made inside the last second', () => {
    const send = vi.fn()
    scheduleAutoLock(NOW + 400, true, send)
    vi.advanceTimersByTime(0)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('is called off by its disarm: locking in by hand, a new picture, leaving the screen', () => {
    const send = vi.fn()
    const disarm = scheduleAutoLock(NOW + 30_000, true, send)
    vi.advanceTimersByTime(10_000)
    disarm?.()
    vi.advanceTimersByTime(60_000)
    expect(send).not.toHaveBeenCalled()
  })

  it('follows a deadline that moved: the old one is disarmed, the new one armed', () => {
    const send = vi.fn()
    const disarm = scheduleAutoLock(NOW + 30_000, true, send)
    disarm?.()
    // the room paused for 20s: the server pushed the deadline back
    scheduleAutoLock(NOW + 50_000, true, send)
    vi.advanceTimersByTime(30_000)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(20_000 - AUTO_LOCK_LEAD_MS)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
