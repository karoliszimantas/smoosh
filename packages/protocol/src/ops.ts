import { z } from 'zod'

// Operational numbers a phone sends about itself — how the game runs on it,
// not what happens in the game. The server writes each one to its log, next
// to the room's own lines, and keeps nothing.

// which phase a snapshot (or the room) is in, the same string on both sides:
// the server notes when it sent each one, the phone says when it saw it
export function phaseKey(phase: { phase: string } & Partial<Record<'round' | 'pictureIndex' | 'pass', number>>): string {
  const parts: string[] = [phase.phase]
  if (phase.round !== undefined) parts.push(`r${phase.round}`)
  if (phase.pictureIndex !== undefined) parts.push(`p${phase.pictureIndex + 1}`)
  if (phase.pass !== undefined) parts.push(`pass${phase.pass + 1}`)
  return parts.join(' ')
}

const Ms = z.number().finite().min(0).max(36_000_000)
const Mb = z.number().finite().min(0).max(1_000_000)
const Label = (max: number) => z.string().max(max)

// a spread of samples: how many, the typical one, the bad ones
export const OpsStatSchema = z.object({
  n: z.number().int().nonnegative(),
  p50: Ms,
  p90: Ms,
  max: Ms,
})
export type OpsStat = z.infer<typeof OpsStatSchema>

// what the browser says about the connection (Chrome on Android; null
// elsewhere): its kind, its effective class, and its own estimates
export const OpsNetSchema = z.object({
  type: Label(16).nullable(),
  effectiveType: Label(8).nullable(),
  downlinkMbps: Mb.nullable(),
  rttMs: Ms.nullable(),
  saveData: z.boolean(),
})
export type OpsNet = z.infer<typeof OpsNetSchema>

// once per connection: what the phone is, and how long the page took to come up
const DeviceReport = z.object({
  kind: z.literal('device'),
  device: Label(80),
  browser: Label(40),
  cores: z.number().int().min(0).max(512).nullable(),
  memoryGb: Mb.nullable(),
  screen: Label(24),
  net: OpsNetSchema.nullable(),
  // first paint, the DOM ready, and the game's first screen up, from the
  // start of the page load
  fcpMs: Ms.nullable(),
  domReadyMs: Ms.nullable(),
  appReadyMs: Ms.nullable(),
})

// the moment a new phase first reached the screen: the server times it
// from when it sent that phase
const PhaseSeenReport = z.object({
  kind: z.literal('seen'),
  key: Label(60),
  // snapshot arrived → the next frame: how long the phone itself took
  frameMs: Ms,
})

// how the phone ran over one stretch of the game — a build, or the rest of
// a round — from `from` to `to`
const StretchReport = z.object({
  kind: z.literal('stretch'),
  from: Label(60),
  to: Label(60),
  wallMs: Ms,
  rtt: OpsStatSchema.nullable(),
  // what the clock sync is correcting: server minus phone, and how far the
  // samples behind it disagree
  clockOffsetMs: z.number().finite().min(-86_400_000).max(86_400_000).nullable(),
  clockSpreadMs: Ms.nullable(),
  net: OpsNetSchema.nullable(),
  // frames a second, sampled only while building: the slow tenth, the worst
  // second, and how many seconds fell under 30
  fps: z.object({ p10: Mb, min: Mb, seconds: z.number().int().nonnegative(), slowSeconds: z.number().int().nonnegative() }).nullable(),
  longTasks: z.object({ count: z.number().int().nonnegative(), totalMs: Ms, maxMs: Ms }).nullable(),
  heapPeakMb: Mb.nullable(),
  assets: z.object({
    count: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    // the first few failures: where from, and the status (0 = no response)
    failures: z.array(z.object({ host: Label(40), status: z.number().int().min(0).max(999) })).max(5),
    ms: OpsStatSchema.nullable(),
    // bytes the browser could size, and fetches it couldn't (cross-origin
    // without Timing-Allow-Origin)
    bytes: z.number().int().nonnegative(),
    unsized: z.number().int().nonnegative(),
    // answered from the browser's own cache, where that can be told
    cached: z.number().int().nonnegative(),
  }),
  // everything this page has downloaded since it loaded, by the same rules
  pageBytes: z.number().int().nonnegative(),
  pageUnsized: z.number().int().nonnegative(),
  // the cost of measuring all this, over the stretch
  samplerMs: Ms,
})

// the segmentation model's first load on this page
const ModelReport = z.object({
  kind: z.literal('model'),
  bytes: z.number().int().nonnegative(),
  ms: Ms,
  // judged from the speed: no browser says outright for a cross-origin file
  from: z.enum(['cache', 'network']),
  ok: z.boolean(),
})

// one cut on the phone
const CutReport = z.object({
  kind: z.literal('cut'),
  ms: Ms,
  ok: z.boolean(),
  heapBeforeMb: Mb.nullable(),
  heapPeakMb: Mb.nullable(),
})

// a finished picture going out, stage by stage
const UploadReport = z.object({
  kind: z.literal('upload'),
  flattenMs: Ms,
  encodeMs: Ms,
  type: Label(16),
  bytes: z.number().int().nonnegative(),
  heapPeakMb: Mb.nullable(),
  // each request: how long until the server answered, and with what
  attempts: z
    .array(z.object({ ms: Ms, status: z.number().int().min(0).max(999), bytes: z.number().int().nonnegative() }))
    .max(10),
  // smaller versions made after a 413
  reencodes: z.array(z.object({ ms: Ms, bytes: z.number().int().nonnegative() })).max(5),
  ok: z.boolean(),
})

export const OpsReportSchema = z.discriminatedUnion('kind', [
  DeviceReport,
  PhaseSeenReport,
  StretchReport,
  ModelReport,
  CutReport,
  UploadReport,
])
export type OpsReport = z.infer<typeof OpsReportSchema>
export type OpsReportOf<K extends OpsReport['kind']> = Extract<OpsReport, { kind: K }>

export const OpsPingSchema = z.object({})
