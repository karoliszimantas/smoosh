import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PROMPT_WINDOW_SEC, BUILD_GRACE_SEC, type AckResult } from '@smoosh/protocol'
import { createAndRegisterRoom, deleteRoom, type Room, type Seat } from '../src/rooms/Room.ts'
import { dropPendingActor, recordLie, startBuild, type PhaseMachineDeps } from '../src/game/phaseMachine.ts'
import { registerGuessHandlers } from '../src/handlers/guessHandlers.ts'
import type { TypedServer, TypedSocket } from '../src/handlers/context.ts'

function makeSeat(n: number): Seat {
  return {
    sessionId: `reveal-session-${n}`,
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

// a registered room on the first picture's reveal, after everyone wrote a
// fake and nobody guessed
function roomInReveal(): { room: Room; deps: PhaseMachineDeps } {
  const room = createAndRegisterRoom()
  room.settings = { ...room.settings, buildTimeSec: 60, answerTimeSec: 120, mode: 'guess', prompted: true }
  for (let i = 1; i <= 3; i++) {
    const seat = makeSeat(i)
    room.seats.set(seat.playerId, seat)
  }
  const deps: PhaseMachineDeps = {
    prompts: () => ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'],
    hasSubmission: () => true,
    onSnapshot: vi.fn(),
  }
  startBuild(room, deps)
  vi.advanceTimersByTime((PROMPT_WINDOW_SEC + 60 + BUILD_GRACE_SEC) * 1000)
  if (room.phase.phase !== 'lie') throw new Error(`expected lie, got ${room.phase.phase}`)
  for (const id of [...room.pendingActors]) {
    recordLie(room, room.phase.pictureIndex, id, `fake by ${id}`)
    dropPendingActor(room, deps, id)
  }
  for (const id of [...room.pendingActors]) dropPendingActor(room, deps, id)
  const phase: string = room.phase.phase
  if (phase !== 'reveal') throw new Error(`expected reveal, got ${phase}`)
  return { room, deps }
}

// what a player's socket gets back for one reveal:next
function next(room: Room, deps: PhaseMachineDeps, playerId: string, payload: unknown): AckResult {
  let handler: ((payload: unknown, cb: (r: AckResult) => void) => void) | undefined
  const socket = {
    data: { sessionId: room.seats.get(playerId)!.sessionId, roomCode: room.code },
    on: (event: string, fn: typeof handler) => {
      if (event === 'reveal:next') handler = fn
    },
  } as unknown as TypedSocket
  registerGuessHandlers({} as TypedServer, socket, deps)
  let result: AckResult | undefined
  handler!(payload, (r) => (result = r))
  return result!
}

const pictureIndexOf = (room: Room) => ('pictureIndex' in room.phase ? room.phase.pictureIndex : null)

let room: Room | undefined

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  if (room) deleteRoom(room.code)
  room = undefined
  vi.useRealTimers()
})

describe('reveal:next', () => {
  it('from the host: on to the next picture at once', () => {
    const s = roomInReveal()
    room = s.room
    expect(next(s.room, s.deps, 'player-1', { pictureIndex: 0 })).toEqual({ ok: true, data: undefined })
    expect(s.room.phase.phase).toBe('lie')
    expect(pictureIndexOf(s.room)).toBe(1)
  })

  it('from anyone else: refused, and the reveal runs on', () => {
    const s = roomInReveal()
    room = s.room
    expect(next(s.room, s.deps, 'player-2', { pictureIndex: 0 })).toMatchObject({ ok: false, code: 'NOT_HOST' })
    expect(s.room.phase.phase).toBe('reveal')
    expect(pictureIndexOf(s.room)).toBe(0)
  })

  it('a stale tap, for a picture already gone, is refused and skips nothing', () => {
    const s = roomInReveal()
    room = s.room
    expect(next(s.room, s.deps, 'player-1', { pictureIndex: 0 }).ok).toBe(true)
    // the same tap again, now that picture 1 is up
    expect(next(s.room, s.deps, 'player-1', { pictureIndex: 0 })).toMatchObject({ ok: false, code: 'PHASE_MISMATCH' })
    expect(s.room.phase.phase).toBe('lie')
    expect(pictureIndexOf(s.room)).toBe(1)
  })

  it('a tap for the wrong picture during a reveal is refused too', () => {
    const s = roomInReveal()
    room = s.room
    expect(next(s.room, s.deps, 'player-1', { pictureIndex: 1 })).toMatchObject({ ok: false, code: 'PHASE_MISMATCH' })
    expect(s.room.phase.phase).toBe('reveal')
  })

  it('a malformed payload is refused', () => {
    const s = roomInReveal()
    room = s.room
    expect(next(s.room, s.deps, 'player-1', { pictureIndex: -1 })).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    expect(s.room.phase.phase).toBe('reveal')
  })

  it('leaves no stray timer behind: the next picture runs its full time', () => {
    const s = roomInReveal()
    room = s.room
    next(s.room, s.deps, 'player-1', { pictureIndex: 0 })
    vi.advanceTimersByTime(s.room.settings.answerTimeSec * 1000 - 1)
    expect(s.room.phase.phase).toBe('lie')
    expect(pictureIndexOf(s.room)).toBe(1)
  })
})
