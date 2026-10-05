import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { MIN_SCALE } from './layerItem'
import { haptic } from './haptic'
import {
  ROTATION_ESCAPE_DEG,
  ZOOM_ESCAPE,
  detentAt,
  detentEvery,
  jogSpeed,
  normalizeAngle,
  scaleToTrack,
  stepDetent,
  zoomDelta,
  type Held,
} from './transformMath'

// Two precision controls over the canvas's edges, for the selected layer: a
// rotation jog on the left, zoom on the right. Pinch is quick and coarse;
// these are for small corrections and for getting something back upright.
//
// While a finger is on one, it drives the Konva node directly (onPreview)
// and touches React state once, on release (onCommit) — the same split as
// drag and pinch, so a drag never re-renders the canvas per frame.

type Patch = { rotation?: number } | { scale?: number }

type Props = {
  rotation: number
  scale: number
  // the vertical band to sit in, in container pixels
  top: number
  height: number
  onPreview: (patch: Patch) => void
  onCommit: (patch: Patch) => void
  // a finger went down on / came off a slider — the canvas can draw lighter
  // in between (see freezeOthers in Canvas)
  onGestureStart: () => void
  onGestureEnd: () => void
}

// a second tap this soon after a first (that didn't move) is a double-tap
const DOUBLE_TAP_MS = 320
const TAP_SLOP_PX = 8
// the readout lingers this long after the finger lifts
const READOUT_LINGER_MS = 900

// Landing on a detent is shown, not just felt: the track, the handle and the
// readout flash once (.snap in index.css), and the readout stays ringed for
// as long as the value sits on it. Vibration, where there is any, is extra.
function snapTo(slider: HTMLElement | null) {
  haptic()
  if (!slider) return
  slider.classList.remove('snap')
  void slider.offsetWidth // restart the flash
  slider.classList.add('snap')
}

function useReadout(ref: RefObject<HTMLSpanElement | null>) {
  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )
  return {
    show(text: string, atDetent: boolean) {
      const el = ref.current
      if (!el) return
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
      el.textContent = text
      el.classList.add('visible')
      el.classList.toggle('at-detent', atDetent)
    },
    hideSoon() {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => ref.current?.classList.remove('visible'), READOUT_LINGER_MS)
    },
  }
}

// tracks taps on a control so a quick second one can be told apart
function useDoubleTap() {
  const last = useRef<{ time: number; y: number } | null>(null)
  return {
    // a press that's the second half of a double-tap
    isSecond(e: ReactPointerEvent): boolean {
      const prev = last.current
      return prev !== null && e.timeStamp - prev.time < DOUBLE_TAP_MS && Math.abs(e.clientY - prev.y) < TAP_SLOP_PX
    },
    // a press ended: remember it if it was a tap, forget otherwise
    ended(e: ReactPointerEvent, start: { time: number; y: number }, wasTap: boolean) {
      last.current = wasTap && e.timeStamp - start.time < DOUBLE_TAP_MS ? { time: e.timeStamp, y: start.y } : null
    },
    reset() {
      last.current = null
    },
  }
}

const formatAngle = (deg: number) => `${normalizeAngle(Math.round(deg * 10) / 10).toFixed(1)}°`
const formatScale = (scale: number) => `${scale < 0.1 ? scale.toFixed(3) : scale.toFixed(2)}×`
const onQuarterTurn = (deg: number) => deg % 90 === 0

// ---------- rotation: a jog, because rotation wraps

// The handle rests in the middle and springs back. How far it's pushed sets
// how fast the layer turns — up turns clockwise — so there are no ends and
// no jump at ±180°. It catches at 0°, 90°, 180° and 270° with a tick, and
// carries on if pushed. Double-tap: upright.
function RotationJog({
  rotation,
  top,
  height,
  onPreview,
  onCommit,
  onGestureStart,
  onGestureEnd,
}: Omit<Props, 'scale'>) {
  const rootRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)
  const readout = useReadout(readoutRef)
  const taps = useDoubleTap()
  const drag = useRef<{
    pointerId: number
    startY: number
    start: { time: number; y: number }
    from: number
    angle: number
    held: Held
    displacement: number
    raf: number
    lastFrame: number
    moved: boolean
  } | null>(null)
  const half = Math.max(1, height / 2 - 22)

  useEffect(
    () => () => {
      if (drag.current) cancelAnimationFrame(drag.current.raf)
    },
    [],
  )

  const placeHandle = (displacement: number) => {
    const el = handleRef.current
    if (el) el.style.transform = `translate(-50%, calc(-50% + ${-displacement * half}px))`
  }

  const frame = (now: number) => {
    const d = drag.current
    if (!d) return
    const dt = Math.min(0.05, (now - d.lastFrame) / 1000)
    d.lastFrame = now
    const delta = jogSpeed(d.displacement) * dt
    if (delta !== 0) {
      const step = stepDetent(d.angle, delta, d.held, detentEvery(90), ROTATION_ESCAPE_DEG)
      if (step.snapped) snapTo(rootRef.current)
      d.held = step.held
      if (step.value !== d.angle) {
        d.angle = step.value
        onPreview({ rotation: d.angle })
        readout.show(formatAngle(d.angle), d.held !== null)
      }
    }
    d.raf = requestAnimationFrame(frame)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (taps.isSecond(e)) {
      taps.reset()
      snapTo(rootRef.current)
      onPreview({ rotation: 0 })
      onCommit({ rotation: 0 })
      readout.show(formatAngle(0), true)
      readout.hideSoon()
      return
    }
    handleRef.current?.classList.add('active')
    onGestureStart()
    readout.show(formatAngle(rotation), onQuarterTurn(rotation))
    drag.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      start: { time: e.timeStamp, y: e.clientY },
      from: rotation,
      angle: rotation,
      held: null,
      displacement: 0,
      raf: requestAnimationFrame((now) => {
        if (drag.current) drag.current.lastFrame = now
        frame(now)
      }),
      lastFrame: performance.now(),
      moved: false,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    const dy = d.startY - e.clientY
    if (Math.abs(dy) > TAP_SLOP_PX) d.moved = true
    d.displacement = Math.max(-1, Math.min(1, dy / half))
    placeHandle(d.displacement)
  }

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    cancelAnimationFrame(d.raf)
    drag.current = null
    handleRef.current?.classList.remove('active')
    placeHandle(0)
    taps.ended(e, d.start, !d.moved)
    if (d.angle !== d.from) onCommit({ rotation: d.angle })
    onGestureEnd()
    readout.hideSoon()
  }

  // keyboard: a degree per arrow press, ten with shift
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    const next = rotation + step * (e.shiftKey ? 10 : 1)
    onPreview({ rotation: next })
    onCommit({ rotation: next })
    readout.show(formatAngle(next), onQuarterTurn(next))
    readout.hideSoon()
  }

  return (
    <div
      className="layer-slider layer-slider-left"
      ref={rootRef}
      style={{ top, height }}
      role="slider"
      tabIndex={0}
      aria-label="Rotate — push up or down to turn, double-tap to straighten"
      aria-orientation="vertical"
      aria-valuenow={Math.round(normalizeAngle(rotation))}
      aria-valuetext={formatAngle(rotation)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
    >
      <div className="layer-slider-track" />
      <div className="layer-slider-handle jog" ref={handleRef} aria-hidden="true">
        ↻
      </div>
      <span className="layer-slider-readout" ref={readoutRef} aria-hidden="true" />
    </div>
  )
}

// ---------- zoom: an ordinary slider, on a log scale

// Up enlarges. Log, so halving and doubling are the same distance either
// side of 1× and the middle of the travel feels even. A drag moves the scale
// from where it is — it never jumps to the finger — and carries on past the
// ends of the track. Catches at 1× with a tick; double-tap resets to 1×.
// Scales around the layer's centre (its position doesn't change).
function ZoomSlider({
  scale,
  top,
  height,
  onPreview,
  onCommit,
  onGestureStart,
  onGestureEnd,
}: Omit<Props, 'rotation'>) {
  const rootRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)
  const readout = useReadout(readoutRef)
  const taps = useDoubleTap()
  const drag = useRef<{
    pointerId: number
    lastY: number
    start: { time: number; y: number }
    from: number
    logScale: number
    held: Held
    moved: boolean
  } | null>(null)
  const travel = Math.max(1, height - 44)

  const placeHandle = (s: number) => {
    const el = handleRef.current
    if (el) el.style.top = `${22 + (1 - scaleToTrack(s)) * travel}px`
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (taps.isSecond(e)) {
      taps.reset()
      snapTo(rootRef.current)
      onPreview({ scale: 1 })
      onCommit({ scale: 1 })
      placeHandle(1)
      readout.show(formatScale(1), true)
      readout.hideSoon()
      return
    }
    handleRef.current?.classList.add('active')
    onGestureStart()
    readout.show(formatScale(scale), scale === 1)
    drag.current = {
      pointerId: e.pointerId,
      lastY: e.clientY,
      start: { time: e.timeStamp, y: e.clientY },
      from: scale,
      logScale: Math.log(scale),
      held: null,
      moved: false,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    const dy = e.clientY - d.lastY
    if (dy === 0) return
    d.lastY = e.clientY
    if (Math.abs(e.clientY - d.start.y) > TAP_SLOP_PX) d.moved = true
    const step = stepDetent(d.logScale, zoomDelta(dy, travel), d.held, detentAt(0), ZOOM_ESCAPE)
    if (step.snapped) snapTo(rootRef.current)
    d.held = step.held
    d.logScale = Math.max(Math.log(MIN_SCALE), step.value)
    const s = Math.exp(d.logScale)
    onPreview({ scale: s })
    placeHandle(s)
    readout.show(formatScale(s), d.logScale === 0)
  }

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    drag.current = null
    handleRef.current?.classList.remove('active')
    taps.ended(e, d.start, !d.moved)
    const s = Math.exp(d.logScale)
    if (s !== d.from) onCommit({ scale: s })
    onGestureEnd()
    readout.hideSoon()
  }

  // keyboard: 5% per arrow press, 25% with shift
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    const next = Math.max(MIN_SCALE, scale * (1 + step * (e.shiftKey ? 0.25 : 0.05)))
    onPreview({ scale: next })
    onCommit({ scale: next })
    readout.show(formatScale(next), next === 1)
    readout.hideSoon()
  }

  return (
    <div
      className="layer-slider layer-slider-right"
      ref={rootRef}
      style={{ top, height }}
      role="slider"
      tabIndex={0}
      aria-label="Size — drag up to enlarge, double-tap for actual size"
      aria-orientation="vertical"
      aria-valuenow={Math.round(scale * 100) / 100}
      aria-valuetext={formatScale(scale)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
    >
      <div className="layer-slider-track" />
      <span className="layer-slider-end top" aria-hidden="true">
        +
      </span>
      <span className="layer-slider-end bottom" aria-hidden="true">
        −
      </span>
      <div className="layer-slider-tick" style={{ top: 22 + travel / 2 }} aria-hidden="true" />
      <div
        className="layer-slider-handle"
        ref={handleRef}
        style={{ top: 22 + (1 - scaleToTrack(scale)) * travel }}
        aria-hidden="true"
      />
      <span className="layer-slider-readout" ref={readoutRef} aria-hidden="true" />
    </div>
  )
}

export default function LayerSliders(props: Props) {
  return (
    <>
      <RotationJog
        rotation={props.rotation}
        top={props.top}
        height={props.height}
        onPreview={props.onPreview}
        onCommit={props.onCommit}
        onGestureStart={props.onGestureStart}
        onGestureEnd={props.onGestureEnd}
      />
      <ZoomSlider
        scale={props.scale}
        top={props.top}
        height={props.height}
        onPreview={props.onPreview}
        onCommit={props.onCommit}
        onGestureStart={props.onGestureStart}
        onGestureEnd={props.onGestureEnd}
      />
    </>
  )
}
