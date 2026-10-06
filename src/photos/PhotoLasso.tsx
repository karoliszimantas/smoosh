import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { cutPhoto, isUsableLoop, wholePhoto, type Loop, type Point } from './photoCut'

// Cutting your photo: drag a loop round what you want, let go, done. The
// loop closes itself; draw another to keep more; Undo takes the last one
// back. No feathering, no refining, no magic wand — a wobbly hand-drawn
// edge suits the game better than a clean one, and it takes seconds.

const HINT_KEY = 'smoosh_lasso_hint_seen'
// a new point every few screen pixels — enough for a smooth edge, few
// enough to stay quick
const POINT_SPACING_PX = 3

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return false
  }
}

function markHintSeen(): void {
  try {
    localStorage.setItem(HINT_KEY, '1')
  } catch {
    // shown again next time — harmless
  }
}

export default function PhotoLasso({
  photo,
  onDone,
  onCancel,
}: {
  // the prepared photo (already downscaled, upright, metadata-free)
  photo: HTMLCanvasElement
  onDone: (cut: Blob) => void
  onCancel: () => void
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [loops, setLoops] = useState<Loop[]>([])
  const [showHint] = useState(() => !hintSeen())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // the stroke being drawn, in photo pixels — a ref, redrawn per frame
  const drawing = useRef<{ pointerId: number; points: Point[]; lastScreen: Point } | null>(null)
  const frame = useRef<number | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  // the photo fitted into the space between the bars
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const fit = () => {
      const r = stage.getBoundingClientRect()
      const scale = Math.min(r.width / photo.width, r.height / photo.height)
      setSize({ w: Math.floor(photo.width * scale), h: Math.floor(photo.height * scale) })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [photo])

  const dpr = Math.min(2, window.devicePixelRatio || 1)

  useEffect(() => {
    const base = baseRef.current
    if (!base || size.w === 0) return
    base.width = Math.round(size.w * dpr)
    base.height = Math.round(size.h * dpr)
    base.getContext('2d')?.drawImage(photo, 0, 0, base.width, base.height)
  }, [photo, size, dpr])

  // the overlay: outside the loops dimmed, the loops outlined, and the
  // stroke in progress
  const redraw = useCallback(() => {
    frame.current = null
    const o = overlayRef.current
    if (!o || size.w === 0) return
    if (o.width !== Math.round(size.w * dpr)) {
      o.width = Math.round(size.w * dpr)
      o.height = Math.round(size.h * dpr)
    }
    const ctx = o.getContext('2d')
    if (!ctx) return
    const k = o.width / photo.width
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, o.width, o.height)
    const trace = (loop: readonly Point[], close: boolean) => {
      const [first, ...rest] = loop
      if (!first) return
      ctx.beginPath()
      ctx.moveTo(first.x * k, first.y * k)
      for (const p of rest) ctx.lineTo(p.x * k, p.y * k)
      if (close) ctx.closePath()
    }
    if (loops.length > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(0, 0, o.width, o.height)
      // erased with an opaque fill: under destination-out the fill's alpha is
      // how much dimming goes, and inside a loop all of it should
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = '#000'
      for (const loop of loops) {
        trace(loop, true)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const outline = (loop: readonly Point[], close: boolean) => {
      trace(loop, close)
      ctx.strokeStyle = 'rgba(0,0,0,0.75)'
      ctx.lineWidth = 5 * dpr
      ctx.stroke()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2.5 * dpr
      ctx.stroke()
    }
    for (const loop of loops) outline(loop, true)
    const live = drawing.current
    if (live) outline(live.points, false)
  }, [loops, size, dpr, photo])

  useEffect(() => {
    redraw()
  }, [redraw])

  const scheduleRedraw = () => {
    if (frame.current === null) frame.current = requestAnimationFrame(redraw)
  }
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  const toPhoto = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(photo.width, Math.max(0, ((e.clientX - r.left) / r.width) * photo.width)),
      y: Math.min(photo.height, Math.max(0, ((e.clientY - r.top) / r.height) * photo.height)),
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (drawing.current || busy) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = { pointerId: e.pointerId, points: [toPhoto(e)], lastScreen: { x: e.clientX, y: e.clientY } }
    setError(null)
    scheduleRedraw()
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drawing.current
    if (!d || e.pointerId !== d.pointerId) return
    // every sample the browser coalesced, so a fast loop stays smooth
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    const r = e.currentTarget.getBoundingClientRect()
    for (const s of samples.length > 0 ? samples : [e.nativeEvent]) {
      if (Math.hypot(s.clientX - d.lastScreen.x, s.clientY - d.lastScreen.y) < POINT_SPACING_PX) continue
      d.lastScreen = { x: s.clientX, y: s.clientY }
      d.points.push({
        x: Math.min(photo.width, Math.max(0, ((s.clientX - r.left) / r.width) * photo.width)),
        y: Math.min(photo.height, Math.max(0, ((s.clientY - r.top) / r.height) * photo.height)),
      })
    }
    scheduleRedraw()
  }

  const onPointerEnd = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drawing.current
    if (!d || e.pointerId !== d.pointerId) return
    drawing.current = null
    // let go: the loop closes itself. A tap or a scribble too small to be
    // a shape is dropped
    if (isUsableLoop(d.points, photo.width / 40)) {
      setLoops((prev) => [...prev, d.points])
      if (showHint) markHintSeen()
    } else scheduleRedraw()
  }

  const finish = (chosen: readonly Loop[]) => {
    if (busy || chosen.length === 0) return
    setBusy(true)
    cutPhoto(photo, chosen).then(onDone, () => {
      setBusy(false)
      setError('That didn’t work — try drawing again.')
    })
  }

  return (
    <div className="photo-lasso" role="dialog" aria-modal="true" aria-label="Cut out your photo">
      <div className="photo-lasso-bar">
        <button onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <span className="photo-lasso-title">
          {loops.length === 0 && showHint ? 'Draw around what you want to keep' : 'Your photo'}
        </span>
        <button className="primary" onClick={() => finish(loops)} disabled={busy || loops.length === 0}>
          {busy ? 'Cutting…' : 'Done'}
        </button>
      </div>

      <div className="photo-lasso-stage" ref={stageRef}>
        <div className="photo-lasso-canvas" style={{ width: size.w, height: size.h }}>
          <canvas ref={baseRef} aria-hidden="true" />
          <canvas
            ref={overlayRef}
            className="photo-lasso-draw"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            aria-label="Draw around what you want to keep"
          />
        </div>
      </div>

      <div className="photo-lasso-bar">
        <button onClick={() => setLoops((prev) => prev.slice(0, -1))} disabled={busy || loops.length === 0}>
          Undo
        </button>
        {error && <span className="photo-lasso-error">{error}</span>}
        <button onClick={() => finish([wholePhoto(photo.width, photo.height)])} disabled={busy}>
          Whole photo
        </button>
      </div>
    </div>
  )
}
