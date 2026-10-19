import type { OpsNet, OpsReport, OpsStat } from '@smoosh/protocol'

// One phone's report as one log line, readable as it stands and greppable by
// its first word: device, stretch, model, cut, upload.

const ms = (v: number) => (v >= 10_000 ? `${(v / 1000).toFixed(0)}s` : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`)
const kb = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`)
const stat = (s: OpsStat) => `p50 ${ms(s.p50)} p90 ${ms(s.p90)} max ${ms(s.max)} (n${s.n})`
const orDash = <T>(v: T | null, f: (v: T) => string) => (v === null ? '—' : f(v))

function net(n: OpsNet | null): string {
  if (!n) return 'net —'
  const parts = [n.type ?? n.effectiveType ?? '?']
  if (n.type && n.effectiveType) parts.push(n.effectiveType)
  if (n.downlinkMbps !== null) parts.push(`${n.downlinkMbps}Mbps`)
  if (n.rttMs !== null) parts.push(`est rtt ${ms(n.rttMs)}`)
  if (n.saveData) parts.push('save-data')
  return `net ${parts.join(' ')}`
}

export function reportLine(r: Exclude<OpsReport, { kind: 'seen' }>): string {
  switch (r.kind) {
    case 'device':
      return (
        `device ${r.device} | ${r.browser} | ${r.cores ?? '?'} cores, ${r.memoryGb ?? '?'}GB, screen ${r.screen} | ${net(r.net)}` +
        ` | first paint ${orDash(r.fcpMs, ms)}, dom ready ${orDash(r.domReadyMs, ms)}, game up ${orDash(r.appReadyMs, ms)}`
      )
    case 'stretch': {
      const a = r.assets
      const failures = a.failures.map((f) => `${f.host} ${f.status || 'no response'}`).join(', ')
      return (
        `stretch ${r.from} → ${r.to} (${ms(r.wallMs)})` +
        ` | rtt ${orDash(r.rtt, stat)}` +
        ` | clock ${orDash(r.clockOffsetMs, (v) => `${v > 0 ? '+' : ''}${Math.round(v)}ms`)} ±${orDash(r.clockSpreadMs, ms)}` +
        ` | ${net(r.net)}` +
        ` | fps ${orDash(r.fps, (f) => `p10 ${f.p10.toFixed(0)} worst ${f.min.toFixed(0)}, ${f.slowSeconds}/${f.seconds}s under 30`)}` +
        ` | long tasks ${orDash(r.longTasks, (t) => `${t.count} (${ms(t.totalMs)}, max ${ms(t.maxMs)})`)}` +
        ` | heap peak ${orDash(r.heapPeakMb, (v) => `${v.toFixed(0)}MB`)}` +
        ` | assets ${a.count}, ${a.cached} cached, ${a.failed} failed${failures ? ` (${failures})` : ''}, ${orDash(a.ms, stat)}, ${kb(a.bytes)} + ${a.unsized} unsized` +
        ` | page total ${kb(r.pageBytes)} + ${r.pageUnsized} unsized` +
        ` | sampler ${ms(r.samplerMs)} (${((r.samplerMs / Math.max(1, r.wallMs)) * 100).toFixed(2)}%)`
      )
    }
    case 'model':
      return `model ${r.ok ? 'loaded' : 'FAILED'}: ${kb(r.bytes)} in ${ms(r.ms)} (${(r.bytes / 1048576 / Math.max(0.001, r.ms / 1000)).toFixed(1)}MB/s, likely from ${r.from})`
    case 'cut':
      return `cut ${r.ok ? 'done' : 'FAILED'} in ${ms(r.ms)} | heap ${orDash(r.heapBeforeMb, (v) => `${v.toFixed(0)}MB`)} → peak ${orDash(r.heapPeakMb, (v) => `${v.toFixed(0)}MB`)}`
    case 'upload': {
      const tries = r.attempts.map((t) => `${t.status || 'no response'} in ${ms(t.ms)} (${kb(t.bytes)})`).join(', ')
      const shrinks = r.reencodes.map((e) => `${ms(e.ms)} → ${kb(e.bytes)}`).join(', ')
      return (
        `upload ${r.ok ? 'sent' : 'FAILED'} | flatten ${ms(r.flattenMs)}, encode ${ms(r.encodeMs)} → ${kb(r.bytes)} ${r.type}` +
        ` | requests: ${tries || 'none'}${shrinks ? ` | re-encoded: ${shrinks}` : ''}` +
        ` | heap peak ${orDash(r.heapPeakMb, (v) => `${v.toFixed(0)}MB`)}`
      )
    }
  }
}
