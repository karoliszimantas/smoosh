import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WorkerRequest, WorkerResponse } from './protocol'

// a stand-in for the cut worker: records what it's asked, answers when told
class FakeWorker extends EventTarget {
  static all: FakeWorker[] = []
  posted: WorkerRequest[] = []
  terminated = false
  constructor() {
    super()
    FakeWorker.all.push(this)
  }
  postMessage(message: WorkerRequest) {
    this.posted.push(message)
  }
  terminate() {
    this.terminated = true
  }
  send(data: WorkerResponse) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

class FakeOffscreenCanvas {
  getContext() {
    return {}
  }
}

// a fresh cutClient, as on a fresh page, on a phone that can cut
async function freshClient() {
  vi.resetModules()
  return import('./cutClient')
}

const lastWorker = () => FakeWorker.all[FakeWorker.all.length - 1]
const lastJob = (w: FakeWorker | undefined) => w?.posted[w.posted.length - 1]?.job ?? -1

beforeEach(() => {
  FakeWorker.all = []
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('when the cutter may be fetched ahead', () => {
  it('on wifi, a wire, an unknown connection, or where the browser does not say', async () => {
    const { preloadAllowed } = await freshClient()
    expect(preloadAllowed(undefined)).toBe(true)
    expect(preloadAllowed({ type: 'wifi' })).toBe(true)
    expect(preloadAllowed({ type: 'ethernet' })).toBe(true)
    expect(preloadAllowed({ type: 'unknown' })).toBe(true)
    // desktop Chrome: a connection with no type
    expect(preloadAllowed({})).toBe(true)
  })

  it('never on cellular, or when the player saves data', async () => {
    const { preloadAllowed } = await freshClient()
    expect(preloadAllowed({ type: 'cellular' })).toBe(false)
    expect(preloadAllowed({ type: 'wifi', saveData: true })).toBe(false)
    expect(preloadAllowed({ saveData: true })).toBe(false)
  })
})

describe('preloading the cutter', () => {
  it('starts the worker and its download, once however often it is asked', async () => {
    const cut = await freshClient()
    expect(FakeWorker.all).toHaveLength(0)
    cut.preloadCutter({ type: 'wifi' })
    cut.preloadCutter({ type: 'wifi' })
    cut.preloadCutter(undefined)
    expect(FakeWorker.all).toHaveLength(1)
    expect(lastWorker()?.posted).toEqual([{ type: 'preload', job: 1 }])
    expect(cut.cutNeedsDownload()).toBe(false)
    // loaded: asking again does nothing
    lastWorker()?.send({ type: 'ready', job: 1 })
    cut.preloadCutter({ type: 'wifi' })
    expect(lastWorker()?.posted).toHaveLength(1)
  })

  it('on cellular: nothing fetched, and the sheet is told the first cut downloads', async () => {
    const cut = await freshClient()
    const heard = vi.fn()
    cut.subscribeCutter(heard)
    cut.preloadCutter({ type: 'cellular' })
    expect(FakeWorker.all).toHaveLength(0)
    expect(cut.cutNeedsDownload()).toBe(true)
    expect(heard).toHaveBeenCalledTimes(1)
    cut.preloadCutter({ type: 'wifi', saveData: true })
    expect(FakeWorker.all).toHaveLength(0)

    // the first cut fetches it: once it's cutting, the line goes
    void cut.cutImage('https://img.test/a.jpg', () => {}).catch(() => {})
    await Promise.resolve()
    await Promise.resolve()
    const w = lastWorker()
    expect(w?.posted[0]).toMatchObject({ type: 'cut', url: 'https://img.test/a.jpg' })
    w?.send({ type: 'cutting', job: lastJob(w) })
    expect(cut.cutNeedsDownload()).toBe(false)
  })

  it('a failed preload is forgotten: Cut stays, and the next try starts afresh', async () => {
    const cut = await freshClient()
    cut.preloadCutter({ type: 'wifi' })
    const first = lastWorker()
    first?.send({ type: 'error', job: 1, message: 'model 404', fatal: true })
    expect(first?.terminated).toBe(true)
    expect(cut.canCutOnDevice()).toBe(true)
    cut.preloadCutter({ type: 'wifi' })
    expect(FakeWorker.all).toHaveLength(2)
  })
})

describe('a phone too slow to cut', () => {
  // a cut that gets as far as cutting, then runs past its time
  async function timeOut(cut: Awaited<ReturnType<typeof freshClient>>) {
    const result = cut.cutImage('https://img.test/a.jpg', () => {})
    result.catch(() => {})
    await vi.advanceTimersByTimeAsync(0)
    const w = lastWorker()
    w?.send({ type: 'cutting', job: lastJob(w) })
    await vi.advanceTimersByTimeAsync(15_000)
    return result.then(
      () => null,
      (err: unknown) => err,
    )
  }

  it('keeps Cut, and after a second time-out gives up on cutting at once', async () => {
    vi.useFakeTimers()
    const cut = await freshClient()
    const first = await timeOut(cut)
    expect(first).toBeInstanceOf(cut.CutFailed)
    expect(first).not.toBeInstanceOf(cut.CutTooSlow)

    const second = await timeOut(cut)
    expect(second).toBeInstanceOf(cut.CutTooSlow)
    // Cut is still offered on every card
    expect(cut.canCutOnDevice()).toBe(true)

    // the next tap doesn't even start a cut: the whole picture just stays
    const workers = FakeWorker.all.length
    await expect(cut.cutImage('https://img.test/b.jpg', () => {})).rejects.toBeInstanceOf(cut.CutTooSlow)
    expect(FakeWorker.all).toHaveLength(workers)
    expect(cut.canCutOnDevice()).toBe(true)
  })

  it('a stalled download is the connection, not the phone: Cut stays', async () => {
    vi.useFakeTimers()
    const cut = await freshClient()
    const result = cut.cutImage('https://img.test/a.jpg', () => {})
    result.catch(() => {})
    await vi.advanceTimersByTimeAsync(30_000)
    await expect(result).rejects.toBeInstanceOf(cut.CutFailed)
    expect(cut.canCutOnDevice()).toBe(true)
  })
})
