import { describe, it, expect } from 'vitest'
import { bounds, isUsableLoop, wholePhoto } from './photoCut'

const square = (x: number, y: number, s: number) => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
]

describe('the cut is trimmed to what was drawn', () => {
  it('to the box around every loop, in whole pixels', () => {
    expect(bounds([square(10.4, 20.6, 30)])).toEqual({ x: 10, y: 20, w: 31, h: 31 })
    expect(bounds([square(0, 0, 10), square(50, 60, 10)])).toEqual({ x: 0, y: 0, w: 60, h: 70 })
  })

  it('never past the photo’s edges, however far the finger went', () => {
    expect(bounds([square(-20, -20, 100)], 50, 40)).toEqual({ x: 0, y: 0, w: 50, h: 40 })
  })

  it('the whole photo is one loop round its edges', () => {
    expect(bounds([wholePhoto(800, 600)], 800, 600)).toEqual({ x: 0, y: 0, w: 800, h: 600 })
  })

  it('nothing drawn: an empty box', () => {
    expect(bounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('what counts as a loop', () => {
  it('a tap or a hairline is not a shape', () => {
    expect(isUsableLoop([{ x: 1, y: 1 }])).toBe(false)
    expect(isUsableLoop([{ x: 0, y: 0 }, { x: 100, y: 1 }, { x: 0, y: 2 }])).toBe(false)
    expect(isUsableLoop(square(0, 0, 40))).toBe(true)
  })
})
