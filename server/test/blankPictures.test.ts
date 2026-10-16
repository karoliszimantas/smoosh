import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import sharp from 'sharp'
import { BLANK_PICTURE_PARAM, BUILD_GRACE_SEC, MISSING_PHASE_SEC, PROMPT_WINDOW_SEC, type GameSettings } from '@smoosh/protocol'
import { createAndRegisterRoom, createRoom, deleteRoom, type Room, type Seat } from '../src/rooms/Room.ts'
import {
  auditRound,
  dropPendingActor,
  recordLie,
  roundAuditProblem,
  startBuild,
  votablePictures,
  type PhaseMachineDeps,
} from '../src/game/phaseMachine.ts'
import { looksBlank } from '../src/submissions/blank.ts'
import { hasSubmission, isBlankSubmission, deleteRoomSubmissions } from '../src/submissions/store.ts'
import { createRequestHandler } from '../src/http.ts'

const PAPER = { r: 0xfb, g: 0xf7, b: 0xee, alpha: 1 }
const SIZE = 1024

function paper() {
  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: PAPER } })
}

// paper with one small sticker-sized mark on it
async function drawn(): Promise<Buffer> {
  const mark = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 30, g: 60, b: 160, alpha: 1 } } })
    .png()
    .toBuffer()
  return paper()
    .composite([{ input: mark, left: 500, top: 500 }])
    .webp({ quality: 80 })
    .toBuffer()
}

function makeSeat(n: number): Seat {
  return {
    sessionId: `blank-session-${n}`,
    playerId: `player-${n}`,
    seat: n - 1,
    name: `Player ${n}`,
    isHost: n === 1,
    presence: 'present',
    socketId: `socket-${n}`,
    score: 0,
    joinedAt: n,
    presentSince: n,
    awayFrom: null,
  }
}

function seatPlayers(room: Room, count: number, mode: GameSettings['mode'] = 'guess'): void {
  room.settings = { ...room.settings, rounds: 3, buildTimeSec: 60, answerTimeSec: 120, mode, prompted: true }
  for (let i = 1; i <= count; i++) {
    const seat = makeSeat(i)
    room.seats.set(seat.playerId, seat)
  }
}

describe('looksBlank', () => {
  it('a page of plain paper is blank, as a lossy WebP or a PNG', async () => {
    expect(await looksBlank(await paper().webp({ quality: 75 }).toBuffer())).toBe(true)
    expect(await looksBlank(await paper().png().toBuffer())).toBe(true)
  })

  it('a fully transparent picture is blank', async () => {
    const clear = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer()
    expect(await looksBlank(clear)).toBe(true)
  })

  it('one small mark on the paper is not blank', async () => {
    expect(await looksBlank(await drawn())).toBe(false)
  })

  it('bytes it cannot read are not blank, and do not throw', async () => {
    expect(await looksBlank(Buffer.from('RIFF\0\0\0\0WEBPVP8 nonsense'))).toBe(false)
  })
})

describe('the upload route', () => {
  let server: http.Server
  let base: string
  let room: Room
  const deps: PhaseMachineDeps = {
    prompts: () => ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
    hasSubmission,
    isBlank: isBlankSubmission,
    onSnapshot: () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
  }

  beforeAll(async () => {
    server = http.createServer(createRequestHandler(deps))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    room = createAndRegisterRoom()
    // four players, so three uploads here never end BUILD
    seatPlayers(room, 4)
    startBuild(room, deps)
  })
  afterAll(async () => {
    if (room.timer) clearTimeout(room.timer)
    if (room.windowTimer) clearTimeout(room.windowTimer)
    deleteRoomSubmissions(room.code)
    deleteRoom(room.code)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  async function upload(n: number, body: Buffer, query = ''): Promise<number> {
    const res = await fetch(`${base}/submissions/${room.code}/1/player-${n}${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/webp', 'X-Session-Id': `blank-session-${n}` },
      body,
    })
    return res.status
  }

  it(`takes ?${BLANK_PICTURE_PARAM}=1 at its word`, async () => {
    // pixels with something on them: the phone's word is enough
    expect(await upload(1, await drawn(), `?${BLANK_PICTURE_PARAM}=1`)).toBe(200)
    expect(hasSubmission(room.code, 1, 'player-1')).toBe(true)
    expect(isBlankSubmission(room.code, 1, 'player-1')).toBe(true)
  })

  it('finds a blank picture by its pixels when the phone did not say', async () => {
    expect(await upload(2, await paper().webp({ quality: 75 }).toBuffer())).toBe(200)
    expect(isBlankSubmission(room.code, 1, 'player-2')).toBe(true)
  })

  it('a picture with something on it is not blank', async () => {
    expect(await upload(3, await drawn())).toBe(200)
    expect(hasSubmission(room.code, 1, 'player-3')).toBe(true)
    expect(isBlankSubmission(room.code, 1, 'player-3')).toBe(false)
  })
})

describe('a blank picture in the game', () => {
  beforeAll(() => {
    vi.useFakeTimers()
  })
  afterAll(() => {
    vi.useRealTimers()
  })
  afterEach(() => {
    vi.clearAllTimers()
  })

  // player-2's picture arrived blank; everyone else's has something on it
  function setup(mode: GameSettings['mode'] = 'guess') {
    const room = createRoom('BLNK')
    seatPlayers(room, 3, mode)
    const phases: { phase: string; authorId?: string; blank?: boolean; runsMs?: number }[] = []
    const errors: unknown[] = []
    const deps: PhaseMachineDeps = {
      prompts: () => ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
      hasSubmission: () => true,
      isBlank: (_code, _round, id) => id === 'player-2',
      onSnapshot: (r) => {
        const p = r.phase
        phases.push({
          phase: p.phase,
          ...('authorId' in p ? { authorId: p.authorId } : {}),
          ...(p.phase === 'missing' ? { blank: p.blank, runsMs: p.deadline - Date.now() } : {}),
        })
      },
      random: () => 0.99,
      log: { info: () => {}, warn: () => {}, error: (...args: unknown[]) => errors.push(args) },
    }
    startBuild(room, deps)
    vi.advanceTimersByTime((PROMPT_WINDOW_SEC + 60 + BUILD_GRACE_SEC) * 1000)
    return { room, deps, phases, errors }
  }

  it('is never put up for lies or guesses: a short blank notice, then the next picture', () => {
    const { room, deps, phases, errors } = setup()
    expect(room.pictureQueue.find((s) => s.authorId === 'player-2')).toEqual({ authorId: 'player-2', hasPicture: false, blank: true })

    for (let t = 0; t < 200 && room.phase.phase !== 'scores'; t++) {
      const phase = room.phase
      if (phase.phase === 'lie') {
        for (const id of [...room.pendingActors]) {
          recordLie(room, phase.pictureIndex, id, `fake by ${id}`)
          dropPendingActor(room, deps, id)
        }
      } else if (phase.phase === 'guess') {
        for (const id of [...room.pendingActors]) dropPendingActor(room, deps, id)
      } else if (phase.phase === 'missing') {
        expect(phase).toMatchObject({ authorId: 'player-2', blank: true })
        const at = room.pictureIndex
        vi.advanceTimersByTime(MISSING_PHASE_SEC * 1000)
        // on to the next picture, or the round's end
        const next: string = room.phase.phase
        expect(next === 'scores' || room.pictureIndex === at + 1).toBe(true)
      } else {
        vi.advanceTimersByTime(1_000)
      }
    }

    expect(phases.filter((p) => p.authorId === 'player-2').map((p) => p.phase)).toEqual(['missing'])
    expect(phases.filter((p) => p.phase === 'missing')).toEqual([
      { phase: 'missing', authorId: 'player-2', blank: true, runsMs: MISSING_PHASE_SEC * 1000 },
    ])
    expect(room.shownThisRound.sort()).toEqual(['player-1', 'player-3'])
    // held but blank: not a picture that went unshown
    const audit = auditRound(room, deps)
    expect(audit.blank).toEqual(['player-2'])
    expect(audit.placeholders).toEqual([])
    expect(roundAuditProblem(audit)).toBeNull()
    expect(errors).toEqual([])
  })

  it('a picture that never arrived is still plain missing', () => {
    const room = createRoom('MISS')
    seatPlayers(room, 3)
    const deps: PhaseMachineDeps = {
      prompts: () => ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
      hasSubmission: (_code, _round, id) => id !== 'player-2',
      isBlank: () => false,
      onSnapshot: () => {},
      random: () => 0.99,
    }
    startBuild(room, deps)
    vi.advanceTimersByTime((PROMPT_WINDOW_SEC + 60 + BUILD_GRACE_SEC) * 1000)
    expect(room.pictureQueue.find((s) => s.authorId === 'player-2')).toEqual({ authorId: 'player-2', hasPicture: false, blank: false })
  })

  it('gallery: never up for a vote', () => {
    const { room } = setup('gallery')
    if (room.phase.phase !== 'vote') throw new Error(`expected vote, got ${room.phase.phase}`)
    expect(room.phase.pictures.find((p) => p.authorId === 'player-2')?.imagePath).toBeNull()
    expect(votablePictures(room, 'player-1')).toEqual(['player-3'])
  })
})
