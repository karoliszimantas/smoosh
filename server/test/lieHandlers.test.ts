import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PROMPT_WINDOW_SEC, BUILD_GRACE_SEC, type AckResult } from '@smoosh/protocol'
import { createAndRegisterRoom, deleteRoom, type Room, type Seat } from '../src/rooms/Room.ts'
import { startBuild, type PhaseMachineDeps } from '../src/game/phaseMachine.ts'
import { registerLieHandlers } from '../src/handlers/lieHandlers.ts'
import type { TypedServer, TypedSocket } from '../src/handlers/context.ts'

const TRUTH = 'Vampire Bunny Hotel Reception'

function makeSeat(n: number): Seat {
  return {
    sessionId: `session-${n}`,
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

// a registered room past its build, on the first picture's lie, with that
// picture's real prompt pinned to TRUTH
function roomInLie(): { room: Room; deps: PhaseMachineDeps; liars: [string, string]; pictureIndex: number } {
  const room = createAndRegisterRoom()
  room.settings = { ...room.settings, buildTimeSec: 60, answerTimeSec: 120, mode: 'guess', prompted: true }
  for (let i = 1; i <= 4; i++) {
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
  room.promptByPlayer.set(room.phase.authorId, TRUTH)
  const [first, second] = room.pendingActors
  if (!first || !second) throw new Error('expected two liars')
  return { room, deps, liars: [first, second], pictureIndex: room.phase.pictureIndex }
}

// what a player's socket gets back for one lie:submit
function submitLie(room: Room, deps: PhaseMachineDeps, playerId: string, pictureIndex: number, text: string): AckResult {
  let handler: ((payload: unknown, cb: (r: AckResult) => void) => void) | undefined
  const socket = {
    data: { sessionId: room.seats.get(playerId)!.sessionId, roomCode: room.code },
    on: (event: string, fn: typeof handler) => {
      if (event === 'lie:submit') handler = fn
    },
  } as unknown as TypedSocket
  registerLieHandlers({} as TypedServer, socket, deps)
  let result: AckResult | undefined
  handler!({ pictureIndex, text }, (r) => (result = r))
  return result!
}

let room: Room | undefined

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  if (room) deleteRoom(room.code)
  room = undefined
  vi.useRealTimers()
})

describe('lie:submit refusals', () => {
  const rejected = { ok: false, code: 'LIE_REJECTED', message: 'Try a different fake' }

  it('a lie equal to the real prompt, any case or spacing, gets the neutral refusal', () => {
    const s = roomInLie()
    room = s.room
    expect(submitLie(s.room, s.deps, s.liars[0], s.pictureIndex, TRUTH)).toEqual(rejected)
    expect(submitLie(s.room, s.deps, s.liars[0], s.pictureIndex, '  vampire   BUNNY hotel reception ')).toEqual(rejected)
  })

  it('a lie someone else already wrote gets the very same refusal', () => {
    const s = roomInLie()
    room = s.room
    expect(submitLie(s.room, s.deps, s.liars[0], s.pictureIndex, 'Grumpy Cat Diner')).toEqual({ ok: true, data: undefined })
    expect(submitLie(s.room, s.deps, s.liars[1], s.pictureIndex, ' grumpy cat  diner')).toEqual(rejected)
  })

  it('the refusal never carries the real prompt', () => {
    const s = roomInLie()
    room = s.room
    const reply = submitLie(s.room, s.deps, s.liars[0], s.pictureIndex, TRUTH.toUpperCase())
    expect(JSON.stringify(reply).toLowerCase()).not.toContain(TRUTH.toLowerCase())
  })
})
