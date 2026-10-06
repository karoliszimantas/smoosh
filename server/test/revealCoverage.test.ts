import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BUILD_GRACE_SEC, type GameSettings } from '@smoosh/protocol'
import { createRoom, type Room, type Seat } from '../src/rooms/Room.ts'
import {
  startBuild,
  acceptSubmission,
  dropPendingActor,
  recordLie,
  recordGuess,
  recordVote,
  votablePictures,
  optionsForPicture,
  type PhaseMachineDeps,
} from '../src/game/phaseMachine.ts'

// every submitted picture must be shown exactly once per round — whatever the
// player count, round count, mode, or when during BUILD the upload lands.
// Pure logic: the real phase machine on fake timers, players simulated by a
// seeded RNG, no sockets.

const BUILD_SEC = 60
const ANSWER_SEC = 120
const GRACE_MS = BUILD_GRACE_SEC * 1000

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeSeat(n: number): Seat {
  return {
    sessionId: `session-${n}`,
    playerId: `player-${n}`,
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

function makeRoom(players: number, rounds: number, mode: GameSettings['mode']): Room {
  const room = createRoom('TEST')
  // off-menu values are fine here: the phase machine doesn't check them
  room.settings = {
    rounds,
    buildTimeSec: BUILD_SEC,
    answerTimeSec: ANSWER_SEC,
    mode,
    prompted: true,
  } as GameSettings
  for (let i = 1; i <= players; i++) {
    const seat = makeSeat(i)
    room.seats.set(seat.playerId, seat)
  }
  return room
}

// when a player's upload reaches the server, relative to the BUILD deadline
// (ms; negative = before it). null = this player never uploads.
type UploadPlan = (round: number, playerId: string, rng: () => number) => number | null

type GameLog = {
  players: string[]
  rounds: number
  // round -> player -> upload offset from the deadline, for uploads that
  // reached the server
  uploaded: Map<number, Map<string, number>>
  // round -> players whose upload the server refused
  rejected: Map<number, Set<string>>
  // round -> authors whose picture was put in front of the others, in order
  shown: Map<number, string[]>
  // round -> players who came up as "picture missing"
  placeholders: Map<number, string[]>
  // what the server logged as an error (the end-of-round invariant)
  errors: unknown[][]
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key) ?? []
  list.push(value)
  map.set(key, list)
}

function playGame(opts: {
  players: number
  rounds: number
  mode: GameSettings['mode']
  seed: number
  upload: UploadPlan
  // runs once, as round 1's first picture comes up — for breaking things
  tamper?: (room: Room, store: Set<string>) => void
}): GameLog {
  const rng = mulberry32(opts.seed)
  const room = makeRoom(opts.players, opts.rounds, opts.mode)
  const store = new Set<string>()
  const log: GameLog = {
    players: [...room.seats.values()].map((s) => s.playerId),
    rounds: opts.rounds,
    uploaded: new Map(),
    rejected: new Map(),
    shown: new Map(),
    placeholders: new Map(),
    errors: [],
  }
  let tamper = opts.tamper

  const deps: PhaseMachineDeps = {
    prompts: () => Array.from({ length: 200 }, (_, i) => `prompt ${i}`),
    hasSubmission: (_code, round, playerId) => store.has(`${round}:${playerId}`),
    onSnapshot: (r) => onPhase(r),
    random: rng,
    log: { info: () => {}, warn: () => {}, error: (...args: unknown[]) => log.errors.push(args) },
  }

  let lastPhaseKey = ''
  function onPhase(r: Room): void {
    const phase = r.phase
    const key =
      phase.phase === 'build' || phase.phase === 'scores' || phase.phase === 'lobby' || phase.phase === 'vote' || phase.phase === 'awards'
        ? `${phase.phase}:${r.round}`
        : `${phase.phase}:${r.round}:${phase.pictureIndex}`
    if (key === lastPhaseKey) return
    lastPhaseKey = key

    if (phase.phase === 'build') planBuild(r.round)
    if ((phase.phase === 'lie' || phase.phase === 'vote' || phase.phase === 'missing') && tamper) {
      tamper(r, store)
      tamper = undefined
    }
    if (phase.phase === 'lie') push(log.shown, r.round, phase.authorId)
    if (phase.phase === 'missing') push(log.placeholders, r.round, phase.authorId)
    // gallery shows the whole round at once: a picture, or its placeholder
    if (phase.phase === 'vote') {
      for (const p of phase.pictures) push(p.imagePath ? log.shown : log.placeholders, r.round, p.authorId)
    }
    if (phase.phase === 'lie' || phase.phase === 'guess' || phase.phase === 'vote') planAnswers(key)
  }

  function planBuild(round: number): void {
    const deadlineAt = Date.now() + BUILD_SEC * 1000
    for (const seat of room.seats.values()) {
      const offset = opts.upload(round, seat.playerId, rng)
      if (offset === null) continue
      const at = Math.max(0, deadlineAt + offset - Date.now())
      setTimeout(() => {
        const uploaded = log.uploaded.get(round) ?? new Map<string, number>()
        uploaded.set(seat.playerId, offset)
        log.uploaded.set(round, uploaded)
        const result = acceptSubmission(room, deps, seat.playerId, round, () =>
          store.add(`${round}:${seat.playerId}`),
        )
        if (!result.ok) {
          const rejected = log.rejected.get(round) ?? new Set<string>()
          rejected.add(seat.playerId)
          log.rejected.set(round, rejected)
        }
      }, at)
    }
  }

  // each pending player answers at a random moment — some after the timer,
  // i.e. they idle out
  function planAnswers(key: string): void {
    for (const playerId of room.pendingActors) {
      const at = Math.floor(rng() * ANSWER_SEC * 1000 * 1.3)
      setTimeout(() => {
        if (key !== lastPhaseKey || !room.pendingActors.has(playerId)) return
        const phase = room.phase
        if (phase.phase === 'lie') recordLie(room, phase.pictureIndex, playerId, `lie ${playerId} ${key}`)
        if (phase.phase === 'guess') {
          const choices = optionsForPicture(room, phase.pictureIndex).filter((o) => o.authorId !== playerId)
          const pick = choices[Math.floor(rng() * choices.length)]
          if (pick) recordGuess(room, phase.pictureIndex, playerId, pick.id)
        }
        if (phase.phase === 'vote') {
          const choices = votablePictures(room, playerId)
          const favourite = choices[Math.floor(rng() * choices.length)]
          const rest = choices.filter((c) => c !== favourite)
          const runnerUp = rest[Math.floor(rng() * rest.length)] ?? null
          if (favourite) recordVote(room, playerId, favourite, runnerUp)
        }
        dropPendingActor(room, deps, playerId)
      }, at)
    }
  }

  startBuild(room, deps)
  vi.runAllTimers()
  expect(room.phase.phase === 'scores' && room.phase.isFinalRound).toBe(true)
  return log
}

// every upload that reached the server is shown exactly once in its round,
// and nothing else is
function expectEverySubmissionShownOnce(log: GameLog): void {
  for (let round = 1; round <= log.rounds; round++) {
    const uploaded = log.uploaded.get(round) ?? new Map<string, number>()
    const rejected = log.rejected.get(round) ?? new Set<string>()
    const accepted = [...uploaded.keys()].filter((id) => !rejected.has(id)).sort()
    const shown = [...(log.shown.get(round) ?? [])].sort()
    expect({ round, shown }).toEqual({ round, shown: accepted })
  }
}

// ...and on top of that: an upload is refused only when it lands after the
// grace window (and then always), every player comes up exactly once —
// picture or placeholder — and the server's invariant check stayed quiet
function expectEveryPlayerAccountedFor(log: GameLog): void {
  expectEverySubmissionShownOnce(log)
  for (let round = 1; round <= log.rounds; round++) {
    const uploaded = log.uploaded.get(round) ?? new Map<string, number>()
    const rejected = [...(log.rejected.get(round) ?? [])].sort()
    const tooLate = [...uploaded.entries()].filter(([, offset]) => offset > GRACE_MS).map(([id]) => id)
    expect({ round, rejected }).toEqual({ round, rejected: tooLate.sort() })

    const shown = log.shown.get(round) ?? []
    const placeholders = log.placeholders.get(round) ?? []
    // a round where nobody submitted anything goes straight to the scores
    const everyone = shown.length > 0 ? [...log.players].sort() : []
    expect({ round, cameUp: [...shown, ...placeholders].sort() }).toEqual({ round, cameUp: everyone })
  }
  expect(log.errors).toEqual([])
}

beforeEach(() => {
  vi.useFakeTimers({ loopLimit: 1_000_000 })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('submit at BUILD expiry', () => {
  // player-3 is the slow builder; the others submit early. The offsets are
  // when player-3's upload reaches the server relative to the deadline.
  for (const mode of ['guess', 'gallery'] as const) {
    for (const offset of [-50, 0, 200]) {
      it(`${mode}: an upload ${offset}ms from the deadline is shown`, () => {
        const log = playGame({
          players: 3,
          rounds: 1,
          mode,
          seed: 1,
          upload: (_round, playerId) => (playerId === 'player-3' ? offset : -30_000),
        })
        expectEverySubmissionShownOnce(log)
        expect(log.shown.get(1)).toContain('player-3')
      })
    }
  }
})

describe('late and missing pictures', () => {
  for (const mode of ['guess', 'gallery'] as const) {
    it(`${mode}: an upload after the grace window is refused and its player gets a placeholder`, () => {
      const log = playGame({
        players: 3,
        rounds: 1,
        mode,
        seed: 1,
        upload: (_round, playerId) => (playerId === 'player-3' ? GRACE_MS + 200 : -30_000),
      })
      expect(log.rejected.get(1)).toEqual(new Set(['player-3']))
      expect(log.placeholders.get(1)).toEqual(['player-3'])
      expectEveryPlayerAccountedFor(log)
    })

    it(`${mode}: a player who never uploads gets a placeholder`, () => {
      const log = playGame({
        players: 4,
        rounds: 1,
        mode,
        seed: 2,
        upload: (_round, playerId) => (playerId === 'player-2' ? null : -30_000),
      })
      expect(log.placeholders.get(1)).toEqual(['player-2'])
      expectEveryPlayerAccountedFor(log)
    })
  }
})

describe('end-of-round invariant', () => {
  it('logs both sets loudly when a stored picture was never shown', () => {
    const log = playGame({
      players: 3,
      rounds: 1,
      mode: 'guess',
      seed: 3,
      upload: (_round, playerId) => (playerId === 'player-3' ? null : -30_000),
      // a picture lands in the store behind the phase machine's back, after
      // the order was fixed — exactly the kind of loss the check is for
      tamper: (_room, store) => store.add('1:player-3'),
    })
    expect(log.errors).toHaveLength(1)
    const [message, sets] = log.errors[0] ?? []
    expect(message).toMatch(/INVARIANT BROKEN.*submitted but never shown: player-3/)
    expect(sets).toEqual({
      submitted: expect.arrayContaining(['player-1', 'player-2', 'player-3']) as unknown,
      shown: expect.not.arrayContaining(['player-3']) as unknown,
    })
  })
})

describe('every submission is shown exactly once', () => {
  // control: with every upload in before the deadline, the order pictures are
  // shown in can't lose or repeat one
  it('uploads all before the deadline, every mode/player/round count', () => {
    const early: UploadPlan = (_round, _playerId, rng) => -Math.floor(1000 + rng() * (BUILD_SEC - 2) * 1000)
    for (const mode of ['guess', 'gallery'] as const) {
      for (const rounds of [3, 5, 10]) {
        for (let players = 3; players <= 8; players++) {
          for (let seed = 1; seed <= 20; seed++) {
            expectEverySubmissionShownOnce(playGame({ players, rounds, mode, seed, upload: early }))
          }
        }
      }
    }
  })

  // most players finish early; some let the timer run out, and the client's
  // auto-submit lands 50-1500ms after the deadline (export + upload over a
  // phone connection); a few are so slow they miss the grace window too, and
  // a few never upload at all
  const upload: UploadPlan = (_round, _playerId, rng) => {
    const r = rng()
    if (r < 0.65) return -Math.floor(1000 + rng() * (BUILD_SEC - 2) * 1000)
    if (r < 0.9) return Math.floor(50 + rng() * 1450)
    if (r < 0.95) return GRACE_MS + Math.floor(200 + rng() * 3000)
    return null
  }

  for (const mode of ['guess', 'gallery'] as const) {
    for (const rounds of [3, 5, 10]) {
      for (let players = 3; players <= 8; players++) {
        it(`${mode}, ${players} players, ${rounds} rounds, 100 seeds`, () => {
          for (let seed = 1; seed <= 100; seed++) {
            expectEveryPlayerAccountedFor(playGame({ players, rounds, mode, seed, upload }))
          }
        })
      }
    }
  }
})
