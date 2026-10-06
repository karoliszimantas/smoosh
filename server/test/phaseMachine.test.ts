import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BUILD_GRACE_SEC,
  PROMPT_WINDOW_SEC,
  MISSING_PHASE_SEC,
  REVEAL_PHASE_SEC,
  type GameSettings,
  type PhaseState,
} from '@smoosh/protocol'
import { createRoom, type Room, type Seat } from '../src/rooms/Room.ts'
import {
  startBuild,
  dropPendingActor,
  recordVote,
  skipAwards,
  voteProblem,
  recordGuess,
  restorePendingActor,
  optionsForPicture,
  type PhaseMachineDeps,
} from '../src/game/phaseMachine.ts'

function makeSeat(n: number, connected = true): Seat {
  return {
    sessionId: `session-${n}`,
    playerId: `player-${n}`,
    name: `Player ${n}`,
    isHost: n === 1,
    presence: connected ? 'present' : 'away',
    socketId: connected ? `socket-${n}` : null,
    score: 0,
    joinedAt: n,
    presentSince: n,
    awayFrom: null,
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
    room.seats.set(seat.playerId, seat)
  }
  return room
}

function makeDeps(overrides: Partial<PhaseMachineDeps> = {}): PhaseMachineDeps {
  return {
    prompts: () => ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'],
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

// A 60s BUILD closes after its deadline plus the grace window for late
// uploads. In Guess, a player who never taps through their prompt window
// starts their clock when it runs out, so the phase runs that much longer.
const GALLERY_BUILD_END_MS = (60 + BUILD_GRACE_SEC) * 1000
const BUILD_END_MS = (PROMPT_WINDOW_SEC + 60 + BUILD_GRACE_SEC) * 1000

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

  it('at the deadline waits a grace window for late uploads, then advances with unsubmitted players remaining', () => {
    const room = makeRoom(3, 3, 60)
    const deps = makeDeps({ hasSubmission: () => false })
    startBuild(room, deps)
    vi.advanceTimersByTime((PROMPT_WINDOW_SEC + 60) * 1000)
    expect(expectPhase(room, 'build').collecting).toBe(true)
    vi.advanceTimersByTime(BUILD_GRACE_SEC * 1000)
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
    vi.advanceTimersByTime(BUILD_END_MS)
    expect(room.phase.phase).toBe('scores')
  })
})

describe('LIE and GUESS phases', () => {
  function buildToLie(playerCount = 3): { room: Room; deps: PhaseMachineDeps } {
    const room = makeRoom(playerCount, 3, 60)
    const deps = makeDeps({ hasSubmission: () => true }) // everyone submits
    startBuild(room, deps)
    vi.advanceTimersByTime(BUILD_END_MS) // deadline reached, all submitted -> straight to lie
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
    vi.advanceTimersByTime(BUILD_END_MS) // -> lie
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

describe('disconnects and reconnects', () => {
  function disconnect(room: Room, deps: PhaseMachineDeps, playerId: string): void {
    const seat = [...room.seats.values()].find((s) => s.playerId === playerId)
    if (seat) seat.presence = 'away'
    dropPendingActor(room, deps, playerId)
  }

  it('a disconnect during reveal neither stalls nor skips it', () => {
    const room = makeRoom(3, 1, 60)
    const deps = makeDeps({ hasSubmission: () => true })
    startBuild(room, deps)
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p) // everyone built -> lie
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p) // -> guess
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p) // -> reveal
    const { pictureIndex, authorId } = expectPhase(room, 'reveal')

    for (const id of ['player-1', 'player-2', 'player-3'].filter((id) => id !== authorId)) disconnect(room, deps, id)
    vi.advanceTimersByTime(REVEAL_PHASE_SEC * 1000 - 1)
    expect(expectPhase(room, 'reveal').pictureIndex).toBe(pictureIndex)
    vi.advanceTimersByTime(1)
    expect(expectPhase(room, 'lie').pictureIndex).toBe(pictureIndex + 1)
  })

  it('a disconnect while a missing-picture placeholder is up neither stalls nor skips it', () => {
    const room = makeRoom(3, 1, 60)
    const deps = makeDeps({ hasSubmission: (_c, _r, id) => id !== 'player-2', random: () => 0.99 })
    startBuild(room, deps)
    vi.advanceTimersByTime(BUILD_END_MS)
    // walk the order until player-2's placeholder comes up
    while (room.phase.phase !== 'missing' && room.phase.phase !== 'scores') {
      for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p)
      if (room.phase.phase === 'reveal') vi.advanceTimersByTime(REVEAL_PHASE_SEC * 1000)
    }
    const { pictureIndex, authorId } = expectPhase(room, 'missing')
    expect(authorId).toBe('player-2')

    disconnect(room, deps, 'player-1')
    vi.advanceTimersByTime(MISSING_PHASE_SEC * 1000 - 1)
    expect(expectPhase(room, 'missing').pictureIndex).toBe(pictureIndex)
    vi.advanceTimersByTime(1)
    expect(room.phase.phase === 'scores' || room.pictureIndex === pictureIndex + 1).toBe(true)
  })

  it('a guesser who drops and comes back mid-guess is waited for again and can still guess', () => {
    const room = makeRoom(3, 1, 60)
    const deps = makeDeps({ hasSubmission: () => true })
    startBuild(room, deps)
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p) // -> lie
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p) // -> guess
    const { pictureIndex, authorId } = expectPhase(room, 'guess')
    const [stays, flaky] = [...room.pendingActors]
    if (!stays || !flaky) throw new Error('expected two guessers')

    disconnect(room, deps, flaky)
    expect(room.pendingActors.has(flaky)).toBe(false)

    const seat = [...room.seats.values()].find((s) => s.playerId === flaky)
    restorePendingActor(room, deps, flaky)
    if (seat) seat.presence = 'present'
    expect(room.pendingActors.has(flaky)).toBe(true)

    // the one who stayed answering no longer ends the phase on their own
    dropPendingActor(room, deps, stays)
    expectPhase(room, 'guess')
    const option = optionsForPicture(room, pictureIndex).find((o) => o.authorId !== flaky)
    if (!option) throw new Error('expected an option')
    recordGuess(room, pictureIndex, flaky, option.id)
    dropPendingActor(room, deps, flaky)
    expect(expectPhase(room, 'reveal').authorId).toBe(authorId)
  })

  it('a returning author is never made pending on their own picture', () => {
    const room = makeRoom(3, 1, 60)
    const deps = makeDeps({ hasSubmission: () => true })
    startBuild(room, deps)
    for (const p of [...room.pendingActors]) dropPendingActor(room, deps, p) // -> lie
    const { authorId } = expectPhase(room, 'lie')
    restorePendingActor(room, deps, authorId)
    expect(room.pendingActors.has(authorId)).toBe(false)
  })
})

describe('round and game progression', () => {
  it('advances rounds only after the last picture in the round reaches reveal, then loops to the next build', () => {
    const room = makeRoom(2, 2, 60) // 2 rounds, 2 players -> 2 pictures per round
    const deps = makeDeps({ hasSubmission: () => true })
    startBuild(room, deps)
    expect(room.round).toBe(1)

    vi.advanceTimersByTime(BUILD_END_MS) // build -> lie (picture 0)
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
    vi.advanceTimersByTime(BUILD_END_MS)
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

describe('GUESS scoring in a game', () => {
  it('the scoreboard breakdown sums to each total, round and game', () => {
    const room = makeRoom(4, 2, 60, 'guess')
    const deps = makeDeps({ hasSubmission: () => true })
    startBuild(room, deps)
    for (let t = 0; t < 2000 && !(room.phase.phase === 'scores' && room.phase.isFinalRound); t++) {
      const phase = room.phase
      if (phase.phase === 'guess') {
        // everyone guesses the first option they're allowed
        for (const id of [...room.pendingActors]) {
          const pick = optionsForPicture(room, phase.pictureIndex).find((o) => o.authorId !== id)
          if (pick) recordGuess(room, phase.pictureIndex, id, pick.id)
          dropPendingActor(room, deps, id)
        }
      }
      vi.advanceTimersByTime(1_000)
    }
    const scores = expectPhase(room, 'scores')
    for (const e of scores.scoreboard) {
      const g = e.game
      if (!g) throw new Error('guess mode has a breakdown')
      expect(g.picture + g.guessing + g.lies).toBe(e.total)
    }
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

  it('goes build -> one vote on the whole round, everyone voting', () => {
    const { room } = buildToRate()
    vi.advanceTimersByTime(GALLERY_BUILD_END_MS)
    const phase = expectPhase(room, 'vote')
    expect(phase.pictures.map((p) => p.authorId).sort()).toEqual(['player-1', 'player-2', 'player-3'])
    expect(phase.pictures.every((p) => p.imagePath !== null)).toBe(true)
    expect(room.pendingActors.size).toBe(3)
  })

  it('carries the shared prompt into the vote — empty in freestyle', () => {
    const prompted = buildToRate(true)
    vi.advanceTimersByTime(GALLERY_BUILD_END_MS)
    expect(expectPhase(prompted.room, 'vote').prompt).toBe([...prompted.room.promptByPlayer.values()][0])

    const freestyle = buildToRate(false)
    vi.advanceTimersByTime(GALLERY_BUILD_END_MS)
    expect(expectPhase(freestyle.room, 'vote').prompt).toBe('')
  })

  it('refuses a vote for your own picture, a repeat, an unknown picture, and a missing required runner-up', () => {
    const { room } = buildToRate(true, 4)
    vi.advanceTimersByTime(GALLERY_BUILD_END_MS)
    expectPhase(room, 'vote')
    expect(voteProblem(room, 'player-1', 'player-1', 'player-2')).toMatch(/own/)
    expect(voteProblem(room, 'player-1', 'player-2', 'player-1')).toMatch(/own/)
    expect(voteProblem(room, 'player-1', 'player-2', 'player-2')).toMatch(/different/)
    expect(voteProblem(room, 'player-1', 'player-9', 'player-2')).toMatch(/not up for a vote/)
    // four players: three to choose from, so a runner-up is required
    expect(voteProblem(room, 'player-1', 'player-2', null)).toMatch(/runner-up/)
    expect(voteProblem(room, 'player-1', 'player-2', 'player-3')).toBeNull()
  })

  it('three players: the runner-up is optional — two of two is not a judgement', () => {
    const { room } = buildToRate(true, 3)
    vi.advanceTimersByTime(GALLERY_BUILD_END_MS)
    expect(voteProblem(room, 'player-1', 'player-2', null)).toBeNull()
    expect(voteProblem(room, 'player-1', 'player-2', 'player-3')).toBeNull()
  })

  it('3 players, optional runner-up: favourite 2 points, runner-up 1, early-advance once all voted', () => {
    const { room, deps } = buildToRate(true, 3)
    vi.advanceTimersByTime(GALLERY_BUILD_END_MS)
    recordVote(room, 'player-1', 'player-2', 'player-3')
    dropPendingActor(room, deps, 'player-1')
    recordVote(room, 'player-2', 'player-3', null) // no runner-up
    dropPendingActor(room, deps, 'player-2')
    expectPhase(room, 'vote')
    recordVote(room, 'player-3', 'player-2', null)
    dropPendingActor(room, deps, 'player-3')

    const awards = expectPhase(room, 'awards')
    const by = new Map(awards.pictures.map((p) => [p.authorId, p]))
    expect(by.get('player-2')).toMatchObject({ favourites: 2, runnerUps: 0, points: 4, award: 'best' })
    expect(by.get('player-3')).toMatchObject({ favourites: 1, runnerUps: 1, points: 3, award: 'second' })
    // no votes: no award, no consolation
    expect(by.get('player-1')).toMatchObject({ favourites: 0, runnerUps: 0, points: 0, award: null })
    const score = (id: string) => room.seats.get(id)?.score
    expect([score('player-1'), score('player-2'), score('player-3')]).toEqual([0, 4, 3])
    // anonymous: who voted for what never leaves the server
    expect(JSON.stringify(awards)).not.toMatch(/voter/)
  })

  it('the 3-player reveal fits in 15 seconds; the host can cut it short', () => {
    const { room, deps } = buildToRate(true, 3)
    vi.advanceTimersByTime(GALLERY_BUILD_END_MS)
    recordVote(room, 'player-1', 'player-2', 'player-3')
    recordVote(room, 'player-2', 'player-3', 'player-1')
    recordVote(room, 'player-3', 'player-1', 'player-2')
    for (const id of ['player-1', 'player-2', 'player-3']) dropPendingActor(room, deps, id)
    const awards = expectPhase(room, 'awards')
    expect(awards.deadline - awards.startsAt).toBeLessThanOrEqual(15_000)

    skipAwards(room, deps)
    const skipped = expectPhase(room, 'awards')
    expect(skipped.skipped).toBe(true)
    vi.advanceTimersByTime(3_000)
    expectPhase(room, 'scores')
  })

  it('the final scores hang every round’s Best in Show', () => {
    const { room, deps } = buildToRate(true, 3)
    for (let round = 1; round <= 2; round++) {
      vi.advanceTimersByTime(GALLERY_BUILD_END_MS)
      recordVote(room, 'player-1', 'player-2', null)
      recordVote(room, 'player-3', 'player-2', null)
      recordVote(room, 'player-2', 'player-1', null)
      for (const id of ['player-1', 'player-2', 'player-3']) dropPendingActor(room, deps, id)
      vi.advanceTimersByTime(expectPhase(room, 'awards').deadline - Date.now()) // -> scores
      if (round === 1) vi.advanceTimersByTime(6_000) // scores -> next build
    }
    const scores = expectPhase(room, 'scores')
    expect(scores.isFinalRound).toBe(true)
    expect(scores.exhibition.map((e) => [e.round, e.authorId])).toEqual([
      [1, 'player-2'],
      [2, 'player-2'],
    ])
  })

  it('a missing picture is shown in the vote but cannot be voted for', () => {
    const room = makeRoom(4, 1, 60, 'gallery', true)
    const deps = makeDeps({ hasSubmission: (_c, _r, id) => id !== 'player-4' })
    startBuild(room, deps)
    vi.advanceTimersByTime(GALLERY_BUILD_END_MS)
    const phase = expectPhase(room, 'vote')
    expect(phase.pictures.find((p) => p.authorId === 'player-4')?.imagePath).toBeNull()
    expect(voteProblem(room, 'player-1', 'player-4', 'player-2')).toMatch(/not up for a vote/)
    // only two others' pictures to choose from now: runner-up optional
    expect(voteProblem(room, 'player-1', 'player-2', null)).toBeNull()
  })

  it('nobody votes: the wall is shown with no awards, nobody scores', () => {
    const { room } = buildToRate()
    vi.advanceTimersByTime(GALLERY_BUILD_END_MS) // -> vote
    vi.advanceTimersByTime(120_000) // nobody votes
    const awards = expectPhase(room, 'awards')
    expect(awards.announcements).toEqual([])
    expect(awards.pictures.every((p) => p.award === null && p.points === 0)).toBe(true)
  })

  it('a round goes vote -> awards -> scores -> next build, and votes do not leak into the next round', () => {
    const { room } = buildToRate()
    vi.advanceTimersByTime(GALLERY_BUILD_END_MS)
    recordVote(room, 'player-1', 'player-2', null)
    vi.advanceTimersByTime(120_000)
    // the reveal runs as long as its announcements need, no longer
    vi.advanceTimersByTime(expectPhase(room, 'awards').deadline - Date.now())
    expect(expectPhase(room, 'scores').isFinalRound).toBe(false)
    vi.advanceTimersByTime(6_000)
    expectPhase(room, 'build')
    expect(room.round).toBe(2)
    expect(room.votes.size).toBe(0)
  })

  it('never enters the guess phases', () => {
    const { room } = buildToRate(false)
    const seen = new Set<string>()
    for (let t = 0; t < 400; t++) {
      seen.add(room.phase.phase)
      vi.advanceTimersByTime(1_000)
    }
    expect(seen.has('lie') || seen.has('guess') || seen.has('reveal')).toBe(false)
    expect(seen.has('vote') && seen.has('awards')).toBe(true)
  })
})
