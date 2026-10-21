import { describe, it, expect } from 'vitest'
import { LogTail } from '../src/ops/logTail.ts'

describe('the log tail', () => {
  it('keeps the latest lines, oldest first, once it wraps', () => {
    const tail = new LogTail(3)
    for (let i = 1; i <= 5; i++) tail.add('log', `[room BCDF] line ${i}`, i)
    expect(tail.room('BCDF').map((l) => l.text)).toEqual(['line 3', 'line 4', 'line 5'])
    expect(tail.rooms()).toEqual([{ code: 'BCDF', firstAt: 3, lastAt: 5, lines: 3, problems: 0 }])
  })

  it('cuts a runaway line short', () => {
    const tail = new LogTail(2)
    tail.add('error', 'x'.repeat(10_000))
    expect(tail.all()[0]?.text.length).toBe(4001)
  })
})
