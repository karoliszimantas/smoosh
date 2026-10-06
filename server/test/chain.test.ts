import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BUILD_GRACE_SEC,
  CHAIN_STRUCTURES,
  FIRST_PASS_BONUS_SEC,
  chainResults,
  groupSizes,
  passSeconds,
  planChains,
  type ChainStructure,
  type GameSettings,
  type PhaseState,
} from '@smoosh/protocol'
import { createRoom, type Room, type Seat } from '../src/rooms/Room.ts'
import {
  acceptSubmission,
  dropPendingActor,
  passChainOf,
  recordChainVote,
  startBuild,
  votableChains,
  type PhaseMachineDeps,
} from '../src/game/phaseMachine.ts'
import { buildSnapshot } from '../src/snapshot.ts'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`)

describe('chain layouts', () => {
  it.each([3, 4, 5, 6, 7, 8])('%i players, rotating (room or groups): everyone adds every pass, nobody waits', (n) => {
    for (const structure of ['rotate', 'groups'] as const) {
      const plan = planChains(ids(n), structure)
      expect(plan.chains).toHaveLength(n)
      for (let k = 0; k < plan.passCount; k++) {
        const busy = plan.chains.map((c) => c.authors[k]).filter((a): a is string => a !== null)
        expect(busy.sort()).toEqual(ids(n).sort()) // each player exactly once
      }
      for (const c of plan.chains) {
        const authors = c.authors.filter((a): a is string => a !== null)
        expect(new Set(authors).size).toBe(authors.length) // a different hand each pass
        expect(authors.length).toBeGreaterThanOrEqual(2)
      }
      // everyone has a chain they didn't touch, to vote for
      for (const p of ids(n)) expect(plan.chains.some((c) => !c.authors.includes(p))).toBe(true)
    }
  })

  it('rotating chains are three passes — two in a room of three', () => {
    expect(planChains(ids(3), 'rotate').passCount).toBe(2)
    for (const n of [4, 5, 6, 7, 8]) expect(planChains(ids(n), 'rotate').passCount).toBe(3)
  })

  it('groups: 5 is one group, 6 → 3+3, 7 → 4+3, 8 → 4+4', () => {
    expect([3, 4, 5, 6, 7, 8].map((n) => groupSizes(n, 'groups'))).toEqual([[3], [4], [5], [3, 3], [4, 3], [4, 4]])
  })

  it('one picture per chain: the brief’s splits, one player at a time', () => {
    expect([3, 4, 5, 6, 7, 8].map((n) => groupSizes(n, 'single'))).toEqual([[3], [4], [3, 2], [3, 3], [4, 3], [4, 4]])
    const plan = planChains(ids(5), 'single')
    expect(plan.chains.map((c) => c.authors)).toEqual([
      ['p1', 'p2', 'p3'],
      ['p4', 'p5', null],
    ])
  })

  it('the first pass gets 30 seconds more; the rest the configured time', () => {
    for (const t of [60, 90, 120]) {
      expect(passSeconds(0, t)).toBe(t + FIRST_PASS_BONUS_SEC)
      expect(passSeconds(1, t)).toBe(t)
      expect(passSeconds(2, t)).toBe(t)
    }
  })
})

describe('the vote and its prize', () => {
  it('Best in Show’s 4200 is shared equally by the winning chain’s artists', () => {
    const contributors = new Map([
      ['a', ['p1', 'p2', 'p3']],
      ['b', ['p4', 'p5']],
    ])
    const r = chainResults(contributors, new Map([['p4', 'a'], ['p5', 'a'], ['p1', 'b']]))
    expect(r.find((x) => x.chainId === 'a')).toMatchObject({ votes: 2, best: true, pointsEach: 1400 })
    expect(r.find((x) => x.chainId === 'b')).toMatchObject({ votes: 1, best: false, pointsEach: 0 })
  })

  it('a vote for your own chain counts for nothing', () => {
    const r = chainResults(new Map([['a', ['p1', 'p2']]]), new Map([['p1', 'a']]))
    expect(r[0]).toMatchObject({ votes: 0, best: false })
  })
})

// ---------- through the phase machine

function seat(id: string, presence: Seat['presence'] = 'present'): Seat {
  const n = Number(id.slice(1))
  return { sessionId: `s${id}`, playerId: id, name: id, isHost: n === 1, presence, socketId: `k${id}`, score: 0, joinedAt: n, presentSince: n, awayFrom: null }
}

function chainGame(n: number, structure: ChainStructure = 'rotate', away: string[] = []) {
  const room = createRoom('CHN')
  room.settings = { rounds: 3, buildTimeSec: 90, answerTimeSec: 120, mode: 'chain', prompted: true, allowPhotos: true, chainStructure: structure } as GameSettings
  for (const id of ids(n)) room.seats.set(id, seat(id, away.includes(id) ? 'away' : 'present'))
  const store = new Set<string>()
  const deps: PhaseMachineDeps = {
    prompts: () => Array.from({ length: 100 }, (_, i) => `prompt ${i}`),
    hasSubmission: (_c, unit, id) => store.has(`${unit}:${id}`),
    onSnapshot: vi.fn(),
    random: () => 0.5,
  }
  startBuild(room, deps)
  // a phone sends its pass in
  const submit = (id: string) => {
    const phase = room.phase
    if (phase.phase !== 'pass') throw new Error(`not a pass: ${phase.phase}`)
    return acceptSubmission(room, deps, id, phase.unit, () => store.add(`${phase.unit}:${id}`))
  }
  return { room, deps, submit }
}

function expectPhase<T extends PhaseState['phase']>(room: Room, phase: T): Extract<PhaseState, { phase: T }> {
  if (room.phase.phase !== phase) throw new Error(`expected ${phase}, got ${room.phase.phase}`)
  return room.phase as Extract<PhaseState, { phase: T }>
}
const snap = (room: Room, id: string) => buildSnapshot(room, room.seats.get(id) as Seat)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a chain round', () => {
  it('only the first player sees the prompt; later passes get the earlier ones as ghosts', () => {
    const { room, submit } = chainGame(4)
    expect(expectPhase(room, 'pass').deadline - Date.now()).toBe((90 + FIRST_PASS_BONUS_SEC) * 1000)
    for (const id of ids(4)) {
      expect(snap(room, id).you.pass?.prompt).toMatch(/^prompt /)
      expect(snap(room, id).you.pass?.underlay).toEqual([])
    }
    for (const id of ids(4)) submit(id) // all in: on to pass 2 at once
    const pass = expectPhase(room, 'pass')
    expect(pass.pass).toBe(1)
    expect(pass.deadline - Date.now()).toBe(90_000)
    for (const id of ids(4)) {
      const you = snap(room, id).you.pass
      expect(you?.prompt).toBeNull()
      expect(you?.underlay).toHaveLength(1)
      // and it's not their own pass they're shown
      expect(you?.underlay[0]).not.toContain(`/${id}`)
    }
  })

  it('an away player’s pass is skipped at the deadline, and the chain carries on', () => {
    const { room, submit } = chainGame(4, 'rotate', ['p4'])
    for (const id of ['p1', 'p2', 'p3']) submit(id)
    expectPhase(room, 'pass') // still pass 1: away players never end a pass early
    vi.advanceTimersByTime((120 + BUILD_GRACE_SEC) * 1000)
    expect(expectPhase(room, 'pass').pass).toBe(1)
    const p4Chain = room.chainIds[room.chainPlan?.chains.findIndex((c) => c.authors[0] === 'p4') ?? -1]
    expect(p4Chain && room.chainPasses.get(p4Chain)).toEqual([])
  })

  it('a chain only one person added to is dropped, not revealed', () => {
    // p4 is away throughout: the chain they started gets passes 2 and 3 only
    // if others add; here everyone but p1 is away after pass 1
    const { room, submit } = chainGame(4, 'rotate', ['p2', 'p3', 'p4'])
    submit('p1')
    // let each pass run out (away players hold it to its deadline)
    while (room.phase.phase === 'pass' && room.round === 1) {
      vi.advanceTimersByTime(room.phase.deadline - Date.now() + BUILD_GRACE_SEC * 1000)
    }
    // every chain has at most one contributor: nothing to reveal or vote on
    expect(room.phase.phase).toBe('scores')
  })

  it('reveal → vote: you cannot vote for a chain you added to; the winners’ artists share the prize', () => {
    const { room, deps, submit } = chainGame(4)
    for (let k = 0; k < 3; k++) for (const id of ids(4)) submit(id)
    const reveal = expectPhase(room, 'chainReveal')
    expect(reveal.chains).toHaveLength(4)
    // passes in order, each by a different hand
    for (const c of reveal.chains) expect(new Set(c.passes.map((p) => p.authorId)).size).toBe(3)
    vi.advanceTimersByTime(reveal.deadline - Date.now())
    expectPhase(room, 'chainVote')
    for (const id of ids(4)) {
      const votable = votableChains(room, id)
      expect(votable).toHaveLength(1) // 4 chains, 3 of them yours
      expect(snap(room, id).you.chainVote?.votable).toEqual(votable)
    }
    const target = votableChains(room, 'p1')[0] ?? ''
    for (const id of ids(4)) {
      recordChainVote(room, id, votableChains(room, id)[0] ?? '')
      dropPendingActor(room, deps, id)
    }
    const awards = expectPhase(room, 'chainAwards')
    expect(awards.chains.find((c) => c.id === target)?.votes).toBeGreaterThan(0)
    const total = [...room.seats.values()].reduce((s, x) => s + x.score, 0)
    expect(total).toBeLessThanOrEqual(4200)
  })

  it('a refresh mid-pass gets the same chain and ghosts back', () => {
    const { room, submit } = chainGame(5)
    for (const id of ids(5)) submit(id)
    const before = snap(room, 'p3').you.pass
    // a reconnect is just a fresh snapshot for the same seat
    expect(snap(room, 'p3').you.pass).toEqual(before)
    expect(before?.underlay).toHaveLength(1)
  })

  it('one picture per chain: those waiting their turn are told when, and can’t upload', () => {
    const { room, submit } = chainGame(3, 'single')
    const waiting = ids(3).filter((id) => passChainOf(room, id) === null)
    expect(waiting).toHaveLength(2)
    for (const id of waiting) {
      expect(snap(room, id).you.pass?.nextPass).toBeGreaterThan(0)
      expect(submit(id)).toEqual({ ok: false, reason: 'wrong_phase' })
    }
  })

  it('every structure at every size runs to the end of the round', () => {
    for (const structure of CHAIN_STRUCTURES) {
      for (const n of [3, 5, 6, 7, 8]) {
        const { room, submit } = chainGame(n, structure)
        for (let guard = 0; guard < 20 && room.phase.phase === 'pass'; guard++) {
          for (const id of ids(n)) if (passChainOf(room, id) !== null) submit(id)
        }
        expect(['chainReveal', 'scores']).toContain(room.phase.phase)
        vi.runOnlyPendingTimers()
      }
    }
  })
})
