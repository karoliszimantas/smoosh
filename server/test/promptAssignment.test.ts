import { describe, it, expect } from 'vitest'
import { assignPrompts } from '../src/game/promptAssignment.ts'

describe('assignPrompts', () => {
  const pool = ['A', 'B', 'C', 'D', 'E', 'F']

  it('gives every player a distinct prompt from the pool', () => {
    const { assignments } = assignPrompts(['p1', 'p2', 'p3'], pool, () => 0.5)
    const values = [...assignments.values()]
    expect(new Set(values).size).toBe(3)
    for (const v of values) expect(pool).toContain(v)
  })

  it('never reuses a prompt across rounds, given a shrinking available pool', () => {
    const round1 = assignPrompts(['p1', 'p2'], pool)
    const remaining = pool.filter((p) => !round1.used.includes(p))
    const round2 = assignPrompts(['p1', 'p2'], remaining)
    const overlap = round1.used.filter((p) => round2.used.includes(p))
    expect(overlap).toEqual([])
  })

  it('throws when the available pool is smaller than the number of players', () => {
    expect(() => assignPrompts(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], pool)).toThrow()
  })

  it('produces a deterministic mapping with an injected fake rng', () => {
    const fakeRng = () => 0
    const first = assignPrompts(['p1', 'p2'], pool, fakeRng)
    const second = assignPrompts(['p1', 'p2'], pool, fakeRng)
    expect(first.used).toEqual(second.used)
    expect([...first.assignments.entries()]).toEqual([...second.assignments.entries()])
  })

  it('only ever assigns prompts that came from the provided pool', () => {
    const { assignments } = assignPrompts(['p1', 'p2', 'p3', 'p4'], pool)
    for (const prompt of assignments.values()) {
      expect(pool).toContain(prompt)
    }
  })
})
