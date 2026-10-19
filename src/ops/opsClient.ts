import { phaseKey, type OpsNet, type OpsReport, type OpsReportOf, type RoomSnapshot } from '@smoosh/protocol'
import { clockState } from '../game/serverClock'
import { describeAgent, fpsSummary, likelySource, readEntry, summarize } from './measure'

// How the game runs on this phone, measured with the browser's own
// Performance APIs and sent to the server's log (ops:report) — never shown,
// never stored. Everything here is passive or close to it, and what it does
// cost is measured and reported with the rest (samplerMs).

type Send = (report: OpsReport) => void

let send: Send | null = null
// reports made before the socket is up (the page's load numbers, a model
// download on the home screen) wait for it — a few, not forever
const waiting: OpsReport[] = []
const MAX_WAITING = 20

export function sendOps(report: OpsReport): void {
  if (send) send(report)
  else {
    waiting.push(report)
    if (waiting.length > MAX_WAITING) waiting.shift()
  }
}

// ---------- what the browser offers, where it does

type Memory = { usedJSHeapSize: number }
type Connection = { type?: string; effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean }
type UaData = { getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platformVersion?: string }> }
type ResourceEntry = PerformanceResourceTiming & { responseStatus?: number; deliveryType?: string }

const now = () => performance.now()

// JS heap in MB — Chrome only; null elsewhere
export function heapMb(): number | null {
  const memory = (performance as Performance & { memory?: Memory }).memory
  return memory ? memory.usedJSHeapSize / 1048576 : null
}

function connection(): Connection | undefined {
  return (navigator as Navigator & { connection?: Connection }).connection
}

function netInfo(): OpsNet | null {
  const c = connection()
  if (!c) return null
  return {
    type: c.type ?? null,
    effectiveType: c.effectiveType ?? null,
    downlinkMbps: typeof c.downlink === 'number' ? c.downlink : null,
    rttMs: typeof c.rtt === 'number' ? c.rtt : null,
    saveData: c.saveData === true,
  }
}

function observe(type: string, onEntries: (entries: PerformanceEntryList) => void, buffered = false): void {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes(type)) return
  try {
    new PerformanceObserver((list) => onEntries(list.getEntries())).observe({ type, buffered })
  } catch {
    // an engine that lists the type but won't observe it: nothing measured
  }
}

// ---------- a stretch: what's measured between two reports

type Assets = { count: number; failed: number; failures: { host: string; status: number }[]; ms: number[]; bytes: number; unsized: number; cached: number }

function freshAssets(): Assets {
  return { count: 0, failed: 0, failures: [], ms: [], bytes: 0, unsized: 0, cached: 0 }
}

const stretch = {
  from: '',
  startedAt: 0,
  rtt: [] as number[],
  fps: [] as number[],
  longTasks: { count: 0, totalMs: 0, maxMs: 0 },
  heapPeak: null as number | null,
  assets: freshAssets(),
  samplerMs: 0,
}

// since this page loaded
const page = { bytes: 0, unsized: 0 }
let longTasksSeen = false

function noteHeap(): void {
  const h = heapMb()
  if (h !== null && (stretch.heapPeak === null || h > stretch.heapPeak)) stretch.heapPeak = h
}

function hostOf(url: string): string {
  try {
    const host = new URL(url).host
    return host === location.host ? 'self' : host.replace(/^pub-[0-9a-f]+\./, '')
  } catch {
    return '?'
  }
}

// the game's own downloads: images, the manifest, the cutter, the page's
// scripts — not the socket's own traffic
function noteResources(entries: PerformanceEntryList): void {
  const began = now()
  for (const raw of entries) {
    const e = raw as ResourceEntry
    if (!e.name.startsWith('http') || e.name.includes('/socket.io/')) continue
    const got = readEntry(e)
    const a = stretch.assets
    a.count++
    a.ms.push(e.duration)
    if (got.sized) a.bytes += got.bytes
    else a.unsized++
    if (got.cached) a.cached++
    if (got.failed) {
      a.failed++
      if (a.failures.length < 5) a.failures.push({ host: hostOf(e.name), status: e.responseStatus ?? 0 })
    }
    if (got.sized) page.bytes += got.bytes
    else page.unsized++
  }
  stretch.samplerMs += now() - began
}

function noteLongTasks(entries: PerformanceEntryList): void {
  const began = now()
  for (const e of entries) {
    const t = stretch.longTasks
    t.count++
    t.totalMs += e.duration
    t.maxMs = Math.max(t.maxMs, e.duration)
  }
  stretch.samplerMs += now() - began
}

// ---------- frame rate, while building only

let fpsFrame = 0
let fpsBucketStart = 0
let fpsFrames = 0

function fpsTick(t: number): void {
  const began = now()
  if (fpsBucketStart === 0) fpsBucketStart = t
  fpsFrames++
  const elapsed = t - fpsBucketStart
  if (elapsed >= 1000) {
    // a gap this long is a page in the background, not a slow phone
    if (elapsed < 2000) stretch.fps.push((fpsFrames * 1000) / elapsed)
    fpsBucketStart = t
    fpsFrames = 0
    noteHeap()
  }
  fpsFrame = requestAnimationFrame(fpsTick)
  stretch.samplerMs += now() - began
}

function sampleFps(on: boolean): void {
  if (on === (fpsFrame !== 0)) return
  if (on) {
    fpsBucketStart = 0
    fpsFrames = 0
    fpsFrame = requestAnimationFrame(fpsTick)
  } else {
    cancelAnimationFrame(fpsFrame)
    fpsFrame = 0
  }
}

// ---------- reports

const building = (phase: string) => phase === 'build' || phase === 'pass'

function endStretch(to: string): void {
  if (!stretch.from) return
  const c = clockState()
  const a = stretch.assets
  sendOps({
    kind: 'stretch',
    from: stretch.from,
    to,
    wallMs: now() - stretch.startedAt,
    rtt: summarize(stretch.rtt),
    clockOffsetMs: c ? c.offset : null,
    clockSpreadMs: c ? c.spread : null,
    net: netInfo(),
    fps: fpsSummary(stretch.fps),
    longTasks: longTasksSeen ? stretch.longTasks : null,
    heapPeakMb: stretch.heapPeak,
    assets: { count: a.count, failed: a.failed, failures: a.failures, ms: summarize(a.ms), bytes: a.bytes, unsized: a.unsized, cached: a.cached },
    pageBytes: page.bytes,
    pageUnsized: page.unsized,
    samplerMs: stretch.samplerMs,
  })
}

function startStretch(from: string): void {
  stretch.from = from
  stretch.startedAt = now()
  stretch.rtt = []
  stretch.fps = []
  stretch.longTasks = { count: 0, totalMs: 0, maxMs: 0 }
  stretch.heapPeak = null
  stretch.assets = freshAssets()
  stretch.samplerMs = 0
  noteHeap()
}

// a stretch is a build on its own, or the rest of a round — and no longer
// than this, so a long reveal-and-scores spell still reports in good time
const STRETCH_MAX_MS = 120_000

let lastKey = ''
let lastPhase = ''
let lastRound: number | undefined

// every snapshot: say when a new phase first reaches the screen, and close
// the stretch at the right boundaries
export function noteSnapshot(snapshot: RoomSnapshot): void {
  const p = snapshot.phase
  const key = phaseKey(p)
  if (key === lastKey) return
  const round = 'round' in p ? p.round : undefined
  const arrived = now()
  requestAnimationFrame(() => sendOps({ kind: 'seen', key, frameMs: now() - arrived }))

  const boundary =
    !stretch.from ||
    building(p.phase) !== building(lastPhase) ||
    round !== lastRound ||
    now() - stretch.startedAt >= STRETCH_MAX_MS
  if (boundary) {
    endStretch(key)
    startStretch(key)
  }
  sampleFps(building(p.phase) && document.visibilityState === 'visible')
  lastKey = key
  lastPhase = p.phase
  lastRound = round
}

// the socket is up: send what waited, then report as things happen. Pinged
// for a round trip every so often while there's a page to see it
const PING_EVERY_MS = 10_000

export function bindOps(emit: Send, ping: (done: () => void) => void): () => void {
  send = emit
  for (const r of waiting.splice(0)) emit(r)
  const timer = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return
    noteHeap()
    const sent = now()
    ping(() => stretch.rtt.push(now() - sent))
  }, PING_EVERY_MS)
  return () => {
    window.clearInterval(timer)
    if (send === emit) send = null
  }
}

// ---------- once per page

let started = false
let appReadyMs: number | null = null

// the game's first screen is up
export function noteAppReady(): void {
  if (appReadyMs === null) appReadyMs = now()
}

export function startOps(): void {
  if (started || typeof window === 'undefined') return
  started = true
  try {
    performance.setResourceTimingBufferSize(1000)
  } catch {
    // older engines: the observer still hears every download
  }
  observe('resource', noteResources, true)
  observe('longtask', (entries) => {
    longTasksSeen = true
    noteLongTasks(entries)
  })
  longTasksSeen = PerformanceObserver.supportedEntryTypes?.includes('longtask') ?? false
  document.addEventListener('visibilitychange', () => {
    sampleFps(building(lastPhase) && document.visibilityState === 'visible')
    // a phone put away mid-game may not come back: say what it has
    if (document.visibilityState === 'hidden' && stretch.from) {
      endStretch(`${lastKey} (hidden)`)
      startStretch(lastKey)
    }
  })
}

// what this phone is, once per connection
export async function deviceReport(): Promise<OpsReportOf<'device'>> {
  const uaData = (navigator as Navigator & { userAgentData?: UaData }).userAgentData
  const hints = await uaData?.getHighEntropyValues?.(['model', 'platformVersion']).catch(() => undefined)
  const { device, browser } = describeAgent(navigator.userAgent, hints)
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return {
    kind: 'device',
    device,
    browser,
    cores: navigator.hardwareConcurrency ?? null,
    memoryGb: typeof memory === 'number' ? memory : null,
    screen: `${screen.width}x${screen.height}@${window.devicePixelRatio}`,
    net: netInfo(),
    fcpMs: fcp ? fcp.startTime : null,
    domReadyMs: nav ? nav.domContentLoadedEventEnd : null,
    appReadyMs,
  }
}

// ---------- the moments worth timing on their own

// the peak JS heap while something heavy runs (a cut, an export), sampled
// every so often until stopped
export function watchHeap(everyMs = 250): () => { before: number | null; peak: number | null } {
  const before = heapMb()
  let peak = before
  const timer = window.setInterval(() => {
    const h = heapMb()
    if (h !== null && (peak === null || h > peak)) peak = h
  }, everyMs)
  return () => {
    window.clearInterval(timer)
    const h = heapMb()
    if (h !== null && (peak === null || h > peak)) peak = h
    return { before, peak }
  }
}

// the segmentation model's first load on this page: from the first job sent
// to a worker without it, to the worker having it
const model = { requestedAt: 0, totals: new Map<string, number>(), lastAt: 0, done: false }

export function noteModelRequested(): void {
  if (model.done || model.requestedAt !== 0) return
  model.requestedAt = now()
}

export function noteModelProgress(key: string, total: number): void {
  if (model.done) return
  model.totals.set(key, total)
  model.lastAt = now()
}

export function noteModelLoaded(ok: boolean): void {
  if (model.done || model.requestedAt === 0) return
  model.done = ok
  let bytes = 0
  for (const t of model.totals.values()) bytes += t
  const ms = (model.lastAt || now()) - model.requestedAt
  const from = likelySource(bytes, ms)
  // fetched in the worker, so the page's own totals never saw it
  if (ok && from === 'network') page.bytes += bytes
  sendOps({ kind: 'model', bytes, ms, from, ok })
  if (!ok) {
    model.requestedAt = 0
    model.totals.clear()
  }
}

// a picture's export, waiting for its upload to finish the report
let exported: Omit<OpsReportOf<'upload'>, 'kind' | 'attempts' | 'reencodes' | 'ok'> | null = null

export function noteExport(e: NonNullable<typeof exported>): void {
  exported = e
}

export type UploadTrace = {
  attempts: OpsReportOf<'upload'>['attempts']
  reencodes: OpsReportOf<'upload'>['reencodes']
  finish: (ok: boolean) => void
}

export function traceUpload(): UploadTrace {
  const trace: UploadTrace = {
    attempts: [],
    reencodes: [],
    finish: (ok) => {
      const e = exported ?? { flattenMs: 0, encodeMs: 0, type: '?', bytes: 0, heapPeakMb: null }
      exported = null
      sendOps({ kind: 'upload', ...e, attempts: trace.attempts.slice(0, 10), reencodes: trace.reencodes.slice(0, 5), ok })
    },
  }
  return trace
}
