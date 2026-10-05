import { describe, it, expect } from 'vitest'
import {
  JOG_MAX_DEG_PER_SEC,
  ROTATION_ESCAPE_DEG,
  ZOOM_ESCAPE,
  detentAt,
  detentEvery,
  jogSpeed,
  normalizeAngle,
  pivotAround,
  scaleToTrack,
  stepDetent,
  turnBetween,
  zoomDelta,
  type Held,
} from './transformMath'

const close = (p: { x: number; y: number }, q: { x: number; y: number }) => {
  expect(p.x).toBeCloseTo(q.x, 6)
  expect(p.y).toBeCloseTo(q.y, 6)
}

describe('angles', () => {
  it('reads as −180 … 180', () => {
    expect(normalizeAngle(30)).toBe(30)
    expect(normalizeAngle(390)).toBe(30)
    expect(normalizeAngle(-30)).toBe(-30)
    expect(normalizeAngle(-390)).toBe(-30)
    expect(normalizeAngle(270)).toBe(-90)
  })

  it('a finger angle crossing ±180 is a small turn, not nearly a whole one', () => {
    expect(turnBetween(179, -179)).toBeCloseTo(2)
    expect(turnBetween(-179, 179)).toBeCloseTo(-2)
    expect(turnBetween(10, 25)).toBeCloseTo(15)
  })
})

describe('pinch pivots between the fingers', () => {
  it('turning about a point off the layer moves the layer around it', () => {
    // fingers centred at the origin, layer 10 to the right, a quarter turn
    // clockwise (y points down): the layer swings to below the fingers
    close(pivotAround({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 1, 90), { x: 0, y: 10 })
  })

  it('spreading the fingers pushes the layer away from them as it grows', () => {
    close(pivotAround({ x: 10, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 5 }, 2, 0), { x: 20, y: 5 })
  })

  it('moving both fingers carries the layer with them', () => {
    close(pivotAround({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 3 }, 1, 0), { x: 14, y: 3 })
  })

  it('fingers centred on the layer turn it in place', () => {
    close(pivotAround({ x: 7, y: 9 }, { x: 7, y: 9 }, { x: 7, y: 9 }, 1.5, 33), { x: 7, y: 9 })
  })
})

describe('detents', () => {
  const quarter = detentEvery(90)

  it('finds the first quarter turn passed, either way round, past any number of turns', () => {
    expect(quarter(85, 92)).toBe(90)
    expect(quarter(-5, 3)).toBe(0)
    expect(quarter(-85, -95)).toBe(-90)
    expect(quarter(355, 362)).toBe(360)
    expect(quarter(721, 700)).toBe(720)
    expect(quarter(10, 80)).toBeNull()
  })

  it('a value already on a detent leaves it freely', () => {
    expect(quarter(90, 95)).toBeNull()
    expect(quarter(0, -3)).toBeNull()
  })

  it('catches, holds, then lets go when pushed past the escape', () => {
    let step = stepDetent(-2, 3, null, quarter, ROTATION_ESCAPE_DEG)
    expect(step).toEqual({ value: 0, held: { at: 0, push: 0 }, snapped: true })
    step = stepDetent(step.value, ROTATION_ESCAPE_DEG - 1, step.held, quarter, ROTATION_ESCAPE_DEG)
    expect(step.value).toBe(0)
    step = stepDetent(step.value, 2, step.held, quarter, ROTATION_ESCAPE_DEG)
    expect(step.held).toBeNull()
    expect(step.value).toBeCloseTo(1)
  })

  it('can be escaped back the way it came', () => {
    let step = stepDetent(88, 3, null, quarter, ROTATION_ESCAPE_DEG)
    expect(step.value).toBe(90)
    step = stepDetent(step.value, -(ROTATION_ESCAPE_DEG + 1), step.held, quarter, ROTATION_ESCAPE_DEG)
    expect(step.held).toBeNull()
    expect(step.value).toBeCloseTo(89)
  })

  it('a jog held in one direction keeps turning — through every detent, with no wrap', () => {
    let angle = 10
    let held: Held = null
    let snaps = 0
    let previous = angle
    // ten seconds at 60fps, at full speed
    for (let i = 0; i < 600; i++) {
      const step = stepDetent(angle, jogSpeed(1) / 60, held, quarter, ROTATION_ESCAPE_DEG)
      if (step.snapped) snaps++
      held = step.held
      angle = step.value
      expect(angle).toBeGreaterThanOrEqual(previous)
      previous = angle
    }
    expect(angle).toBeGreaterThan(2000)
    // one catch per quarter turn passed
    expect(snaps).toBe(Math.floor(angle / 90))
  })

  it('zoom catches at 1× (log 0) only', () => {
    expect(detentAt(0)(-0.1, 0.05)).toBe(0)
    expect(detentAt(0)(0.2, -0.01)).toBe(0)
    expect(detentAt(0)(0.1, 0.3)).toBeNull()
    expect(stepDetent(0.01, -0.02, null, detentAt(0), ZOOM_ESCAPE).snapped).toBe(true)
  })
})

describe('jog speed', () => {
  it('nothing in the dead zone, full speed at the end, signed', () => {
    expect(jogSpeed(0)).toBe(0)
    expect(jogSpeed(0.03)).toBe(0)
    expect(jogSpeed(1)).toBe(JOG_MAX_DEG_PER_SEC)
    expect(jogSpeed(-1)).toBe(-JOG_MAX_DEG_PER_SEC)
    expect(jogSpeed(5)).toBe(JOG_MAX_DEG_PER_SEC)
  })

  it('the first stretch of travel is for nudging', () => {
    expect(jogSpeed(0.1)).toBeGreaterThan(0)
    expect(jogSpeed(0.1)).toBeLessThan(1)
    expect(jogSpeed(0.25)).toBeLessThan(10)
    for (let u = 0.05; u < 1; u += 0.05) expect(jogSpeed(u + 0.05)).toBeGreaterThan(jogSpeed(u))
  })
})

describe('zoom slider', () => {
  it('1× in the middle, log either side', () => {
    expect(scaleToTrack(1)).toBeCloseTo(0.5)
    expect(scaleToTrack(0.25)).toBeCloseTo(0)
    expect(scaleToTrack(4)).toBeCloseTo(1)
    // halving and doubling sit the same distance from the middle
    expect(scaleToTrack(2) - 0.5).toBeCloseTo(0.5 - scaleToTrack(0.5))
  })

  it('past the ends the handle stays on the track', () => {
    expect(scaleToTrack(0.01)).toBe(0)
    expect(scaleToTrack(50)).toBe(1)
  })

  it('up enlarges; the whole track is ¼× to 4×', () => {
    expect(zoomDelta(-10, 200)).toBeGreaterThan(0)
    expect(Math.exp(zoomDelta(-200, 200))).toBeCloseTo(16)
  })
})
