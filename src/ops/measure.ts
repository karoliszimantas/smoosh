import type { OpsStat } from '@smoosh/protocol'

// The sums behind the phone's operational reports, kept apart from the
// browser APIs so they can be checked.

// the typical sample, the bad tail and the worst — null with nothing to say
export function summarize(samples: readonly number[]): OpsStat | null {
  if (samples.length === 0) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  return { n: sorted.length, p50: at(0.5), p90: at(0.9), max: sorted[sorted.length - 1] ?? 0 }
}

// the slowest tenth of the seconds sampled, the worst one, and how many fell
// under 30 frames
export function fpsSummary(perSecond: readonly number[]): { p10: number; min: number; seconds: number; slowSeconds: number } | null {
  if (perSecond.length === 0) return null
  const sorted = [...perSecond].sort((a, b) => a - b)
  return {
    p10: sorted[Math.floor(0.1 * sorted.length)] ?? 0,
    min: sorted[0] ?? 0,
    seconds: sorted.length,
    slowSeconds: sorted.filter((f) => f < 30).length,
  }
}

// A cross-origin download the browser won't size (no Timing-Allow-Origin)
// can only be told cache from network by its speed. Measured on the cutter's
// 54MB: ~26MB/s over a fast wired line, ~330MB/s from the HTTP cache. A
// phone's disk is slower than a desktop's, its network slower still — the
// line sits between, and the log keeps the raw speed for anyone who doubts it
export const CACHE_MB_PER_S = 80

export function likelySource(bytes: number, ms: number): 'cache' | 'network' {
  const mbPerS = bytes / 1048576 / Math.max(0.001, ms / 1000)
  return mbPerS >= CACHE_MB_PER_S ? 'cache' : 'network'
}

// what one Resource Timing entry says about a download. Sizes are all zero
// for a cross-origin file without Timing-Allow-Origin — then it's unsized,
// and whether it came from the cache can't be told
export type Fetched = { bytes: number; sized: boolean; cached: boolean; failed: boolean }

export function readEntry(e: {
  transferSize: number
  encodedBodySize: number
  decodedBodySize: number
  responseStatus?: number
  deliveryType?: string
}): Fetched {
  const sized = e.transferSize > 0 || e.encodedBodySize > 0 || e.decodedBodySize > 0
  // a body with nothing transferred came from the browser's cache
  const cached = e.deliveryType === 'cache' || (sized && e.transferSize === 0)
  const failed = (e.responseStatus ?? 0) >= 400
  return { bytes: e.transferSize, sized, cached, failed }
}

// the phone and its browser, from the user agent (and Chrome's client hints,
// which name an Android phone's model)
export function describeAgent(ua: string, hints?: { model?: string; platformVersion?: string }): { device: string; browser: string } {
  const version = (re: RegExp) => re.exec(ua)?.[1]
  let device: string
  const ios = version(/(?:iPhone|CPU) OS (\d+[_\d]*)/)
  if (/iPhone/.test(ua)) device = `iPhone iOS ${ios?.replace(/_/g, '.') ?? '?'}`
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua))) device = `iPad iOS ${ios?.replace(/_/g, '.') ?? '?'}`
  else if (/Android/.test(ua)) {
    const fromUa = /Android [\d.]+; ([^;)]+)/.exec(ua)?.[1]?.trim()
    const model = hints?.model || (fromUa && fromUa !== 'K' ? fromUa : '')
    device = `Android ${hints?.platformVersion || version(/Android ([\d.]+)/) || '?'}${model ? ` ${model}` : ''}`
  } else if (/Windows/.test(ua)) device = 'Windows'
  else if (/Mac OS X/.test(ua)) device = 'Mac'
  else if (/CrOS/.test(ua)) device = 'ChromeOS'
  else if (/Linux/.test(ua)) device = 'Linux'
  else device = 'unknown'

  const browsers: [string, RegExp][] = [
    ['Samsung Internet', /SamsungBrowser\/(\d+)/],
    ['Edge', /Edg(?:iOS|A)?\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /(?:CriOS|Chrome)\/(\d+)/],
    ['Safari', /Version\/(\d+[.\d]*).*Safari/],
  ]
  let browser = 'unknown'
  for (const [name, re] of browsers) {
    const v = version(re)
    if (v) {
      browser = `${name} ${v}`
      break
    }
  }
  return { device, browser }
}
