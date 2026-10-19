import { describe, expect, it } from 'vitest'
import { eraseOffset, FINGER_CLEARANCE_PX } from './eraseReach'

describe('eraseOffset', () => {
  it('a finger: the whole brush clears the fingertip', () => {
    // a 40px brush: its lower edge FINGER_CLEARANCE_PX above the touch
    expect(eraseOffset('touch', 400, 40)).toBe(FINGER_CLEARANCE_PX + 20)
    expect(eraseOffset('touch', 400, 80)).toBe(FINGER_CLEARANCE_PX + 40)
  })

  it('a mouse or a stylus: right at the pointer', () => {
    expect(eraseOffset('mouse', 400, 40)).toBe(0)
    expect(eraseOffset('pen', 400, 40)).toBe(0)
  })

  it('the very top of the stage is reachable: no offset there', () => {
    expect(eraseOffset('touch', 0, 40)).toBe(0)
  })

  it('near the top the brush still moves with the finger, never back', () => {
    const at = (y: number) => y - eraseOffset('touch', y, 80)
    let last = at(0)
    for (let y = 1; y <= 300; y++) {
      const next = at(y)
      expect(next).toBeGreaterThan(last)
      last = next
    }
    expect(at(0)).toBe(0)
  })

  it('no jump crossing into the top band', () => {
    const full = FINGER_CLEARANCE_PX + 20
    expect(eraseOffset('touch', full * 2, 40)).toBe(full)
    expect(eraseOffset('touch', full * 2 - 0.001, 40)).toBeCloseTo(full, 2)
  })
})
