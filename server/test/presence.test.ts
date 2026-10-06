import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BUILD_GRACE_SEC, MAX_PLAYERS, PROMPT_WINDOW_SEC, type GameSettings, type PhaseState, type RoomEvent } from '@smoosh/protocol'
import { resolveSeat } from '../src/rooms/seats.ts'
import { createRoom, type Room, type Seat } from '../src/rooms/Room.ts'
import {
  seatArrived,
  seatAway,
  seatLeft,
  dealIn,
  enterLobby,
  EMPTY_ROOM_HOLD_MS,
  HOST_AWAY_GRACE_MS,
  LOBBY_SEAT_HOLD_MS,
  type PresenceDeps,
  AWAY_RESPONSE_GRACE_MS,
} from '../src/rooms/presence.ts'
import {
  startBuild,
  dropPendingActor,
  recordGuess,
  optionsForPicture,
  acceptSubmission,
} from '../src/game/phaseMachine.ts'
import { buildSnapshot } from '../src/snapshot.ts'

// Leaving is deliberate; everything else is being away, and an away player
// keeps their seat. Pure room logic on fake timers — no sockets.

// a 60s build, after the prompt window nobody here taps through
const BUILD_MS = (PROMPT_WINDOW_SEC + 60) * 1000
const ANSWER_MS = 120_000

type Harness = {
  room: Room
  deps: PresenceDeps
  events: { event: RoomEvent; to: string | undefined }[]
  disposed: () => boolean
  seat: (n: number) => Seat
  submitted: Set<string>
}

function setup(players = 4, rounds = 2, phase: 'lobby' | 'game' = 'game'): Harness {
  const room = createRoom('TEST')
  room.settings = { rounds, buildTimeSec: 60, answerTimeSec: 120, mode: 'guess', prompted: true } as GameSettings
  const submitted = new Set<string>()
  const events: Harness['events'] = []
  let disposed = false
  const deps: PresenceDeps = {
    prompts: () => Array.from({ length: 50 }, (_, i) => `prompt ${i}`),
    hasSubmission: (_code, round, playerId) => submitted.has(`${round}:${playerId}`),
    onSnapshot: () => {},
    onEvent: (_room, event, to) => events.push({ event, to }),
    dispose: () => {
      disposed = true
    },
  }
  for (let n = 1; n <= players; n++) {
    const seat: Seat = {
      sessionId: `session-${n}`,
      playerId: `player-${n}`,
      name: `P${n}`,
      isHost: n === 1,
      presence: 'away',
      socketId: null,
      score: 0,
      joinedAt: n,
      presentSince: n,
      awayFrom: null,
    }
    room.seats.set(seat.playerId, seat)
    seatArrived(room, deps, seat, `socket-${n}`)
    // seatArrived stamps "now"; keep join order as presence order
    seat.presentSince = n
  }
  if (phase === 'game') startBuild(room, deps)
  return {
    room,
    deps,
    events,
    disposed: () => disposed,
    seat: (n) => {
      const s = room.seats.get(`player-${n}`)
      if (!s) throw new Error(`no seat ${n}`)
      return s
    },
    submitted,
  }
}

function expectPhase<T extends PhaseState['phase']>(room: Room, phase: T): Extract<PhaseState, { phase: T }> {
  if (room.phase.phase !== phase) throw new Error(`expected phase "${phase}", got "${room.phase.phase}"`)
  return room.phase as Extract<PhaseState, { phase: T }>
}

// everyone present submits, BUILD closes, and the first picture is up
function buildToLie(h: Harness): void {
  for (const seat of h.room.seats.values()) {
    if (seat.presence !== 'present') continue
    h.submitted.add(`${h.room.round}:${seat.playerId}`)
    dropPendingActor(h.room, h.deps, seat.playerId)
  }
  if (h.room.phase.phase === 'build') vi.advanceTimersByTime(BUILD_MS + BUILD_GRACE_SEC * 1000)
}

function actAll(h: Harness): void {
  for (const id of [...h.room.pendingActors]) {
    if (h.room.phase.phase === 'guess') {
      const option = optionsForPicture(h.room, h.room.pictureIndex).find((o) => o.authorId !== id)
      if (option) recordGuess(h.room, h.room.pictureIndex, id, option.id)
    }
    dropPendingActor(h.room, h.deps, id)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('away', () => {
  it('keeps the seat and score', () => {
    const h = setup()
    h.seat(2).score = 1500
    seatAway(h.room, h.deps, h.seat(2))
    expect(h.seat(2).presence).toBe('away')
    expect(h.seat(2).score).toBe(1500)
  })

  it('after BUILD, the room stops waiting on them once they have been away 4 seconds', () => {
    const h = setup()
    buildToLie(h)
    actAll(h) // -> guess
    const { pictureIndex } = expectPhase(h.room, 'guess')
    const [absent, ...rest] = [...h.room.pendingActors]
    if (!absent) throw new Error('no guessers')
    const seat = h.room.seats.get(absent)
    if (!seat) throw new Error('no seat')
    seatAway(h.room, h.deps, seat)
    // a blip isn't a departure: still expected for a moment
    expect(h.room.pendingActors.has(absent)).toBe(true)
    vi.advanceTimersByTime(AWAY_RESPONSE_GRACE_MS)
    expect(h.room.pendingActors.has(absent)).toBe(false)
    // everyone still here guesses: on to the reveal, without the away player
    for (const id of rest) {
      const option = optionsForPicture(h.room, pictureIndex).find((o) => o.authorId !== id)
      if (option) recordGuess(h.room, pictureIndex, id, option.id)
      dropPendingActor(h.room, h.deps, id)
    }
    expectPhase(h.room, 'reveal')
  })

  it('an away player who comes back mid-phase is expected again and can act', () => {
    const h = setup()
    buildToLie(h)
    actAll(h) // -> guess
    const { authorId } = expectPhase(h.room, 'guess')
    const guesser = [...h.room.pendingActors][0]
    if (!guesser) throw new Error('no guesser')
    const seat = h.room.seats.get(guesser)
    if (!seat) throw new Error('no seat')

    seatAway(h.room, h.deps, seat)
    vi.advanceTimersByTime(AWAY_RESPONSE_GRACE_MS)
    expect(h.room.pendingActors.has(guesser)).toBe(false)
    seatArrived(h.room, h.deps, seat, 'socket-new')
    // never "already guessed" for a guess they didn't make
    expect(h.room.pendingActors.has(guesser)).toBe(true)
    expect(authorId).not.toBe(guesser)
  })

  it('a 2-second drop mid-guess: still expected throughout, and their guess counts', () => {
    const h = setup()
    buildToLie(h)
    actAll(h) // -> guess
    const { pictureIndex } = expectPhase(h.room, 'guess')
    const [blip, ...rest] = [...h.room.pendingActors]
    if (!blip) throw new Error('no guessers')
    const seat = h.room.seats.get(blip)
    if (!seat) throw new Error('no seat')
    // everyone else has guessed — the only one left is the one who drops
    for (const id of rest) {
      const option = optionsForPicture(h.room, pictureIndex).find((o) => o.authorId !== id)
      if (option) recordGuess(h.room, pictureIndex, id, option.id)
      dropPendingActor(h.room, h.deps, id)
    }
    seatAway(h.room, h.deps, seat)
    vi.advanceTimersByTime(2000)
    expectPhase(h.room, 'guess') // not moved on without them
    seatArrived(h.room, h.deps, seat, 'socket-back')
    vi.advanceTimersByTime(5000) // the old grace timer must not fire
    expect(h.room.pendingActors.has(blip)).toBe(true)
    const option = optionsForPicture(h.room, pictureIndex).find((o) => o.authorId !== blip)
    if (option) recordGuess(h.room, pictureIndex, blip, option.id)
    dropPendingActor(h.room, h.deps, blip)
    expectPhase(h.room, 'reveal')
  })

  it('a reload after guessing: the snapshot says so, and which option it was', () => {
    const h = setup()
    buildToLie(h)
    actAll(h) // -> guess
    const { pictureIndex } = expectPhase(h.room, 'guess')
    const [guesser] = [...h.room.pendingActors]
    const seat = guesser ? h.room.seats.get(guesser) : undefined
    if (!guesser || !seat) throw new Error('no guesser')
    const option = optionsForPicture(h.room, pictureIndex).find((o) => o.authorId !== guesser)
    if (!option) throw new Error('no option')
    recordGuess(h.room, pictureIndex, guesser, option.id)
    dropPendingActor(h.room, h.deps, guesser)
    // the reload: gone, back
    seatAway(h.room, h.deps, seat)
    seatArrived(h.room, h.deps, seat, 'socket-reloaded')
    const you = buildSnapshot(h.room, seat).you
    expect(you.hasActedThisPhase).toBe(true)
    expect(you.ownGuessId).toBe(option.id)
    // and not waited on again for a guess already counted
    expect(h.room.pendingActors.has(guesser)).toBe(false)
  })

    it('a 10-second drop: the phase goes on without them', () => {
    const h = setup()
    buildToLie(h)
    actAll(h) // -> guess
    const { pictureIndex } = expectPhase(h.room, 'guess')
    const [gone, ...rest] = [...h.room.pendingActors]
    if (!gone) throw new Error('no guessers')
    for (const id of rest) {
      const option = optionsForPicture(h.room, pictureIndex).find((o) => o.authorId !== id)
      if (option) recordGuess(h.room, pictureIndex, id, option.id)
      dropPendingActor(h.room, h.deps, id)
    }
    const seat = h.room.seats.get(gone)
    if (!seat) throw new Error('no seat')
    seatAway(h.room, h.deps, seat)
    vi.advanceTimersByTime(10_000)
    expectPhase(h.room, 'reveal')
  })

  it('coming back after already acting does not make them pending again', () => {
    const h = setup()
    h.submitted.add('1:player-2')
    dropPendingActor(h.room, h.deps, 'player-2')
    seatAway(h.room, h.deps, h.seat(2))
    seatArrived(h.room, h.deps, h.seat(2), 'socket-new')
    expect(h.room.pendingActors.has('player-2')).toBe(false)
  })

  it('in the lobby the seat is held too', () => {
    const h = setup(4, 2, 'lobby')
    seatAway(h.room, h.deps, h.seat(3))
    expect(h.room.seats.has('player-3')).toBe(true)
  })

  it('tells a returning player what they missed', () => {
    const h = setup(3, 2)
    seatAway(h.room, h.deps, h.seat(3))
    // the others play round 1 out and get into round 2
    buildToLie(h)
    for (let i = 0; i < 40 && !(h.room.phase.phase === 'build' && h.room.round === 2); i++) {
      actAll(h)
      vi.advanceTimersByTime(10_000)
    }
    expectPhase(h.room, 'build')
    h.events.length = 0
    seatArrived(h.room, h.deps, h.seat(3), 'socket-new')
    const caughtUp = h.events.find((e) => e.event.type === 'caughtUp')
    expect(caughtUp?.to).toBe('player-3')
    expect(caughtUp?.event).toMatchObject({ type: 'caughtUp', roundsFinished: 1, playerCount: 3 })
  })

  it('says nothing to a player back before anything moved on', () => {
    const h = setup()
    seatAway(h.room, h.deps, h.seat(2))
    seatArrived(h.room, h.deps, h.seat(2), 'socket-new')
    expect(h.events.filter((e) => e.event.type === 'caughtUp')).toEqual([])
  })
})

describe('BUILD waits for away players', () => {
  // everyone here submits; `except` stays away and doesn't
  function othersSubmit(h: Harness, except: number[]): void {
    for (const seat of h.room.seats.values()) {
      const n = Number(seat.playerId.split('-')[1])
      if (except.includes(n)) continue
      h.submitted.add(`${h.room.round}:${seat.playerId}`)
      dropPendingActor(h.room, h.deps, seat.playerId)
    }
  }

  it('a player away from the start does not let it end early, and can still submit when back', () => {
    const h = setup()
    seatAway(h.room, h.deps, h.seat(4))
    othersSubmit(h, [4])
    expectPhase(h.room, 'build')
    expect(h.room.pendingActors).toEqual(new Set(['player-4']))

    // back with seconds to spare, like 80s into a 90s build
    vi.advanceTimersByTime(BUILD_MS - 10_000)
    expectPhase(h.room, 'build')
    seatArrived(h.room, h.deps, h.seat(4), 'socket-back')
    const result = acceptSubmission(h.room, h.deps, 'player-4', 1, () => h.submitted.add('1:player-4'))
    expect(result).toEqual({ ok: true })
    // every picture is in: on to the first picture
    expectPhase(h.room, 'lie')
    expect(h.room.pictureQueue.every((slot) => slot.hasPicture)).toBe(true)
  })

  it('everyone submitting before the deadline still ends it early', () => {
    const h = setup()
    othersSubmit(h, [])
    expectPhase(h.room, 'lie')
  })

  it('an away player who never comes back: it runs to the deadline and grace, then they get a placeholder', () => {
    const h = setup()
    seatAway(h.room, h.deps, h.seat(3))
    othersSubmit(h, [3])
    vi.advanceTimersByTime(BUILD_MS - 1)
    expect(expectPhase(h.room, 'build').collecting).toBe(false)
    vi.advanceTimersByTime(1)
    expect(expectPhase(h.room, 'build').collecting).toBe(true)
    vi.advanceTimersByTime(BUILD_GRACE_SEC * 1000)
    expect(h.room.phase.phase).not.toBe('build')
    expect(h.room.pictureQueue.find((slot) => slot.authorId === 'player-3')).toEqual({
      authorId: 'player-3',
      hasPicture: false,
    })
  })

  it('a player back during the grace window still gets their picture in', () => {
    const h = setup()
    seatAway(h.room, h.deps, h.seat(2))
    othersSubmit(h, [2])
    vi.advanceTimersByTime(BUILD_MS + 1000)
    expect(expectPhase(h.room, 'build').collecting).toBe(true)
    seatArrived(h.room, h.deps, h.seat(2), 'socket-back')
    acceptSubmission(h.room, h.deps, 'player-2', 1, () => h.submitted.add('1:player-2'))
    expectPhase(h.room, 'lie')
    expect(h.room.pictureQueue.find((slot) => slot.authorId === 'player-2')?.hasPicture).toBe(true)
  })

  it('leaving is not being away: a player who leaves is not waited for', () => {
    const h = setup()
    othersSubmit(h, [4])
    seatLeft(h.room, h.deps, h.seat(4))
    expectPhase(h.room, 'lie')
  })

  it('a room that empties and refills mid-BUILD still waits for whoever is still away', () => {
    const h = setup()
    othersSubmit(h, [3, 4])
    for (const n of [1, 2, 3, 4]) seatAway(h.room, h.deps, h.seat(n))
    seatArrived(h.room, h.deps, h.seat(1), 'socket-back')
    expectPhase(h.room, 'build')
    expect(h.room.pendingActors).toEqual(new Set(['player-3', 'player-4']))
  })
})

describe('lobby seats', () => {
  it('an away player keeps their seat for 60 seconds, then it is released', () => {
    const h = setup(4, 2, 'lobby')
    seatAway(h.room, h.deps, h.seat(3))
    vi.advanceTimersByTime(LOBBY_SEAT_HOLD_MS - 1)
    expect(h.room.seats.get('player-3')?.presence).toBe('away')
    vi.advanceTimersByTime(1)
    expect(h.room.seats.has('player-3')).toBe(false)
  })

  it('back within 60 seconds keeps the seat', () => {
    const h = setup(4, 2, 'lobby')
    seatAway(h.room, h.deps, h.seat(3))
    vi.advanceTimersByTime(LOBBY_SEAT_HOLD_MS - 1000)
    seatArrived(h.room, h.deps, h.seat(3), 'socket-back')
    vi.advanceTimersByTime(LOBBY_SEAT_HOLD_MS * 2)
    expect(h.room.seats.get('player-3')?.presence).toBe('present')
  })

  it('a released seat frees the slot, and the player can join again with the code', () => {
    const h = setup(MAX_PLAYERS, 2, 'lobby')
    expect(() => resolveSeat(h.room, 'session-new', 'New', true)).toThrow(/full/)
    seatAway(h.room, h.deps, h.seat(5))
    vi.advanceTimersByTime(LOBBY_SEAT_HOLD_MS)
    expect(resolveSeat(h.room, 'session-new', 'New', true).name).toBe('New')
    // the released player comes back as anyone would — a new seat, room permitting
    seatLeft(h.room, h.deps, [...h.room.seats.values()].find((s) => s.sessionId === 'session-new') ?? h.seat(1))
    const again = resolveSeat(h.room, 'session-5', 'P5', true)
    expect(again.playerId).not.toBe('player-5')
  })

  it('a released host hands the role on', () => {
    const h = setup(4, 2, 'lobby')
    seatAway(h.room, h.deps, h.seat(1))
    vi.advanceTimersByTime(LOBBY_SEAT_HOLD_MS)
    expect(h.room.seats.has('player-1')).toBe(false)
    expect([...h.room.seats.values()].filter((s) => s.isHost)).toHaveLength(1)
  })

  it('a player away when the game starts is not dealt in: no seat, no score, no placeholder', () => {
    const h = setup(4, 2, 'lobby')
    seatAway(h.room, h.deps, h.seat(4))
    dealIn(h.room, h.deps)
    startBuild(h.room, h.deps)
    expect(h.room.seats.has('player-4')).toBe(false)
    expect(h.room.promptByPlayer.has('player-4')).toBe(false)
    buildToLie(h)
    expect(h.room.pictureQueue.map((slot) => slot.authorId).sort()).toEqual(['player-1', 'player-2', 'player-3'])
  })

  it('once the game is on, away seats are held for good', () => {
    const h = setup()
    seatAway(h.room, h.deps, h.seat(4))
    vi.advanceTimersByTime(LOBBY_SEAT_HOLD_MS * 10)
    expect(h.room.seats.get('player-4')?.presence).toBe('away')
  })

  it('back in the lobby after a game, away players get the lobby’s 60 seconds', () => {
    const h = setup()
    seatAway(h.room, h.deps, h.seat(4))
    h.room.phase = { phase: 'lobby' }
    enterLobby(h.room, h.deps)
    vi.advanceTimersByTime(LOBBY_SEAT_HOLD_MS)
    expect(h.room.seats.has('player-4')).toBe(false)
  })
})

describe('leaving', () => {
  it('mid-phase: out of the count, and the room moves on immediately', () => {
    const h = setup()
    for (const n of [1, 2, 3]) {
      h.submitted.add(`1:player-${n}`)
      dropPendingActor(h.room, h.deps, `player-${n}`)
    }
    expectPhase(h.room, 'build')
    seatLeft(h.room, h.deps, h.seat(4))
    expect(h.room.phase.phase).not.toBe('build')
    expect(h.seat(4).presence).toBe('left')
    expect(h.events.map((e) => e.event)).toContainEqual({ type: 'left', playerId: 'player-4', name: 'P4' })
  })

  it('keeps their score, and they can come back with the room code', () => {
    const h = setup()
    h.seat(2).score = 700
    seatLeft(h.room, h.deps, h.seat(2))
    seatArrived(h.room, h.deps, h.seat(2), 'socket-again')
    expect(h.seat(2).presence).toBe('present')
    expect(h.seat(2).score).toBe(700)
    expect(h.room.pendingActors.has('player-2')).toBe(true)
  })

  it('in the lobby: the seat goes', () => {
    const h = setup(4, 2, 'lobby')
    seatLeft(h.room, h.deps, h.seat(3))
    expect(h.room.seats.has('player-3')).toBe(false)
  })

  it('a player who left and sent nothing gets no placeholder; one who sent a picture is still shown', () => {
    const h = setup(4)
    h.submitted.add('1:player-3')
    seatLeft(h.room, h.deps, h.seat(3))
    seatLeft(h.room, h.deps, h.seat(4))
    buildToLie(h)
    const authors = h.room.pictureQueue.map((s) => s.authorId).sort()
    expect(authors).toEqual(['player-1', 'player-2', 'player-3'])
  })
})

describe('host', () => {
  it('leaving hands the role to the longest-present player, and the room is told', () => {
    const h = setup()
    // 2 and 4 came back recently; 3 has been here longest
    h.seat(2).presentSince = 50
    h.seat(3).presentSince = 10
    h.seat(4).presentSince = 60
    seatLeft(h.room, h.deps, h.seat(1))
    expect(h.seat(3).isHost).toBe(true)
    expect(h.events.map((e) => e.event)).toContainEqual({ type: 'hostChanged', playerId: 'player-3', name: 'P3' })
  })

  it('the old host coming back does not take it back', () => {
    const h = setup()
    seatLeft(h.room, h.deps, h.seat(1))
    seatArrived(h.room, h.deps, h.seat(1), 'socket-again')
    expect(h.seat(1).isHost).toBe(false)
    expect(h.seat(2).isHost).toBe(true)
  })

  it('a host away briefly (a reload) stays host', () => {
    const h = setup()
    seatAway(h.room, h.deps, h.seat(1))
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS - 1000)
    seatArrived(h.room, h.deps, h.seat(1), 'socket-new')
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS)
    expect(h.seat(1).isHost).toBe(true)
    expect(h.events.filter((e) => e.event.type === 'hostChanged')).toEqual([])
  })

  it('a host away for a while hands it on', () => {
    const h = setup()
    seatAway(h.room, h.deps, h.seat(1))
    vi.advanceTimersByTime(HOST_AWAY_GRACE_MS)
    expect(h.seat(1).isHost).toBe(false)
    expect(h.seat(2).isHost).toBe(true)
  })

  it('whoever comes back first takes the role if the host left while nobody was here', () => {
    const h = setup(3)
    for (const n of [2, 3]) seatAway(h.room, h.deps, h.seat(n))
    seatLeft(h.room, h.deps, h.seat(1))
    expect([...h.room.seats.values()].some((s) => s.isHost)).toBe(false)
    seatArrived(h.room, h.deps, h.seat(3), 'socket-back')
    expect(h.seat(3).isHost).toBe(true)
  })
})

describe('empty rooms', () => {
  it('everyone away: the clock stops and the room is held for 10 minutes', () => {
    const h = setup()
    for (const n of [1, 2, 3, 4]) seatAway(h.room, h.deps, h.seat(n))
    // their prompt windows closed as they went: 60s of build each, from now
    const deadline = expectPhase(h.room, 'build').deadline
    vi.advanceTimersByTime(EMPTY_ROOM_HOLD_MS - 60_000)
    // the game didn't play on without them
    expectPhase(h.room, 'build')
    expect(h.disposed()).toBe(false)

    seatArrived(h.room, h.deps, h.seat(2), 'socket-back')
    // the clock picks up where it stopped
    expect(expectPhase(h.room, 'build').deadline).toBe(deadline + EMPTY_ROOM_HOLD_MS - 60_000)
    vi.advanceTimersByTime(60_000 - 1)
    expectPhase(h.room, 'build')
    vi.advanceTimersByTime(EMPTY_ROOM_HOLD_MS) // well past: no disposal now someone is back
    expect(h.disposed()).toBe(false)
  })

  it('everyone away for 10 minutes: the room is disposed', () => {
    const h = setup()
    for (const n of [1, 2, 3, 4]) seatAway(h.room, h.deps, h.seat(n))
    vi.advanceTimersByTime(EMPTY_ROOM_HOLD_MS)
    expect(h.disposed()).toBe(true)
  })

  it('everyone chose to leave: disposed at once', () => {
    const h = setup()
    for (const n of [1, 2, 3, 4]) seatLeft(h.room, h.deps, h.seat(n))
    expect(h.disposed()).toBe(true)
  })

  it('some left, the rest away: held, like any empty room', () => {
    const h = setup()
    seatLeft(h.room, h.deps, h.seat(1))
    for (const n of [2, 3, 4]) seatAway(h.room, h.deps, h.seat(n))
    expect(h.disposed()).toBe(false)
    vi.advanceTimersByTime(EMPTY_ROOM_HOLD_MS)
    expect(h.disposed()).toBe(true)
  })

  it('the last one going does not end the phase they were holding up', () => {
    const h = setup()
    for (const n of [1, 2, 3]) {
      h.submitted.add(`1:player-${n}`)
      dropPendingActor(h.room, h.deps, `player-${n}`)
    }
    for (const n of [1, 2, 3, 4]) seatAway(h.room, h.deps, h.seat(n))
    expectPhase(h.room, 'build')
  })

  it('a phase that starts while the room is empty starts with its clock stopped', () => {
    const h = setup()
    for (const n of [1, 2, 3]) {
      h.submitted.add(`1:player-${n}`)
      dropPendingActor(h.room, h.deps, `player-${n}`)
    }
    for (const n of [1, 2, 3, 4]) seatAway(h.room, h.deps, h.seat(n))
    // player 4's phone sends its picture from the background: BUILD ends
    acceptSubmission(h.room, h.deps, 'player-4', 1, () => h.submitted.add('1:player-4'))
    expectPhase(h.room, 'lie')
    vi.advanceTimersByTime(ANSWER_MS * 2)
    expectPhase(h.room, 'lie')
  })

  it('on return, whoever is still gone is not waited on', () => {
    const h = setup()
    buildToLie(h)
    const { authorId } = expectPhase(h.room, 'lie')
    for (const n of [1, 2, 3, 4]) seatAway(h.room, h.deps, h.seat(n))
    // the author comes back: nobody else here to write a lie, so on it goes
    const author = h.room.seats.get(authorId)
    if (!author) throw new Error('no author')
    seatArrived(h.room, h.deps, author, 'socket-back')
    expectPhase(h.room, 'guess')
  })
})
