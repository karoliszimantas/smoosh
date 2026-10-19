import { describe, it, expect } from 'vitest'
import { phaseKey, OpsReportSchema } from '@smoosh/protocol'
import { createRoom, type Room, type Seat } from '../src/rooms/Room.ts'
import { notePhaseSeen, notePhaseSent } from '../src/ops/phaseAcks.ts'
import { reportLine } from '../src/ops/reportLine.ts'
import { duration } from '../src/ops/health.ts'

function seat(room: Room, name: string, socketId: string | null): Seat {
  const s: Seat = {
    sessionId: `s-${name}`,
    playerId: `p-${name}`,
    seat: room.seats.size,
    name,
    isHost: room.seats.size === 0,
    presence: 'present',
    socketId,
    score: 0,
    joinedAt: 0,
    presentSince: 0,
    awayFrom: null,
  }
  room.seats.set(s.playerId, s)
  return s
}

describe('phaseKey', () => {
  it('names a phase by what it is and where', () => {
    expect(phaseKey({ phase: 'lobby' })).toBe('lobby')
    expect(phaseKey({ phase: 'guess', round: 2, pictureIndex: 2 })).toBe('guess r2 p3')
    expect(phaseKey({ phase: 'pass', round: 1, pass: 0 })).toBe('pass r1 pass1')
  })
})

describe('phase acks', () => {
  it('one line once every phone it went to has shown it', () => {
    const room = createRoom('ABCD')
    const mara = seat(room, 'Mara', 'sock-1')
    const teo = seat(room, 'Teo', 'sock-2')
    const lines: string[] = []
    const log = (m: string) => lines.push(m)
    room.phase = { phase: 'lobby' }
    notePhaseSent(room, log, 1000)
    notePhaseSeen(room, mara, 'lobby', 4, log, 1085)
    expect(lines).toEqual([])
    notePhaseSeen(room, teo, 'lobby', 640, log, 3100)
    expect(lines).toEqual(['ops seen lobby: Mara 85ms, Teo 2.1s (phone 640ms)'])
  })

  it('a phone that never answers is named when the next phase comes', () => {
    const room = createRoom('ABCD')
    const mara = seat(room, 'Mara', 'sock-1')
    seat(room, 'Ana', 'sock-3')
    const lines: string[] = []
    const log = (m: string) => lines.push(m)
    room.phase = { phase: 'lobby' }
    notePhaseSent(room, log, 0)
    notePhaseSeen(room, mara, 'lobby', 0, log, 50)
    room.round = 1
    room.phase = { phase: 'build', round: 1, totalRounds: 3, deadline: 0, collecting: false }
    notePhaseSent(room, log, 100)
    expect(lines).toEqual(['ops seen lobby: Mara 50ms, Ana —'])
  })

  it('an answer for an old phase, or from a phone that wasn’t there, counts for nothing', () => {
    const room = createRoom('ABCD')
    const mara = seat(room, 'Mara', 'sock-1')
    const late = seat(room, 'Late', null)
    const lines: string[] = []
    const log = (m: string) => lines.push(m)
    room.phase = { phase: 'lobby' }
    notePhaseSent(room, log, 0)
    notePhaseSeen(room, mara, 'build r1', 0, log, 10)
    notePhaseSeen(room, late, 'lobby', 0, log, 10)
    expect(lines).toEqual([])
    notePhaseSeen(room, mara, 'lobby', 0, log, 20)
    expect(lines).toEqual(['ops seen lobby: Mara 20ms'])
  })
})

describe('report lines', () => {
  it('a stretch reads as one line, the unknowns as dashes', () => {
    const report = OpsReportSchema.parse({
      kind: 'stretch',
      from: 'build r1',
      to: 'lie r1 p1',
      wallMs: 92_000,
      rtt: { n: 9, p50: 41, p90: 120, max: 380 },
      clockOffsetMs: -1200,
      clockSpreadMs: 35,
      net: null,
      fps: { p10: 48, min: 21, seconds: 88, slowSeconds: 3 },
      longTasks: null,
      heapPeakMb: null,
      assets: { count: 14, failed: 1, failures: [{ host: 'r2.dev', status: 404 }], ms: { n: 14, p50: 120, p90: 600, max: 900 }, bytes: 0, unsized: 14, cached: 0 },
      pageBytes: 1_200_000,
      pageUnsized: 30,
      samplerMs: 40,
    })
    if (report.kind !== 'stretch') throw new Error('parse')
    const line = reportLine(report)
    expect(line).toContain('stretch build r1 → lie r1 p1 (92s)')
    expect(line).toContain('rtt p50 41ms p90 120ms max 380ms (n9)')
    expect(line).toContain('clock -1200ms ±35ms')
    expect(line).toContain('net —')
    expect(line).toContain('fps p10 48 worst 21, 3/88s under 30')
    expect(line).toContain('long tasks —')
    expect(line).toContain('1 failed (r2.dev 404)')
    expect(line).toContain('sampler 40ms (0.04%)')
  })

  it('a model load says how fast, and so where from', () => {
    expect(reportLine({ kind: 'model', bytes: 56 * 1048576, ms: 9000, from: 'network', ok: true })).toBe(
      'model loaded: 56.0MB in 9.0s (6.2MB/s, likely from network)',
    )
  })

  it('reports out of bounds are refused', () => {
    expect(OpsReportSchema.safeParse({ kind: 'cut', ms: -5, ok: true, heapBeforeMb: null, heapPeakMb: null }).success).toBe(false)
    expect(OpsReportSchema.safeParse({ kind: 'seen', key: 'x'.repeat(500), frameMs: 1 }).success).toBe(false)
  })
})

describe('duration', () => {
  it('short and readable', () => {
    expect(duration(45_000)).toBe('45s')
    expect(duration(30 * 60_000)).toBe('30m')
    expect(duration(5 * 3600_000 + 7 * 60_000)).toBe('5h7m')
    expect(duration(3 * 86_400_000 + 2 * 3600_000)).toBe('3d2h')
  })
})
