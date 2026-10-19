// Main-thread side of on-device background removal. Owns the worker, the
// per-cut timeout, and the device-wide state the UI reads: whether this
// phone can cut at all, and whether the cutter still has to be downloaded.
// Nothing loads at page load: the worker (and with it the library and its
// model) starts on preloadCutter() — while a player reads their prompt,
// before their clock runs — or on the first cutImage() call.

import type { CutTrim, WorkerRequest, WorkerResponse } from './protocol'

// A thermally throttled phone in round three can otherwise hang past the
// round deadline. Counted from when inference starts, not from page load —
// the one-time model download has its own stall guard below.
const CUT_TIMEOUT_MS = 15_000
// no download progress for this long and we call the download dead
const STALL_TIMEOUT_MS = 30_000
// a device that times out this often is too slow to wait for: from then on
// a cut gives up at once and the whole picture stays (Cut itself stays put)
const MAX_TIMEOUTS = 2

export type { CutTrim } from './protocol'
import { noteModelLoaded, noteModelProgress, noteModelRequested, sendOps, watchHeap } from '../ops/opsClient'

export type CutProgress =
  | { stage: 'download'; loaded: number; total: number }
  | { stage: 'cutting' }

export type CutOutput = {
  // trimmed to the subject — for this player's canvas
  place: Blob
  // where that trimmed cut sits in the image it was cut from
  trim: CutTrim
  // untrimmed WebP for the shared library; null when the browser can't
  // encode WebP (Safari), in which case the cut stays local
  upload: Blob | null
}

export class CutFailed extends Error {}
// this phone has been too slow to cut, often enough not to try again
export class CutTooSlow extends CutFailed {}

// ---------- state (useSyncExternalStore-shaped)

function detectSupport(): boolean {
  try {
    return (
      typeof Worker !== 'undefined' &&
      typeof WebAssembly === 'object' &&
      typeof OffscreenCanvas !== 'undefined' &&
      new OffscreenCanvas(1, 1).getContext('2d') !== null
    )
  } catch {
    return false
  }
}

let available = detectSupport()
// the model has been fetched once on this page: from now on it comes from
// the HTTP cache, even into a fresh worker
let loaded = false
// the preload was left for later to spare a metered connection, so the
// first cut downloads the cutter — and the sheet says so up front
let preloadSkipped = false
let timeouts = 0
let tooSlow = false
const listeners = new Set<() => void>()

function changed(): void {
  for (const l of listeners) l()
}

function disable(reason: string): void {
  console.warn('[cut] disabling on-device cutting:', reason)
  if (!available) return
  available = false
  changed()
}

function markLoaded(): void {
  if (loaded) return
  loaded = true
  changed()
}

export function canCutOnDevice(): boolean {
  return available
}

// the first cut has a download to make first
export function cutNeedsDownload(): boolean {
  return preloadSkipped && !loaded
}

export function subscribeCutter(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ---------- worker + job queue

let worker: Worker | null = null
let jobSeq = 0
// a cut is running on the worker
let running = false
// a preload is fetching the cutter
let preloading = false
// the worker runs one job at a time; so does this queue, so a second tap
// waits its turn instead of interleaving with the first
let queue: Promise<unknown> = Promise.resolve()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./cut.worker.ts', import.meta.url), { type: 'module' })
    // whoever asked, the model is in once a job gets past loading it — and
    // how its first load went goes to the operational log
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      if (msg.type === 'progress') noteModelProgress(msg.key, msg.total)
      if (msg.type === 'ready' || msg.type === 'cutting') {
        if (!loaded) noteModelLoaded(true)
        markLoaded()
      }
      if (msg.type === 'error' && msg.fatal && !loaded) noteModelLoaded(false)
    })
  }
  return worker
}

function killWorker(): void {
  worker?.terminate()
  worker = null
  // a preload on it goes too; the next one (or the first cut) starts afresh
  preloading = false
}

// ---------- preload

// what the browser says about the connection (Chrome on Android; absent in
// Safari and Firefox)
export type ConnectionInfo = { type?: string; saveData?: boolean }

function currentConnection(): ConnectionInfo | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: ConnectionInfo }).connection
}

// The cutter is ~40MB. Fetched ahead only where that's free: on wifi or a
// wire, or where the browser doesn't say — never on cellular, and never
// when the player has asked to save data.
export function preloadAllowed(connection: ConnectionInfo | undefined): boolean {
  if (!connection) return true
  if (connection.saveData === true) return false
  return connection.type === undefined || connection.type === 'wifi' || connection.type === 'ethernet' || connection.type === 'unknown'
}

// Gets the cutter ready before anyone taps Cut, in the background. Safe to
// call any number of times; it never throws, and a preload that fails is
// forgotten — the first cut tries again, as if there had been none.
export function preloadCutter(connection: ConnectionInfo | undefined = currentConnection()): void {
  // (a cut already running is fetching it anyway)
  if (!available || loaded || preloading || running) return
  if (!preloadAllowed(connection)) {
    if (!preloadSkipped) {
      preloadSkipped = true
      changed()
    }
    return
  }
  try {
    const job = ++jobSeq
    const w = getWorker()
    preloading = true
    const settle = (failure?: string) => {
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
      if (w !== worker) return
      preloading = false
      if (failure === undefined) return
      console.warn('[cut] preload failed:', failure)
      // a worker whose library failed to load stays failed — unless a cut
      // is using it (that cut finds out for itself), start the next afresh
      if (!running) killWorker()
    }
    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      if (msg.job !== job) return
      if (msg.type === 'ready') settle()
      else if (msg.type === 'error') settle(msg.message)
    }
    const onError = (event: ErrorEvent) => settle(event.message || 'worker error')
    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)
    const request: WorkerRequest = { type: 'preload', job }
    noteModelRequested()
    w.postMessage(request)
  } catch (err) {
    console.warn('[cut] preload failed:', err)
    killWorker()
  }
}

// ---------- cutting

function runJob(url: string, onProgress: (p: CutProgress) => void): Promise<CutOutput> {
  return new Promise<CutOutput>((resolve, reject) => {
    const job = ++jobSeq
    const w = getWorker()
    const downloads = new Map<string, { loaded: number; total: number }>()
    let timer: number | undefined
    let cutStartedAt = 0
    running = true

    const arm = (ms: number, onFire: () => void) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(onFire, ms)
    }

    const finish = () => {
      running = false
      window.clearTimeout(timer)
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
    }

    // `fatal`: this device can't cut at all. `restart`: this worker is no
    // use any more (stuck, or stopped mid-run) — the next cut gets a fresh
    // one, its model from the HTTP cache
    const fail = (error: CutFailed, how: { fatal?: boolean; restart?: boolean } = {}) => {
      finish()
      if (how.fatal || how.restart) killWorker()
      if (how.fatal) disable(error.message)
      reject(error)
    }

    // a dead connection, not a slow phone: this cut is lost, the next tries again
    const stalled = () => fail(new CutFailed('The cutter download stalled.'), { restart: true })

    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      if (msg.job !== job) return
      switch (msg.type) {
        case 'progress': {
          downloads.set(msg.key, { loaded: msg.loaded, total: msg.total })
          let loadedBytes = 0
          let total = 0
          for (const d of downloads.values()) {
            loadedBytes += d.loaded
            total += d.total
          }
          onProgress({ stage: 'download', loaded: loadedBytes, total })
          arm(STALL_TIMEOUT_MS, stalled)
          return
        }
        case 'cutting':
          cutStartedAt = performance.now()
          onProgress({ stage: 'cutting' })
          arm(CUT_TIMEOUT_MS, () => {
            // terminating is the only way to stop inference mid-run
            timeouts++
            if (timeouts >= MAX_TIMEOUTS) {
              tooSlow = true
              fail(new CutTooSlow('Cutting is too slow on this device.'), { restart: true })
            } else {
              fail(new CutFailed('Cutting took too long.'), { restart: true })
            }
          })
          return
        case 'ready':
          return
        case 'done':
          console.info(`[cut] inference took ${Math.round(performance.now() - cutStartedAt)}ms`)
          finish()
          resolve({ place: msg.place, upload: msg.upload, trim: msg.trim })
          return
        case 'error':
          // the worker's own words are for the console; the player gets fixed ones
          console.warn('[cut] failed:', msg.message)
          fail(new CutFailed(msg.fatal ? 'Cutting isn’t available on this device.' : 'Couldn’t cut this image.'), {
            fatal: msg.fatal,
          })
          return
      }
    }

    const onError = (event: ErrorEvent) => {
      console.warn('[cut] worker error:', event.message)
      fail(new CutFailed('Cutting isn’t available on this device.'), { fatal: true })
    }

    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)
    arm(STALL_TIMEOUT_MS, stalled)
    const request: WorkerRequest = { type: 'cut', job, url }
    if (!loaded) noteModelRequested()
    w.postMessage(request)
  })
}

// why a cut can't even start: a device that can't cut, or one too slow to
// be worth waiting for
function refusal(): CutFailed | null {
  if (!available) return new CutFailed('Cutting is not available on this device.')
  if (tooSlow) return new CutTooSlow('Cutting is too slow on this device.')
  return null
}

// a cut, timed whole (a first cut includes the model's download, which the
// model's own report separates out), with the heap it peaked at
function timedJob(url: string, onProgress: (p: CutProgress) => void): Promise<CutOutput> {
  const heap = watchHeap()
  const startedAt = performance.now()
  const report = (ok: boolean) => {
    const { before, peak } = heap()
    sendOps({ kind: 'cut', ms: performance.now() - startedAt, ok, heapBeforeMb: before, heapPeakMb: peak })
  }
  return runJob(url, onProgress).then(
    (out) => {
      report(true)
      return out
    },
    (err: unknown) => {
      report(false)
      throw err
    },
  )
}

export function cutImage(url: string, onProgress: (p: CutProgress) => void): Promise<CutOutput> {
  const refused = refusal()
  if (refused) return Promise.reject(refused)
  // re-checked when the job's turn comes: an earlier queued job may have
  // found out the device can't cut, or is too slow to
  const result = queue.then(() => {
    const late = refusal()
    return late ? Promise.reject(late) : timedJob(url, onProgress)
  })
  queue = result.catch(() => {})
  return result
}
