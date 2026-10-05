import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GameSettings, PhaseState } from '@smoosh/protocol'
import { createRoom, type Room, type Seat } from '../src/rooms/Room.ts'
import { startBuild, dropPendingActor, recordRating, type PhaseMachineDeps } from '../src/game/phaseMachine.ts'

function makeSeat(n: number, connected = true): Seat {
  return {
    sessionId: `session-${n}`,
    playerId: `player-${n}`,
    name: `Player ${n}`,
    isHost: n === 1,
    connected,
    socketId: connected ? `socket-${n}` : null,
    score: 0,
    joinedAt: n,
  }
}

// rounds/buildTimeSec are typed as literal unions in GameSettings (enforced
// at the protocol/zod boundary on room:updateSettings) — phaseMachine itself
// doesn't care about the exact allowed set, so tests deliberately use
// off-menu values like 1-2 rounds to keep scenarios short
function makeRoom(
  playerCount: number,
  rounds = 3,
  buildTimeSec = 90,
  mode: GameSettings['mode'] = 'guess',
  prompted = true,
): Room {
  const room = createRoom('TEST')
  room.settings = { rounds, buildTimeSec, answerTimeSec: 120, mode, prompted } as GameSettings
  for (let i = 1; i <= playerCount; i++) {
    const seat = makeSeat(i)
    room.seats.set(seat.sessionId, seat)
  }
  return room
}

function makeDeps(overrides: Partial<PhaseMachineDeps> = {}): PhaseMachineDeps {
  return {
    promptPool: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'],
    hasSubmission: () => false,
    onSnapshot: vi.fn(),
    ...overrides,
  }
}

// re-reads room.phase fresh each call (rather than relying on TS narrowing
// across mutating calls, which goes stale) and asserts it's the expected variant
function expectPhase<T extends PhaseState['phase']>(room: Room, phase: T): Extract<PhaseState, { phase: T }> {
  if (room.phase.phase !== phase) {
    throw new Error(`expected phase "${phase}", got "${room.phase.phase}"`)
  }
  return room.phase as Extract<PhaseState, { phase: T }>
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('BUILD phase', () => {
  it('does not advance while an eligible player has not submitted and the deadline has not passed', () => {
    const room = makeRoom(3)
    const deps = makeDeps({ hasSubmission: () => false })
    startBuild(room, deps)
    dropPendingActor(room, deps, 'player-1')
    dropPendingActor(room, deps, 'player-2')
    expect(room.phase.phase).toBe('build')
  })

  it('advances early the instant the last eligible player acts, before the deadline', () => {
    const room = makeRoom(3)
    const submitted = new Set<string>()
    const deps = makeDeps({ hasSubmission: (_code, _round, playerId) => submitted.has(playerId) })
    startBuild(room, deps)
    submitted.add('player-1')
    submitted.add('player-2')
    submitted.add('player-3')
    dropPendingActor(room, deps, 'player-1')
    dropPendingActor(room, deps, 'player-2')
    dropPendingActor(room, deps, 'player-3')
    expect(room.phase.phase).not.toBe('build')
  })

  it('advances at the deadline even with unsubmitted players remaining', () => {
    const room = makeRoom(3, 3, 60)
    const deps = makeDeps({ hasSubmission: () => false })
    startBuild(room, deps)
    vi.advanceTimersByTime(60_000)
    expect(room.phase.phase).not.toBe('build')
  })

  it('a disconnected player is dropped from pending and does not block early advance', () => {
    const room = makeRoom(3)
    const submitted = new Set<string>()
    const deps = makeDeps({ hasSubmission: (_code, _round, playerId) => submitted.has(playerId) })
    startBuild(room, deps)
    // player-3 disconnects mid-build without submitting
    dropPendingActor(room, deps, 'player-3')
    submitted.add('player-1')
    submitted.add('player-2')
    dropPendingActor(room, deps, 'player-1')
    dropPendingActor(room, deps, 'player-2')
    expect(room.phase.phase).not.toBe('build')
  })

  it('a zero-submission round skips straight from build to scores', () => {
    const room = makeRoom(3, 3, 60)
    const deps = makeDeps({ hasSubmission: () => false })
    startBuild(room, deps)
    vi.advanceTimersByTime(60_000)
    expect(room.phase.phase).toBe('scores')
  })
})

describe('LIE and GUESS phases', () => {
  function buildToLie(playerCount = 3): { room: Room; deps: PhaseMachineDeps } {
    const room = makeRoom(playerCount, 3, 60)
    const deps = makeDeps({ hasSubmission: () => true }) // everyone submits
    startBuild(room, deps)
    vi.advanceTimersByTime(60_000) // deadline reached, all submitted -> straight to lie
    return { room, deps }
  }

  it('excludes the picture author from pending during LIE', () => {
    const { room } = buildToLie()
    const phase = expectPhase(room, 'lie')
    expect(room.pendingActors.has(phase.authorId)).toBe(false)
  })

  it('excludes the picture author from pending during GUESS', () => {
    const { room, deps } = buildToLie()
    const authorId = expectPhase(room, 'lie').authorId
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p)
    const guessPhase = expectPhase(room, 'guess')
    expect(guessPhase.authorId).toBe(authorId)
    expect(room.pendingActors.has(authorId)).toBe(false)
  })
})

describe('REVEAL phase', () => {
  it('never early-advances — dropping a pending actor during reveal is a no-op', () => {
    const room = makeRoom(3, 3, 60)
    const deps = makeDeps({ hasSubmission: () => true })
    startBuild(room, deps)
    vi.advanceTimersByTime(60_000) // -> lie
    expectPhase(room, 'lie')
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p) // -> guess
    expectPhase(room, 'guess')
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p) // -> reveal
    expectPhase(room, 'reveal')

    dropPendingActor(room, deps, 'player-1') // not pending during reveal — must not advance
    expectPhase(room, 'reveal')

    vi.advanceTimersByTime(8_000) // only the timer moves reveal forward
    expect(room.phase.phase).not.toBe('reveal')
  })
})

describe('round and game progression', () => {
  it('advances rounds only after the last picture in the round reaches reveal, then loops to the next build', () => {
    const room = makeRoom(2, 2, 60) // 2 rounds, 2 players -> 2 pictures per round
    const deps = makeDeps({ hasSubmission: () => true })
    startBuild(room, deps)
    expect(room.round).toBe(1)

    vi.advanceTimersByTime(60_000) // build -> lie (picture 0)
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p) // -> guess
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p) // -> reveal
    expect(expectPhase(room, 'reveal').pictureIndex).toBe(0)

    vi.advanceTimersByTime(8_000) // reveal -> next picture's lie (picture 1), same round
    const liePhase = expectPhase(room, 'lie')
    expect(liePhase.pictureIndex).toBe(1)
    expect(room.round).toBe(1)

    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p)
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p)
    expectPhase(room, 'reveal')
    vi.advanceTimersByTime(8_000) // last picture of round 1 revealed -> scores (non-final)
    expect(expectPhase(room, 'scores').isFinalRound).toBe(false)

    vi.advanceTimersByTime(6_000) // scores -> round 2 build
    expect(room.phase.phase).toBe('build')
    expect(room.round).toBe(2)
  })

  it('reaches a non-auto-advancing final scores phase after the last round', () => {
    const room = makeRoom(2, 1, 60) // 1 round only
    const deps = makeDeps({ hasSubmission: () => true })
    startBuild(room, deps)
    vi.advanceTimersByTime(60_000)
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p)
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p)
    vi.advanceTimersByTime(8_000)
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p)
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p)
    vi.advanceTimersByTime(8_000)

    const scoresPhase = expectPhase(room, 'scores')
    expect(scoresPhase.isFinalRound).toBe(true)
    expect(scoresPhase.deadline).toBeNull()

    // nothing should move it forward — no timer was scheduled
    vi.advanceTimersByTime(10 * 60_000)
    expect(room.phase.phase).toBe('scores')
  })
})

describe('GALLERY mode', () => {
  function buildToRate(prompted = true, playerCount = 3) {
    const room = makeRoom(playerCount, 2, 60, 'gallery', prompted)
    const deps = makeDeps({ hasSubmission: () => true })
    startBuild(room, deps)
    return { room, deps }
  }

  it('prompted: everyone gets the same prompt, drawn once from the pool', () => {
    const { room } = buildToRate(true)
    const prompts = new Set(room.promptByPlayer.values())
    expect(prompts.size).toBe(1)
    const [prompt] = prompts
    expect(prompt).toBeTruthy()
    expect(room.usedPrompts.size).toBe(1)
  })

  it('freestyle: everyone gets an empty prompt and none are drawn', () => {
    const { room } = buildToRate(false)
    expect([...room.promptByPlayer.values()]).toEqual(['', '', ''])
    expect(room.usedPrompts.size).toBe(0)
  })

  it('goes build -> rate, with the author excluded from rating', () => {
    const { room } = buildToRate()
    vi.advanceTimersByTime(60_000)
    const phase = expectPhase(room, 'rate')
    expect(phase.pictureIndex).toBe(0)
    expect(room.pendingActors.has(phase.authorId)).toBe(false)
    expect(room.pendingActors.size).toBe(2)
  })

  it('carries the shared prompt into rate — empty in freestyle', () => {
    const prompted = buildToRate(true)
    vi.advanceTimersByTime(60_000)
    expect(expectPhase(prompted.room, 'rate').prompt).toBe([...prompted.room.promptByPlayer.values()][0])

    const freestyle = buildToRate(false)
    vi.advanceTimersByTime(60_000)
    expect(expectPhase(freestyle.room, 'rate').prompt).toBe('')
  })

  it('early-advances to the result once every rater has rated, and scores the author by the average', () => {
    const { room, deps } = buildToRate()
    vi.advanceTimersByTime(60_000)
    const { authorId, pictureIndex } = expectPhase(room, 'rate')
    const [first, second] = [...room.pendingActors]
    if (!first || !second) throw new Error('expected two raters')
    recordRating(room, pictureIndex, first, 5)
    dropPendingActor(room, deps, first)
    expectPhase(room, 'rate')
    recordRating(room, pictureIndex, second, 4)
    dropPendingActor(room, deps, second)

    const result = expectPhase(room, 'rateResult')
    expect(result.average).toBe(4.5)
    expect(result.counts).toEqual([0, 0, 0, 1, 1])
    expect(result.points).toBe(900)
    const author = [...room.seats.values()].find((s) => s.playerId === authorId)
    expect(author?.score).toBe(900)
  })

  it('a picture nobody rated scores nothing', () => {
    const { room } = buildToRate()
    vi.advanceTimersByTime(60_000) // -> rate
    vi.advanceTimersByTime(120_000) // nobody rates
    const result = expectPhase(room, 'rateResult')
    expect(result.average).toBeNull()
    expect(result.points).toBe(0)
  })

  it('rates every picture in turn, then shows scores and moves to the next round', () => {
    const { room } = buildToRate()
    vi.advanceTimersByTime(60_000)
    for (let i = 0; i < 3; i++) {
      expect(expectPhase(room, 'rate').pictureIndex).toBe(i)
      vi.advanceTimersByTime(120_000) // rate -> result
      expectPhase(room, 'rateResult')
      vi.advanceTimersByTime(6_000) // result -> next picture / scores
    }
    expect(expectPhase(room, 'scores').isFinalRound).toBe(false)
    vi.advanceTimersByTime(6_000)
    expectPhase(room, 'build')
    expect(room.round).toBe(2)
    // ratings from round 1 don't leak into round 2
    expect(room.ratingsByPictureIndex.size).toBe(0)
  })

  it('never enters the guess phases', () => {
    const { room } = buildToRate(false)
    const seen = new Set<string>()
    for (let t = 0; t < 400; t++) {
      seen.add(room.phase.phase)
      vi.advanceTimersByTime(1_000)
    }
    expect(seen.has('lie') || seen.has('guess') || seen.has('reveal')).toBe(false)
    expect(seen.has('rate') && seen.has('rateResult')).toBe(true)
  })
})
