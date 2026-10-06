// Main-thread side of on-device background removal. Owns the worker, the
// per-cut timeout, and the device-wide "can this phone cut at all" state the
// UI uses to hide the Cut control. The worker (and with it the library and
// its model) is created on the first cutImage() call — never at page load.

import type { WorkerRequest, WorkerResponse } from './protocol'

// A thermally throttled phone in round three can otherwise hang past the
// round deadline. Counted from when inference starts, not from page load —
// the one-time model download has its own stall guard below.
const CUT_TIMEOUT_MS = 15_000
// no download progress for this long and we call the download dead
const STALL_TIMEOUT_MS = 30_000
// a device that times out this often is too slow to be worth offering Cut on
const MAX_TIMEOUTS = 2

export type CutProgress =
  | { stage: 'download'; loaded: number; total: number }
  | { stage: 'cutting' }

export type CutOutput = {
  // trimmed to the subject — for this player's canvas
  place: Blob
  // untrimmed WebP for the shared library; null when the browser can't
  // encode WebP (Safari), in which case the cut stays local
  upload: Blob | null
}

export class CutFailed extends Error {}

// ---------- availability (useSyncExternalStore-shaped)

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
const listeners = new Set<() => void>()

function disable(reason: string): void {
  console.warn('[cut] disabling on-device cutting:', reason)
  if (!available) return
  available = false
  for (const l of listeners) l()
}

export function canCutOnDevice(): boolean {
  return available
}

export function subscribeCutAvailability(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ---------- worker + job queue

let worker: Worker | null = null
let jobSeq = 0
let timeouts = 0
// the worker runs one job at a time; so does this queue, so a second tap
// waits its turn instead of interleaving with the first
let queue: Promise<unknown> = Promise.resolve()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./cut.worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

function killWorker(): void {
  worker?.terminate()
  worker = null
}

function runJob(url: string, onProgress: (p: CutProgress) => void): Promise<CutOutput> {
  return new Promise<CutOutput>((resolve, reject) => {
    const job = ++jobSeq
    const w = getWorker()
    const downloads = new Map<string, { loaded: number; total: number }>()
    let timer: number | undefined
    let cutStartedAt = 0

    const arm = (ms: number, onFire: () => void) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(onFire, ms)
    }

    const finish = () => {
      window.clearTimeout(timer)
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
    }

    const fail = (message: string, fatal: boolean) => {
      finish()
      if (fatal) {
        killWorker()
        disable(message)
      }
      reject(new CutFailed(message))
    }

    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      if (msg.job !== job) return
      switch (msg.type) {
        case 'progress': {
          downloads.set(msg.key, { loaded: msg.loaded, total: msg.total })
          let loaded = 0
          let total = 0
          for (const d of downloads.values()) {
            loaded += d.loaded
            total += d.total
          }
          onProgress({ stage: 'download', loaded, total })
          arm(STALL_TIMEOUT_MS, () => fail('The cutter download stalled.', true))
          return
        }
        case 'cutting':
          cutStartedAt = performance.now()
          onProgress({ stage: 'cutting' })
          arm(CUT_TIMEOUT_MS, () => {
            // terminating is the only way to stop inference mid-run; the
            // next cut gets a fresh worker (model comes from the HTTP cache)
            killWorker()
            timeouts++
            if (timeouts >= MAX_TIMEOUTS) {
              fail('Cutting is too slow on this device — use Full instead.', true)
            } else {
              fail('Cutting took too long — try again, or use Full.', false)
            }
          })
          return
        case 'done':
          console.info(`[cut] inference took ${Math.round(performance.now() - cutStartedAt)}ms`)
          finish()
          resolve({ place: msg.place, upload: msg.upload })
          return
        case 'error':
          // the worker's own words are for the console; the player gets fixed ones
          console.warn('[cut] failed:', msg.message)
          fail(msg.fatal ? 'Cutting isn’t available on this device — use Full instead.' : 'Couldn’t cut this image — use Full instead.', msg.fatal)
          return
      }
    }

    const onError = (event: ErrorEvent) => {
      console.warn('[cut] worker error:', event.message)
      fail('Cutting isn’t available on this device — use Full instead.', true)
    }

    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)
    arm(STALL_TIMEOUT_MS, () => fail('The cutter download stalled.', true))
    const request: WorkerRequest = { job, url }
    w.postMessage(request)
  })
}

export function cutImage(url: string, onProgress: (p: CutProgress) => void): Promise<CutOutput> {
  if (!available) return Promise.reject(new CutFailed('Cutting is not available on this device.'))
  // re-checked when the job's turn comes: an earlier queued job may have
  // found out the device can't cut
  const result = queue.then(() =>
    available ? runJob(url, onProgress) : Promise.reject(new CutFailed('Cutting is not available on this device.')),
  )
  queue = result.catch(() => {})
  return result
}
