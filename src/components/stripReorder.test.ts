import { describe, expect, it } from 'vitest'
import { dropSlot, edgeScroll, partShift } from './stripReorder'

describe('dropSlot', () => {
  it('the nearest slot to the thumbnail’s left edge', () => {
    expect(dropSlot(6, 6, 64, 5)).toBe(0)
    expect(dropSlot(6 + 64 * 2 + 20, 6, 64, 5)).toBe(2)
    expect(dropSlot(6 + 64 * 2 + 40, 6, 64, 5)).toBe(3)
  })

  it('no further than either end', () => {
    expect(dropSlot(-500, 6, 64, 5)).toBe(0)
    expect(dropSlot(5000, 6, 64, 5)).toBe(4)
  })

  it('a single thumbnail has one slot', () => {
    expect(dropSlot(200, 6, 64, 1)).toBe(0)
  })
})

describe('partShift', () => {
  it('moving right: the ones passed close up to the left', () => {
    // from 1 to 3 in [0 1 2 3 4]
    expect([0, 1, 2, 3, 4].map((i) => partShift(i, 1, 3, 64))).toEqual([0, 0, -64, -64, 0])
  })

  it('moving left: the ones passed step to the right', () => {
    // from 3 to 0
    expect([0, 1, 2, 3, 4].map((i) => partShift(i, 3, 0, 64))).toEqual([64, 64, 64, 0, 0])
  })

  it('still over its own slot: nothing moves', () => {
    expect([0, 1, 2].map((i) => partShift(i, 1, 1, 64))).toEqual([0, 0, 0])
  })
})

describe('edgeScroll', () => {
  it('nothing in the middle', () => {
    expect(edgeScroll(150, 0, 300, 40, 10)).toBe(0)
  })

  it('faster the closer to an edge, signed by which', () => {
    expect(edgeScroll(20, 0, 300, 40, 10)).toBe(-5)
    expect(edgeScroll(0, 0, 300, 40, 10)).toBe(-10)
    expect(edgeScroll(280, 0, 300, 40, 10)).toBe(5)
    expect(edgeScroll(400, 0, 300, 40, 10)).toBe(10)
  })

  it('a strip too narrow for two zones never scrolls', () => {
    expect(edgeScroll(10, 0, 60, 40, 10)).toBe(0)
  })
})
