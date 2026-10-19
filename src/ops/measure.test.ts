import { describe, expect, it } from 'vitest'
import { describeAgent, fpsSummary, likelySource, readEntry, summarize } from './measure'

describe('summarize', () => {
  it('nothing sampled: nothing to say', () => {
    expect(summarize([])).toBeNull()
  })

  it('the typical one, the tail and the worst', () => {
    const s = summarize([40, 10, 30, 20, 50, 60, 70, 80, 90, 1000])
    expect(s).toEqual({ n: 10, p50: 60, p90: 1000, max: 1000 })
  })
})

describe('fpsSummary', () => {
  it('the slow tenth, the worst second, the seconds under 30', () => {
    expect(fpsSummary([60, 60, 59, 58, 12, 60, 60, 25, 60, 60])).toEqual({ p10: 25, min: 12, seconds: 10, slowSeconds: 2 })
  })
})

describe('likelySource', () => {
  it('the cutter from the HTTP cache, and over a fast line, as measured', () => {
    expect(likelySource(53.6 * 1048576, 161)).toBe('cache')
    expect(likelySource(53.6 * 1048576, 2000)).toBe('network')
    expect(likelySource(56 * 1048576, 9000)).toBe('network')
  })
})

describe('readEntry', () => {
  it('a sized download over the network', () => {
    expect(readEntry({ transferSize: 12_300, encodedBodySize: 12_000, decodedBodySize: 12_000, responseStatus: 200 })).toEqual({
      bytes: 12_300,
      sized: true,
      cached: false,
      failed: false,
    })
  })

  it('a body with nothing transferred: the browser cache', () => {
    expect(readEntry({ transferSize: 0, encodedBodySize: 12_000, decodedBodySize: 12_000 }).cached).toBe(true)
  })

  it('cross-origin without Timing-Allow-Origin: unsized, cache unknown', () => {
    expect(readEntry({ transferSize: 0, encodedBodySize: 0, decodedBodySize: 0, responseStatus: 200 })).toEqual({
      bytes: 0,
      sized: false,
      cached: false,
      failed: false,
    })
  })

  it('a 404 is a failure', () => {
    expect(readEntry({ transferSize: 300, encodedBodySize: 0, decodedBodySize: 0, responseStatus: 404 }).failed).toBe(true)
  })
})

describe('describeAgent', () => {
  it('an iPhone: model withheld, iOS and Safari named', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    expect(describeAgent(ua)).toEqual({ device: 'iPhone iOS 17.5.1', browser: 'Safari 17.5' })
  })

  it('Chrome on iOS is Chrome', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1'
    expect(describeAgent(ua).browser).toBe('Chrome 129')
  })

  it('Android with the reduced UA: the model from client hints', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'
    expect(describeAgent(ua)).toEqual({ device: 'Android 10', browser: 'Chrome 129' })
    expect(describeAgent(ua, { model: 'Pixel 6', platformVersion: '14.0.0' })).toEqual({
      device: 'Android 14.0.0 Pixel 6',
      browser: 'Chrome 129',
    })
  })

  it('Samsung Internet before Chrome', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36'
    expect(describeAgent(ua)).toEqual({ device: 'Android 13 SM-A536B', browser: 'Samsung Internet 25' })
  })
})
