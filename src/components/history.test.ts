import { describe, it, expect } from 'vitest'
import { commitDoc, rewriteDoc, undoDoc, type Doc } from './history'

const start: Doc<string[]> = { items: ['a'], past: [] }

describe('undo history', () => {
  it('each change is one step, undone in reverse', () => {
    let d = commitDoc(start, (s) => [...s, 'b'])
    d = commitDoc(d, (s) => [...s, 'c'])
    expect(d.items).toEqual(['a', 'b', 'c'])
    d = undoDoc(d)
    expect(d.items).toEqual(['a', 'b'])
    d = undoDoc(d)
    expect(d.items).toEqual(['a'])
    expect(undoDoc(d)).toBe(d) // nothing left: no-op
  })

  it('a change that changes nothing is not a step', () => {
    expect(commitDoc(start, (s) => s)).toBe(start)
  })

  it('keeps only the last `depth` steps', () => {
    let d = start
    for (let i = 0; i < 40; i++) d = commitDoc(d, (s) => [...s, String(i)], 30)
    expect(d.past).toHaveLength(30)
  })

  it('a rewrite reaches every past state and adds no step', () => {
    const d = commitDoc(start, (s) => [...s, 'blob:x'])
    const fixed = rewriteDoc(d, (s) => s.map((v) => (v === 'blob:x' ? 'r2:x' : v)))
    expect(fixed.past).toHaveLength(1)
    expect(fixed.items).toEqual(['a', 'r2:x'])
  })
})
