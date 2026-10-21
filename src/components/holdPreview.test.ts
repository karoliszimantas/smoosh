import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Dwell, FULL_DWELL_MS, HOLD_MS, HoldGesture, fullOf } from './holdPreview'
import type { SearchResult } from '../assets'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const timers = { set: (fn: () => void, ms: number) => Number(setTimeout(fn, ms)), clear: (id: number) => clearTimeout(id) }

function gesture() {
  const seen: (string | null)[] = []
  const g = new HoldGesture(
    (key) => seen.push(key),
    () => seen.push(null),
    timers,
  )
  return { g, seen }
}

describe('hold to preview', () => {
  it('a tap previews nothing and has no click to swallow — Cut and Full work as ever', () => {
    const { g, seen } = gesture()
    g.down(1, 100, 100, 'a')
    vi.advanceTimersByTime(120)
    expect(g.up(1)).toBe(false)
    vi.advanceTimersByTime(HOLD_MS)
    expect(seen).toEqual([])
  })

  it('a still hold previews; letting go hides it, and the click after is swallowed', () => {
    const { g, seen } = gesture()
    g.down(1, 100, 100, 'a')
    vi.advanceTimersByTime(HOLD_MS - 1)
    expect(seen).toEqual([])
    vi.advanceTimersByTime(1)
    expect(seen).toEqual(['a'])
    expect(g.up(1)).toBe(true)
    expect(seen).toEqual(['a', null])
  })

  it('moving before the hold is up is a scroll: no preview, ever', () => {
    const { g, seen } = gesture()
    g.down(1, 100, 100, 'a')
    vi.advanceTimersByTime(100)
    g.move(1, 100, 112, () => 'b')
    vi.advanceTimersByTime(HOLD_MS * 2)
    expect(seen).toEqual([])
    expect(g.holding).toBe(false)
  })

  it('a wobble under the slop still counts as still', () => {
    const { g, seen } = gesture()
    g.down(1, 100, 100, 'a')
    g.move(1, 104, 103, () => null)
    vi.advanceTimersByTime(HOLD_MS)
    expect(seen).toEqual(['a'])
  })

  it('sliding while held moves the preview card to card; a gap keeps the last one', () => {
    const { g, seen } = gesture()
    g.down(1, 100, 100, 'a')
    vi.advanceTimersByTime(HOLD_MS)
    for (const key of ['a', 'b', null, 'c', 'c', 'd']) g.move(1, 300, 100, () => key)
    expect(seen).toEqual(['a', 'b', 'c', 'd'])
    expect(g.up(1)).toBe(true)
    expect(seen.at(-1)).toBe(null)
  })

  it('a second finger before the hold is up calls it off (a pinch); another pointer’s release does nothing', () => {
    const { g, seen } = gesture()
    g.down(1, 100, 100, 'a')
    g.down(2, 200, 200, 'b')
    vi.advanceTimersByTime(HOLD_MS)
    expect(seen).toEqual([])
    g.down(3, 100, 100, 'a')
    vi.advanceTimersByTime(HOLD_MS)
    expect(g.up(4)).toBe(false)
    expect(g.previewing).toBe(true)
  })
})

describe('fetching the full image', () => {
  it('a slide across a row fetches nothing until it stops, then only the one it stopped on', () => {
    const fired: string[] = []
    const d = new Dwell(FULL_DWELL_MS, (url) => fired.push(url), timers)
    // a card every 80ms, the way a finger crosses a row
    for (let i = 0; i < 8; i++) {
      d.want(`full-${i}.webp`)
      vi.advanceTimersByTime(80)
    }
    expect(fired).toEqual([])
    vi.advanceTimersByTime(FULL_DWELL_MS)
    expect(fired).toEqual(['full-7.webp'])
  })

  it('letting go before the dwell fetches nothing', () => {
    const fired: string[] = []
    const d = new Dwell(FULL_DWELL_MS, (url) => fired.push(url), timers)
    d.want('full.webp')
    vi.advanceTimersByTime(FULL_DWELL_MS - 10)
    d.want(null)
    vi.advanceTimersByTime(FULL_DWELL_MS)
    expect(fired).toEqual([])
  })
})

describe('what the preview shows', () => {
  const base: SearchResult = { key: 'k', tier: 1, label: 'Goat', pixabayId: null, thumb: 't.webp', cut: null, rect: null, isBackground: false }
  it('the cut-out when there is one, else the whole picture, never the thumbnail again', () => {
    expect(fullOf({ ...base, cut: { full: 'cut.webp', thumb: 't.webp' }, rect: { full: 'rect.jpg', thumb: 'r.jpg' } })).toBe('cut.webp')
    expect(fullOf({ ...base, rect: { full: 'rect.jpg', thumb: 'r.jpg' } })).toBe('rect.jpg')
    expect(fullOf({ ...base, cut: { full: 't.webp', thumb: 't.webp' } })).toBe(null)
    expect(fullOf(base)).toBe(null)
  })
})
