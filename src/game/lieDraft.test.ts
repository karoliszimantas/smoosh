import { describe, it, expect, vi, afterEach } from 'vitest'
import { lieAutoSendArmed, lieDraftKey, loadLieDraft, pruneLieDrafts, saveLieDraft } from './lieDraft'
import { AUTO_LOCK_LEAD_MS, scheduleAutoLock } from './autoLock'

// a Map behind the parts of Storage the drafts use
function memoryStore() {
  const data = new Map<string, string>()
  return {
    data,
    get length() {
      return data.size
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

const throwing = {
  length: 1,
  key: (): string | null => {
    throw new Error('SecurityError')
  },
  getItem: (): string | null => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
  removeItem: () => {
    throw new Error('SecurityError')
  },
}

describe('a lie draft', () => {
  it('is kept per room, round and picture, and comes back after a reload', () => {
    const store = memoryStore()
    const key = lieDraftKey('ABCD', 2, 3)
    expect(key).toBe('smoosh_lie_ABCD_2_3')
    expect(loadLieDraft(key, store)).toBe('')
    saveLieDraft(key, 'a sloth fails a swim test', store)
    expect(loadLieDraft(key, store)).toBe('a sloth fails a swim test')
    expect(loadLieDraft(lieDraftKey('ABCD', 2, 4), store)).toBe('')
  })

  it('emptied, is gone from storage', () => {
    const store = memoryStore()
    const key = lieDraftKey('ABCD', 1, 0)
    saveLieDraft(key, 'something', store)
    saveLieDraft(key, '   ', store)
    expect(store.data.has(key)).toBe(false)
  })

  it('only the picture on screen keeps one, and going home keeps none', () => {
    const store = memoryStore()
    store.setItem('smoosh_session_id', 'abc')
    for (const i of [0, 1, 2]) saveLieDraft(lieDraftKey('ABCD', 1, i), `lie ${i}`, store)
    saveLieDraft(lieDraftKey('WXYZ', 3, 0), 'old game', store)
    pruneLieDrafts(lieDraftKey('ABCD', 1, 2), store)
    expect([...store.data.keys()]).toEqual(['smoosh_session_id', 'smoosh_lie_ABCD_1_2'])
    pruneLieDrafts(null, store)
    expect([...store.data.keys()]).toEqual(['smoosh_session_id'])
  })

  it('with storage refusing, nothing throws: the draft just lives on screen', () => {
    const key = lieDraftKey('ABCD', 1, 0)
    expect(() => saveLieDraft(key, 'x', throwing)).not.toThrow()
    expect(loadLieDraft(key, throwing)).toBe('')
    expect(() => pruneLieDrafts(null, throwing)).not.toThrow()
    expect(loadLieDraft(key, null)).toBe('')
  })
})

describe('a lie not sent when time runs out', () => {
  afterEach(() => vi.useRealTimers())

  it('is armed only with words in the box, unsent, and not on your own picture', () => {
    expect(lieAutoSendArmed({ text: 'a goat', submitted: false, isAuthor: false })).toBe(true)
    expect(lieAutoSendArmed({ text: '   ', submitted: false, isAuthor: false })).toBe(false)
    expect(lieAutoSendArmed({ text: 'a goat', submitted: true, isAuthor: false })).toBe(false)
    expect(lieAutoSendArmed({ text: 'a goat', submitted: false, isAuthor: true })).toBe(false)
  })

  it('is sent a second before the deadline, once', () => {
    vi.useFakeTimers()
    const now = Date.now()
    const deadline = now + 30_000
    const send = vi.fn()
    const armed = lieAutoSendArmed({ text: 'a goat at a wedding', submitted: false, isAuthor: false })
    const cancel = scheduleAutoLock(deadline, armed, send, now)
    vi.advanceTimersByTime(30_000 - AUTO_LOCK_LEAD_MS - 1)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(send).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5_000)
    expect(send).toHaveBeenCalledTimes(1)
    cancel?.()
  })

  it('an empty box sends nothing', () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const now = Date.now()
    const armed = lieAutoSendArmed({ text: '', submitted: false, isAuthor: false })
    expect(scheduleAutoLock(now + 5_000, armed, send, now)).toBeUndefined()
    vi.advanceTimersByTime(10_000)
    expect(send).not.toHaveBeenCalled()
  })
})
