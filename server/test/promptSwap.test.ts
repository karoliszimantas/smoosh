import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PROMPT_CHOICE_SEC, PROMPT_WINDOW_SEC, swapAllowance, type GameSettings } from '@smoosh/protocol'
import { createRoom, type Room, type Seat } from '../src/rooms/Room.ts'
import { startBuild, rescheduleBuild, type PhaseMachineDeps } from '../src/game/phaseMachine.ts'
import { closeWindow, personalDeadline, swapPrompt, swapProblem, swapsLeft, settleWindows } from '../src/game/promptSwap.ts'
import { buildSnapshot } from '../src/snapshot.ts'

const POOL = Array.from({ length: 300 }, (_, i) => `prompt ${i}`)

function seat(n: number, presence: Seat['presence'] = 'present'): Seat {
  return {
    sessionId: `s${n}`,
    playerId: `p${n}`,
    name: `P${n}`,
    isHost: n === 1,
    presence,
    socketId: presence === 'present' ? `sock${n}` : null,
    score: 0,
    joinedAt: n,
    presentSince: n,
    awayFrom: null,
  }
}

function game(players = 4, rounds: GameSettings['rounds'] = 5, pool: string[] = POOL, away: number[] = []) {
  const room = createRoom('SWAP')
  room.settings = { rounds, buildTimeSec: 60, answerTimeSec: 120, mode: 'guess', prompted: true, allowPhotos: true }
  for (let i = 1; i <= players; i++) room.seats.set(`p${i}`, seat(i, away.includes(i) ? 'away' : 'present'))
  const deps: PhaseMachineDeps = { prompts: () => pool, hasSubmission: () => false, onSnapshot: vi.fn() }
  startBuild(room, deps)
  return { room, deps }
}

// what the swap handler does
function swap(room: Room, deps: PhaseMachineDeps, id: string): string {
  settleWindows(room, Date.now())
  const offered = swapPrompt(room, id, Date.now(), room.swapPool)
  rescheduleBuild(room, deps)
  return offered
}
function keep(room: Room, deps: PhaseMachineDeps, id: string, which: 'original' | 'swapped') {
  settleWindows(room, Date.now())
  closeWindow(room, id, Date.now(), which)
  rescheduleBuild(room, deps)
}
const can = (room: Room, id: string) => swapProblem(room, id, Date.now(), room.swapPool) === null

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the allowance', () => {
  it('3 rounds: 1, 5: 2, 10: 3', () => {
    expect([3, 5, 10].map(swapAllowance)).toEqual([1, 2, 3])
    expect(swapsLeft(game(4, 3).room, 'p1')).toBe(1)
    expect(swapsLeft(game(4, 5).room, 'p1')).toBe(2)
    expect(swapsLeft(game(4, 10).room, 'p1')).toBe(3)
  })

  it('resets when a new game starts in the same room', () => {
    const { room, deps } = game(4, 3)
    swap(room, deps, 'p1')
    expect(swapsLeft(room, 'p1')).toBe(0)
    // play again: the lobby resets round and burned prompts, then a new game
    room.round = 0
    room.usedPrompts.clear()
    startBuild(room, deps)
    expect(swapsLeft(room, 'p1')).toBe(1)
  })

  it('one a round, even with allowance left', () => {
    const { room, deps } = game(4, 10)
    swap(room, deps, 'p1')
    expect(swapsLeft(room, 'p1')).toBe(2)
    expect(swapProblem(room, 'p1', Date.now(), room.swapPool)).toBe('one swap a round')
    keep(room, deps, 'p1', 'swapped')
    expect(can(room, 'p1')).toBe(false)
  })

  it('keeping the original still spends the swap', () => {
    const { room, deps } = game(4, 5)
    const original = room.promptByPlayer.get('p1')
    swap(room, deps, 'p1')
    keep(room, deps, 'p1', 'original')
    expect(room.promptByPlayer.get('p1')).toBe(original)
    expect(swapsLeft(room, 'p1')).toBe(1)
  })
})

describe('both prompts burn', () => {
  it('neither can come up again this game, for anyone — and both return next game', () => {
    const { room, deps } = game(4, 5)
    const original = room.promptByPlayer.get('p1') ?? ''
    const offered = swap(room, deps, 'p1')
    keep(room, deps, 'p1', 'swapped')
    expect(room.promptByPlayer.get('p1')).toBe(offered)
    expect(room.usedPrompts.has(original) && room.usedPrompts.has(offered)).toBe(true)
    // later rounds deal from the pool minus everything used
    for (let r = 2; r <= 5; r++) {
      startBuild(room, deps)
      for (const p of room.promptByPlayer.values()) expect([original, offered]).not.toContain(p)
    }
    // a new game: the room's burned list is cleared when it's set up again
    room.round = 0
    room.usedPrompts.clear()
    expect(room.swapPool.filter((p) => !room.usedPrompts.has(p))).toContain(original)
  })

  it('a swap never hands over a prompt someone else holds this round', () => {
    // a pool with exactly the dealt prompts plus a spare: the spare is the only answer
    const { room, deps } = game(4, 3, Array.from({ length: 4 * 3 + 1 }, (_, i) => `q${i}`))
    const held = new Set(room.promptByPlayer.values())
    const offered = swap(room, deps, 'p1')
    expect(held.has(offered)).toBe(false)
  })
})

describe('the window and the clock', () => {
  it('the build clock starts when the window closes, not before', () => {
    const { room, deps } = game()
    const start = Date.now()
    expect(personalDeadline(room, 'p1', Date.now())).toBe(start + (PROMPT_WINDOW_SEC + 60) * 1000)
    vi.advanceTimersByTime(2000)
    keep(room, deps, 'p1', 'original') // "start building" two seconds in
    expect(personalDeadline(room, 'p1', Date.now())).toBe(start + 2000 + 60_000)
  })

  it('one player’s slow choice moves nobody else’s clock', () => {
    const { room, deps } = game()
    const start = Date.now()
    vi.advanceTimersByTime(1000)
    keep(room, deps, 'p2', 'original')
    vi.advanceTimersByTime(3000)
    swap(room, deps, 'p1') // p1 takes their time…
    vi.advanceTimersByTime(PROMPT_CHOICE_SEC * 1000) // …and lets the choice run out
    expect(personalDeadline(room, 'p2', Date.now())).toBe(start + 1000 + 60_000)
    expect(personalDeadline(room, 'p1', Date.now())).toBe(start + 4000 + PROMPT_CHOICE_SEC * 1000 + 60_000)
    // the phase waits for the last clock
    const build = room.phase.phase === 'build' ? room.phase : null
    expect(build?.deadline).toBe(start + 4000 + PROMPT_CHOICE_SEC * 1000 + 60_000)
  })

  it('a choice left unmade keeps the swapped-in prompt', () => {
    const { room, deps } = game()
    const offered = swap(room, deps, 'p1')
    vi.advanceTimersByTime(PROMPT_CHOICE_SEC * 1000 + 10)
    expect(room.promptByPlayer.get('p1')).toBe(offered)
  })

  it('no swap once the window has closed — run out, tapped through, or after a reconnect', () => {
    const { room, deps } = game()
    keep(room, deps, 'p1', 'original')
    expect(swapProblem(room, 'p1', Date.now(), room.swapPool)).toMatch(/too late/)
    vi.advanceTimersByTime(PROMPT_WINDOW_SEC * 1000)
    expect(can(room, 'p2')).toBe(false)
    // p3 drops and comes back after their window: still closed
    const s = room.seats.get('p3')
    if (s) s.presence = 'away'
    vi.advanceTimersByTime(10_000)
    if (s) s.presence = 'present'
    expect(can(room, 'p3')).toBe(false)
    expect(buildSnapshot(room, room.seats.get('p3') as Seat).you.build?.windowEndsAt).toBeNull()
  })

  it('away when the build starts: no window, no swap, nothing spent', () => {
    const { room } = game(4, 5, POOL, [4])
    const start = Date.now()
    expect(can(room, 'p4')).toBe(false)
    expect(swapsLeft(room, 'p4')).toBe(2)
    expect(personalDeadline(room, 'p4', Date.now())).toBe(start + 60_000)
    expect(buildSnapshot(room, room.seats.get('p4') as Seat).you.build?.windowEndsAt).toBeNull()
  })
})

describe('the pool', () => {
  it('a 10-round, 8-player game with every swap used never runs dry on the 600 pool', () => {
    const pool = Array.from({ length: 600 }, (_, i) => `g${i}`)
    const { room, deps } = game(8, 10, pool)
    let swaps = 0
    for (let r = 1; r <= 10; r++) {
      if (r > 1) startBuild(room, deps)
      for (let p = 1; p <= 8; p++) {
        if (can(room, `p${p}`)) {
          swap(room, deps, `p${p}`)
          swaps++
        }
      }
    }
    expect(swaps).toBe(8 * 3)
    expect(room.usedPrompts.size).toBe(10 * 8 + 8 * 3) // 104
  })

  it('with no prompt to spare, the swap is simply not offered — and no round runs short', () => {
    // exactly enough for 3 rounds of 4: nothing to spare
    const pool = Array.from({ length: 12 }, (_, i) => `t${i}`)
    const { room, deps } = game(4, 3, pool)
    expect(can(room, 'p1')).toBe(false)
    expect(buildSnapshot(room, room.seats.get('p1') as Seat).you.build?.canSwap).toBe(false)
    startBuild(room, deps)
    startBuild(room, deps) // the last round still deals in full
    expect(new Set(room.promptByPlayer.values()).size).toBe(4)
  })

  it('gallery has no window at all', () => {
    const room = createRoom('GAL')
    room.settings = { rounds: 3, buildTimeSec: 60, answerTimeSec: 120, mode: 'gallery', prompted: true, allowPhotos: true }
    for (let i = 1; i <= 3; i++) room.seats.set(`p${i}`, seat(i))
    const start = Date.now()
    startBuild(room, { prompts: () => POOL, hasSubmission: () => false, onSnapshot: vi.fn() })
    expect(can(room, 'p1')).toBe(false)
    expect(room.phase.phase === 'build' && room.phase.deadline).toBe(start + 60_000)
  })
})
