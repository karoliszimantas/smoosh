import { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Rect, Image as KonvaImage, Line } from 'react-konva'
import { VISIBLE_STRIP } from '@smoosh/protocol'
import Konva from 'konva'
import type { ImageVariant } from '../assets'
import { generateId } from '../id'
import {
  CANVAS_SIZE,
  FULL_CROP,
  baseSize,
  cropCenterOffset,
  DUPLICATE_OFFSET,
  isFullCrop,
  MAX_ERASE_STROKES,
  MAX_LAYERS,
  MIN_SCALE,
  type CropRect,
  type EraseStroke,
  type LayerItem,
  type Placement,
} from './layerItem'
import { saveCanvasItems, type CanvasStorageArea } from '../game/canvasStorage'
import PromptBar from './PromptBar'
import Toolbar, { type ToolbarMode } from './Toolbar'
import { BRUSH_PX, type BrushSize } from './erase'
import EraseOverlay from './EraseOverlay'
import { loadImage } from './imageCache'
import LayerStrip from './LayerStrip'
import DraggableImage from './DraggableImage'
import CropOverlay from './CropOverlay'
import CanvasFrame from './CanvasFrame'
import LayerSliders from './LayerSliders'
import { pivotAround, turnBetween, type Point } from './transformMath'
import { useTheme } from '../themes/useTheme'
import { buildUnderlay, passImageUrl } from './chainUnderlay'

Konva.hitOnDragEnabled = true

// The sheet (search, result cards, the cut client) is its own chunk so none
// of it weighs on first paint; Canvas starts fetching it on mount, well
// before anyone can tap Add.
const loadAssetSheet = () => import('./AssetSheet')
const AssetSheet = lazy(loadAssetSheet)
const ReportDialog = lazy(() => import('./ReportDialog'))

// the square frame: only what's inside it is exported and submitted. It's
// fitted into the stage with this much room around it, so layers can still
// be parked just outside it.
const FRAME_PADDING = 12
// The rotate and zoom sliders float over the frame's edges rather than
// taking room beside it: they show only while a layer is selected, so the
// frame never gives way to them and never changes size. They sit clear of
// the screen edge (see .layer-slider in index.css), and span this much of
// the frame's height, centred on it.
const SLIDER_SPAN = 0.72
// the exported picture is always this many pixels square
const EXPORT_SIZE = 1024
// how much of the page colour covers whatever hangs outside the frame
const OUTSIDE_DIM_OPACITY = 0.62
// far enough past the frame to cover any visible part of the stage
const OUTSIDE = 20000


// long-press a layer to change its depth: hold still this long…
const LONG_PRESS_MS = 400
// …moving further than this first makes it an ordinary drag instead
const LONG_PRESS_SLOP_PX = 10
// then every this-many pixels of vertical finger travel is one layer
const DEPTH_STEP_PX = 40
// Reorder is a vertical gesture. A finger that held still long enough to
// start one, then sets off sideways this far (and mostly sideways) before
// changing depth, meant to drag — people pause before dragging all the time
const REORDER_HANDOFF_PX = 14
// room the depth readout needs above the finger, and half its width
const DEPTH_BADGE_CLEARANCE = 140
const DEPTH_BADGE_HALF_WIDTH = 60

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const touchDistance = (p1: Touch, p2: Touch) =>
  Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY)

const touchAngle = (p1: Touch, p2: Touch) =>
  (Math.atan2(p2.clientY - p1.clientY, p2.clientX - p1.clientX) * 180) / Math.PI

// the items array with one layer moved to a new index — z-order lives only
// in array order (0 = back)
function moveToIndex(items: LayerItem[], id: string, to: number): LayerItem[] {
  const from = items.findIndex((i) => i.id === id)
  const item = items[from]
  if (!item || from === to) return items
  const next = items.slice()
  next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

// crop mode works on a draft; nothing changes on the layer until Apply
type Cropping = { id: string; image: HTMLImageElement; draft: CropRect }

// erase mode: which layer, its original image, and the brush
type Erasing = { id: string; image: HTMLImageElement; brush: BrushSize }

// a long-press reorder in progress: the layer, where it'll land, and where
// to show the depth readout (container pixels, at the finger)
type DepthDrag = { id: string; to: number; x: number; y: number; below: boolean }

export type CanvasHandle = {
  exportImage: () => Promise<Blob | null>
}

type CanvasProps = {
  promptText: string
  // called with the flattened WebP once exportImage succeeds — the caller
  // (BuildView) owns what happens with it (upload, etc.). Omit it and the
  // export is downloaded instead (the sandbox, which has no game to submit to)
  onSubmit?: (blob: Blob) => void
  // seeds the items array on mount, e.g. restoring a canvas persisted after
  // a reload mid-BUILD
  initialItems?: LayerItem[]
  // when set, `items` is persisted under this key on every change — omit to
  // opt out (e.g. once a BUILD round's picture has been submitted)
  storageKey?: string
  // sessionStorage by default (a round only needs to survive a reload);
  // localStorage for the sandbox, which should survive closing the tab
  storageArea?: CanvasStorageArea
  // label for the toolbar's export button
  doneLabel?: string
  // no prompt to seed the asset sheet's tabs from — it offers the curated
  // categories instead
  freestyle?: boolean
  // the asset sheet offers "Your photo" — off when the room's host says so
  allowPhotos?: boolean
  // chain: the earlier passes, drawn under the layers as ghosts with the
  // bottom strip in full (chainUnderlay.ts) — never part of the export
  underlay?: readonly string[]
  // chain: at most this many layers
  maxLayers?: number
  // chain: export only this player's layers, on a transparent ground
  transparentExport?: boolean
}

function downloadBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `smoosh-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webp`
  a.click()
  // the click has started the download by the time this runs
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  {
    promptText,
    onSubmit,
    initialItems,
    storageKey,
    storageArea = 'session',
    doneLabel,
    freestyle = false,
    allowPhotos = true,
    underlay,
    maxLayers,
    transparentExport = false,
  },
  ref,
) {
  const [items, setItems] = useState<LayerItem[]>(() => initialItems ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [reportTarget, setReportTarget] = useState<number | null>(null)
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })
  const [cropping, setCropping] = useState<Cropping | null>(null)
  const [erasing, setErasing] = useState<Erasing | null>(null)
  // a mode that owns the canvas: no selecting, dragging or reordering layers
  const editing = cropping !== null || erasing !== null
  const [depth, setDepth] = useState<DepthDrag | null>(null)

  // where the square frame sits on screen, and the stage scale that maps
  // CANVAS_SIZE canvas units onto it — centered, as large as fits
  const frame = useMemo(() => {
    const size = Math.max(1, Math.min(stageSize.w, stageSize.h) - FRAME_PADDING * 2)
    return {
      size,
      x: (stageSize.w - size) / 2,
      y: (stageSize.h - size) / 2,
      scale: size / CANVAS_SIZE,
    }
  }, [stageSize])

  const stageRef = useRef<Konva.Stage>(null)
  const frameDecorRef = useRef<Konva.Layer>(null)
  const backgroundRef = useRef<Konva.Layer>(null)
  const itemsLayerRef = useRef<Konva.Layer>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  // the image the current gesture started on (first finger / mouse press).
  // every action in that gesture — drag, pinch-scale, rotate — applies to it
  // alone; extra fingers landing on other images never retarget or move them
  const gestureOwner = useRef<string | null>(null)
  // the last two-finger reading: finger spread, finger angle, and the point
  // between them in canvas units — the pivot the layer turns and scales around
  const pinch = useRef<{ dist: number; angle: number; mid: Point } | null>(null)
  // the pending/active long-press, if any — its cleanup removes its window
  // listeners and timer
  const press = useRef<{
    active: boolean
    cleanup: () => void
    // gives a long-press that turns out to be a sideways drag back to the
    // drag; true if it did
    handOff: (clientX: number, clientY: number) => boolean
  } | null>(null)
  // read by the long-press timer, which fires outside any render
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  // measure the canvas container itself, not the window — it changes size
  // independently (address bar show/hide, the layer strip appearing, rotation)
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setStageSize({ w: width, h: height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    void loadAssetSheet()
  }, [])

  // restore-on-reload persistence. `items` only changes when a gesture or
  // control commits (drag end, pinch end, add, delete, reorder), so this
  // writes once per commit — no debounce, which would lose the last commit
  // when the tab closes or the view unmounts inside the window. Best effort:
  // storage can throw (private browsing, quota) and that must never break
  // the canvas, which saveCanvasItems swallows.
  useEffect(() => {
    if (!storageKey) return
    saveCanvasItems(storageKey, items, storageArea)
  }, [items, storageKey, storageArea])

  const theme = useTheme()
  // read at placement time without making addItem change identity on every
  // theme switch
  const themeRef = useRef(theme)
  useEffect(() => {
    themeRef.current = theme
  }, [theme])

  // the theme's canvas texture, decoded once per theme
  const [texture, setTexture] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!theme.canvasTexture) {
      setTexture(null)
      return
    }
    let cancelled = false
    const image = new window.Image()
    image.onload = () => {
      if (!cancelled) setTexture(image)
    }
    image.src = theme.canvasTexture
    return () => {
      cancelled = true
    }
  }, [theme.canvasTexture])

  // a chain pass's own cap, or the canvas-wide one
  const layerCap = Math.min(maxLayers ?? MAX_LAYERS, MAX_LAYERS)
  const layerCapRef = useRef(layerCap)
  layerCapRef.current = layerCap

  // the earlier passes of a chain, built into one ghosted image
  const underlayKey = underlay?.join('|') ?? ''
  const [underlayImage, setUnderlayImage] = useState<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (!underlayKey) return
    let live = true
    buildUnderlay(underlayKey.split('|').map(passImageUrl)).then(
      (img) => live && setUnderlayImage(img),
      (err: unknown) => console.error('could not draw the earlier passes', err),
    )
    return () => {
      live = false
    }
  }, [underlayKey])

  const addItem = useCallback((placement: Placement) => {
    const id = generateId()
    const jitter = () => (Math.random() - 0.5) * 100 // ±50 units so stacked copies are distinguishable
    setItems((prev) => {
      // the cap holds however the layer arrives
      if (prev.length >= layerCapRef.current) return prev
      return [
      ...prev,
      {
        id,
        src: placement.full,
        thumb: placement.thumb,
        label: placement.label,
        x: CANVAS_SIZE / 2 + jitter(),
        y: CANVAS_SIZE / 2 + jitter(),
        scale: 1,
        // a theme with jitter drops each new layer a little off true —
        // within ±jitter/2. Only on placement: switching theme later
        // never re-rotates anything already placed
        rotation: (Math.random() - 0.5) * themeRef.current.layerJitterDegrees,
        mirrored: false,
        opacity: 1,
        ...(placement.pixabayId !== null ? { pixabayId: placement.pixabayId } : {}),
      },
      ]
    })
    setSelectedId(id)
  }, [])

  // A cut made on this device is placed straight away from a blob: URL; once
  // its upload lands, point the layer at the shared copy instead, so the
  // canvas still restores after a reload (blob: URLs die with the page).
  // DraggableImage keeps showing the old image until the new one decodes.
  const handleCutShared = useCallback((localSrc: string, shared: ImageVariant) => {
    setItems((prev) =>
      prev.map((i) => (i.src === localSrc ? { ...i, src: shared.full, thumb: shared.thumb } : i)),
    )
  }, [])

  // stable identities: DraggableImage is memoized, so these must not be
  // recreated every render or every layer re-renders on any single commit
  const updateItem = useCallback((id: string, patch: Partial<Omit<LayerItem, 'id' | 'src'>>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }, [])

  // crop and erase modes own the selection until they're closed
  const selectItem = useCallback(
    (id: string) => {
      if (!editing) setSelectedId(id)
    },
    [editing],
  )

  const isGestureOwner = useCallback((id: string) => gestureOwner.current === id, [])

  // Fingers are counted with targetTouches — only those that started on the
  // canvas. `touches` is every finger on the screen: a thumb resting on a
  // slider would make a one-finger drag a "pinch", and leave the gesture
  // never ending (so the next touch never picked a new target).
  const handlePointerDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // only the first contact of a gesture picks its target
    if ('touches' in e.evt && e.evt.targetTouches.length > 1) return
    // crop handles and the eraser live on the stage too; they mustn't change
    // the selection
    if (editing) return
    const id = e.target.getClassName() === 'Image' ? e.target.id() : null
    gestureOwner.current = id
    // selecting must not reorder — the items array is the single source of
    // truth for z-order; Konva's own child order is never touched
    setSelectedId(id)
    const point = 'touches' in e.evt ? e.evt.targetTouches[0] : e.evt
    if (id && point) startPress(id, point.clientX, point.clientY)
  }

  const cancelPress = () => {
    press.current?.cleanup()
    press.current = null
  }

  useEffect(() => cancelPress, [])

  // Long-press a layer, then slide up (toward the front) or down (toward
  // the back); release to commit. Tracked with window pointer events so it
  // follows the finger wherever it goes. Before the timer fires this is
  // just an ordinary drag — moving past the slop, or a second finger
  // landing (a pinch), cancels it.
  const startPress = (id: string, startX: number, startY: number) => {
    cancelPress()
    const node = stageRef.current?.findOne<Konva.Image>(`#${id}`)
    if (!node) return
    const startPos = node.position()
    const startAbs = node.absolutePosition()
    let last = { x: startX, y: startY }
    let from = -1
    let to = -1

    // the readout sits above the finger (which would hide it), unless that
    // would push it out of the canvas — then below; and never off the sides
    const badgeAt = (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      const x = clientX - (rect?.left ?? 0)
      const y = clientY - (rect?.top ?? 0)
      const width = rect?.width ?? 0
      return { x: clamp(x, DEPTH_BADGE_HALF_WIDTH, width - DEPTH_BADGE_HALF_WIDTH), y, below: y < DEPTH_BADGE_CLEARANCE }
    }

    const activate = () => {
      from = itemsRef.current.findIndex((i) => i.id === id)
      if (from === -1 || itemsRef.current.length < 2) {
        cancelPress()
        return
      }
      to = from
      state.active = true
      // undo the few pixels the drag moved while the finger settled, and
      // end it — from here the finger picks depth, not position
      node.position(startPos)
      node.stopDrag()
      if ('vibrate' in navigator) navigator.vibrate(12)
      setDepth({ id, to, ...badgeAt(last.x, last.y) })
    }

    const onMove = (e: PointerEvent) => {
      if (!e.isPrimary) return
      last = { x: e.clientX, y: e.clientY }
      if (!state.active) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) > LONG_PRESS_SLOP_PX) cancelPress()
        return
      }
      const steps = Math.round((startY - e.clientY) / DEPTH_STEP_PX)
      const next = clamp(from + steps, 0, itemsRef.current.length - 1)
      // a tick per step, so depth can be felt without looking
      if (next !== to && 'vibrate' in navigator) navigator.vibrate(8)
      to = next
      setDepth({ id, to, ...badgeAt(e.clientX, e.clientY) })
    }

    const onDown = (e: PointerEvent) => {
      // a second finger before the long-press fires: it's a pinch
      if (!e.isPrimary && !state.active) cancelPress()
    }

    const onUp = (e: PointerEvent) => {
      if (!e.isPrimary) return
      if (state.active) setItems((prev) => moveToIndex(prev, id, to))
      cancelPress()
    }

    const timer = window.setTimeout(activate, LONG_PRESS_MS)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)

    // called from the stage's own move handlers, after Konva has recorded
    // the finger's current position, so the drag it restarts follows the
    // finger from exactly where it is
    const handOff = (clientX: number, clientY: number): boolean => {
      if (!state.active || to !== from) return false
      const dy = clientY - startY
      const sideways = clientX - startX
      if (Math.abs(sideways) < REORDER_HANDOFF_PX || Math.abs(sideways) < Math.abs(dy) * 1.5) return false
      cancelPress()
      // put the layer where it would be had it been dragging all along, then
      // resume Konva's drag on this finger — no jump, no lost movement
      node.absolutePosition({ x: startAbs.x + (clientX - startX), y: startAbs.y + (clientY - startY) })
      node.startDrag()
      return true
    }

    const state = {
      active: false,
      handOff,
      cleanup: () => {
        window.clearTimeout(timer)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerdown', onDown)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        setDepth(null)
      },
    }
    press.current = state
  }

  const ownerNode = () => {
    const id = gestureOwner.current
    return id ? stageRef.current?.findOne<Konva.Image>(`#${id}`) : undefined
  }

  // While one layer is being turned or scaled, every frame redraws the whole
  // layer stack — and the theme's blurred shadows are by far the costliest
  // part of that. So for the length of the gesture the other layers draw
  // from a snapshot (shadow baked in, at the resolution they're shown at),
  // and only the moving one is drawn live. Everything stays touchable — a
  // thumb on a slider mustn't stop another finger dragging a layer.
  const freezeOthers = useCallback((activeId: string) => {
    const layer = itemsLayerRef.current
    if (!layer) return
    for (const node of layer.find<Konva.Image>('Image')) {
      if (node.id() === activeId || !node.visible()) continue
      const onScreen = Math.abs(node.getAbsoluteScale().x) * Konva.pixelRatio
      const side = Math.max(1, node.width(), node.height())
      node.cache({ pixelRatio: Math.max(0.1, Math.min(onScreen, 2048 / side)) })
    }
  }, [])
  const thawAll = useCallback(() => {
    const layer = itemsLayerRef.current
    if (!layer) return
    for (const node of layer.find<Konva.Image>('Image')) node.clearCache()
    layer.batchDraw()
  }, [])

  // A layer's shadow is sized for its scale (DraggableImage divides the
  // scale out, so it's the same on screen at any size). While a gesture
  // rescales the node directly that sizing goes stale — the shadow would
  // swell with the layer, then snap back on release — so it's kept in step.
  const rescaleNode = (node: Konva.Image, scale: number) => {
    const k = Math.abs(node.scaleX()) / scale
    node.scaleX(scale * (node.scaleX() < 0 ? -1 : 1))
    node.scaleY(scale)
    node.shadowBlur(node.shadowBlur() * k)
    node.shadowOffsetX(node.shadowOffsetX() * k)
    node.shadowOffsetY(node.shadowOffsetY() * k)
  }

  // the point between two fingers, in the layer's canvas units
  const fingerMidpoint = (node: Konva.Node, t0: Touch, t1: Touch): Point | null => {
    const stage = stageRef.current
    const parent = node.getParent()
    if (!stage || !parent) return null
    const rect = stage.container().getBoundingClientRect()
    return parent
      .getAbsoluteTransform()
      .copy()
      .invert()
      .point({ x: (t0.clientX + t1.clientX) / 2 - rect.left, y: (t0.clientY + t1.clientY) / 2 - rect.top })
  }

  const handleTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.targetTouches
    const touch0 = touches[0]
    const touch1 = touches[1]
    if (touches.length === 1 && touch0) {
      press.current?.handOff(touch0.clientX, touch0.clientY)
      return
    }
    if (touches.length !== 2 || !touch0 || !touch1) return
    if (press.current?.active) return
    const node = ownerNode()
    // a pinch only ever acts on the selected layer
    if (!node || node.id() !== selectedId) return

    e.evt.preventDefault()
    const dist = touchDistance(touch0, touch1)
    const angle = touchAngle(touch0, touch1)
    const mid = fingerMidpoint(node, touch0, touch1)
    if (!mid) return

    if (!pinch.current) {
      node.stopDrag()
      freezeOthers(node.id())
      pinch.current = { dist, angle, mid }
      return
    }

    const was = Math.abs(node.scaleX())
    const scale = Math.max(MIN_SCALE, was * (dist / pinch.current.dist))
    const turn = turnBetween(pinch.current.angle, angle)
    // turn and scale around the point between the fingers (which may itself
    // have moved): the layer spins and shifts like a photo turned on a table
    node.position(pivotAround(node.position(), pinch.current.mid, mid, scale / was, turn))
    // keeps the mirroring sign, and the shadow's on-screen size
    rescaleNode(node, scale)
    node.rotation(node.rotation() + turn)
    pinch.current = { dist, angle, mid }
  }

  const handleTouchEnd = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const remaining = e.evt.targetTouches.length
    if (pinch.current && remaining < 2) {
      pinch.current = null
      thawAll()
      const node = ownerNode()
      if (node) {
        updateItem(node.id(), {
          x: node.x(),
          y: node.y(),
          scale: Math.abs(node.scaleX()),
          rotation: node.rotation(),
        })
        // one finger is still down after the pinch — Konva's own drag was
        // stopped mid-gesture, so restart it from here or the layer freezes
        // until re-touched, then jumps. Pin it to the finger still down: a
        // bare startDrag() anchors to the touchend's changed pointer — the
        // finger just lifted — so the layer leapt by the gap between fingers
        const stillDown = e.evt.targetTouches[0]
        if (remaining === 1 && stillDown) node.startDrag({ pointerId: stillDown.identifier, evt: e.evt })
      }
    }
    if (remaining === 0) gestureOwner.current = null
  }

  // A copy of the selected layer — every transform, crop, eraser strokes,
  // mirror and opacity — just above it and a step down-right, then selected,
  // so tapping again steps on from the copy rather than stacking in place.
  // The copy names the same src, so it draws from the image already decoded
  // (imageCache), and shares the original's stroke list and so its erased
  // canvas (erasedFor) until either is erased further. Nothing is fetched.
  const duplicateSelected = useCallback(() => {
    const source = items.find((i) => i.id === selectedId)
    if (!source || items.length >= layerCapRef.current) return
    // step back the other way rather than off the edge of the frame
    const step = (v: number) => (v + DUPLICATE_OFFSET > CANVAS_SIZE * 0.95 ? v - DUPLICATE_OFFSET : v + DUPLICATE_OFFSET)
    // a copy of a locked layer comes out unlocked, ready to move
    const copy: LayerItem = { ...source, id: generateId(), x: step(source.x), y: step(source.y), locked: false }
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === source.id)
      if (idx === -1 || prev.length >= layerCapRef.current) return prev
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)]
    })
    setSelectedId(copy.id)
  }, [items, selectedId])

  const deleteSelected = useCallback(() => {
    // a locked layer can't be deleted by accident any more than moved
    if (items.find((i) => i.id === selectedId)?.locked) return
    setItems((prev) => prev.filter((i) => i.id !== selectedId || i.locked === true))
    setSelectedId(null)
  }, [items, selectedId])

  // z-order lives only in the items array's index (0 = back). The toolbar
  // moves the selected layer one step at a time — swapping it with its
  // neighbour — so it can land between two others; long-pressing the layer
  // on the canvas is the way to jump it straight to an exact position.
  const moveSelected = useCallback(
    (step: 1 | -1) => {
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.id === selectedId)
        const target = idx + step
        if (idx === -1 || target < 0 || target >= prev.length) return prev
        const next = prev.slice()
        const item = next[idx]
        const neighbour = next[target]
        if (!item || !neighbour) return prev
        next[idx] = neighbour
        next[target] = item
        return next
      })
    },
    [selectedId],
  )
  const moveSelectedForward = useCallback(() => moveSelected(1), [moveSelected])
  const moveSelectedBackward = useCallback(() => moveSelected(-1), [moveSelected])

  const toggleLockSelected = useCallback(() => {
    setItems((prev) => prev.map((i) => (i.id === selectedId ? { ...i, locked: !i.locked } : i)))
  }, [selectedId])

  const mirrorSelected = useCallback(() => {
    setItems((prev) => prev.map((i) => (i.id === selectedId ? { ...i, mirrored: !i.mirrored } : i)))
  }, [selectedId])

  // Opacity: the slider previews on the Konva node directly and commits to
  // state once, on release — the same split as drag and pinch
  const previewOpacity = useCallback(
    (opacity: number) => {
      const node = selectedId ? stageRef.current?.findOne<Konva.Image>(`#${selectedId}`) : undefined
      node?.opacity(opacity)
      node?.getLayer()?.batchDraw()
    },
    [selectedId],
  )
  const commitOpacity = useCallback(
    (opacity: number) => {
      if (selectedId) updateItem(selectedId, { opacity })
    },
    [selectedId, updateItem],
  )

  // The rotate and zoom sliders: same split — the node while a finger is on
  // one, state once on release. Both pivot on the layer's centre, which is
  // its position, so only rotation/scale change.
  const previewTransform = useCallback(
    (patch: { rotation?: number; scale?: number }) => {
      const node = selectedId ? stageRef.current?.findOne<Konva.Image>(`#${selectedId}`) : undefined
      if (!node) return
      if (patch.rotation !== undefined) node.rotation(patch.rotation)
      if (patch.scale !== undefined) rescaleNode(node, patch.scale)
      node.getLayer()?.batchDraw()
    },
    [selectedId],
  )
  const commitTransform = useCallback(
    (patch: { rotation?: number; scale?: number }) => {
      if (selectedId) updateItem(selectedId, patch)
    },
    [selectedId, updateItem],
  )

  // Crop and erase work on the ORIGINAL image, from the shared image cache —
  // not on whatever the layer's node currently draws (a themed paper
  // canvas, an erased copy)
  const startCrop = useCallback(() => {
    const item = items.find((i) => i.id === selectedId)
    if (!item) return
    void loadImage(item.src).then(
      (image) => setCropping({ id: item.id, image, draft: item.crop ?? FULL_CROP }),
      () => {}, // not loadable — the layer isn't showing either; nothing to crop
    )
  }, [items, selectedId])

  const startErase = useCallback(() => {
    const item = items.find((i) => i.id === selectedId)
    if (!item) return
    void loadImage(item.src).then(
      (image) => setErasing({ id: item.id, image, brush: 'M' }),
      () => {},
    )
  }, [items, selectedId])

  const setBrush = useCallback((brush: BrushSize) => setErasing((prev) => (prev ? { ...prev, brush } : prev)), [])

  const setErase = useCallback((id: string, update: (strokes: EraseStroke[]) => EraseStroke[]) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i
        const strokes = update(i.erase ?? [])
        const next: LayerItem = { ...i }
        if (strokes.length > 0) next.erase = strokes
        else delete next.erase
        return next
      }),
    )
  }, [])

  // one finger-down to finger-up is one stroke, and one undo step
  const addEraseStroke = useCallback(
    (stroke: EraseStroke) => {
      if (erasing) setErase(erasing.id, (s) => (s.length >= MAX_ERASE_STROKES ? s : [...s, stroke]))
    },
    [erasing, setErase],
  )
  const undoErase = useCallback(() => {
    if (erasing) setErase(erasing.id, (s) => s.slice(0, -1))
  }, [erasing, setErase])
  const resetErase = useCallback(() => {
    if (erasing) setErase(erasing.id, () => [])
  }, [erasing, setErase])
  const finishErase = useCallback(() => setErasing(null), [])

  const setCropDraft = useCallback(
    (draft: CropRect) => setCropping((prev) => (prev ? { ...prev, draft } : prev)),
    [],
  )
  const resetCrop = useCallback(() => setCropDraft(FULL_CROP), [setCropDraft])
  const cancelCrop = useCallback(() => setCropping(null), [])

  // the layer's position is its visible part's centre, so a new crop moves
  // that centre — shift it so the image itself stays exactly where it was
  const applyCrop = useCallback(() => {
    if (!cropping) return
    const { id, image, draft } = cropping
    const nextCrop = isFullCrop(draft) ? undefined : draft
    const base = baseSize(image)
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i
        const was = cropCenterOffset(i.crop ?? FULL_CROP, base, i)
        const now = cropCenterOffset(nextCrop ?? FULL_CROP, base, i)
        const next: LayerItem = { ...i, x: i.x - was.x + now.x, y: i.y - was.y + now.y }
        if (nextCrop) next.crop = nextCrop
        else delete next.crop
        return next
      }),
    )
    setCropping(null)
  }, [cropping])

  const openSheet = useCallback(() => setSheetOpen(true), [])
  const closeSheet = useCallback(() => {
    setSheetOpen(false)
    addButtonRef.current?.focus()
  }, [])
  const handleAssetSelect = useCallback((placement: Placement) => addItem(placement), [addItem])

  const exportImage = useCallback(async (): Promise<Blob | null> => {
    const stage = stageRef.current
    if (!stage) return null

    const selectedNode = selectedId ? stage.findOne<Konva.Image>(`#${selectedId}`) : null
    const frameDecor = frameDecorRef.current
    // a round can end mid-crop: export the layer as last applied, without
    // the crop mode's dimming and handles
    const cropOverlay = stage.findOne<Konva.Layer>('.crop-overlay')
    const eraseOverlay = stage.findOne<Konva.Layer>('.erase-overlay')
    const editedId = cropping?.id ?? erasing?.id
    const croppingNode = editedId ? stage.findOne<Konva.Image>(`#${editedId}`) : null

    try {
      // hide the selection outline and the frame's border/dimming for the
      // capture without touching React state — avoids the setState+sleep
      // race that could bake them in
      selectedNode?.strokeWidth(0)
      frameDecor?.visible(false)
      // a chain pass sends only its own layers
      if (transparentExport) backgroundRef.current?.visible(false)
      cropOverlay?.visible(false)
      eraseOverlay?.visible(false)
      croppingNode?.visible(true)
      stage.batchDraw()

      // only the frame is the picture; anything parked outside it is cut off
      const canvas = stage.toCanvas({
        x: frame.x,
        y: frame.y,
        width: frame.size,
        height: frame.size,
        pixelRatio: EXPORT_SIZE / frame.size,
      })
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/webp', 0.8)
      })
      if (!blob) throw new Error('failed to encode export')

      if (onSubmit) onSubmit(blob)
      else downloadBlob(blob)
      return blob
    } catch (err) {
      console.error('export failed', err)
      return null
    } finally {
      selectedNode?.strokeWidth(3)
      frameDecor?.visible(true)
      backgroundRef.current?.visible(true)
      cropOverlay?.visible(true)
      eraseOverlay?.visible(true)
      croppingNode?.visible(false)
      stage.batchDraw()
    }
  }, [selectedId, onSubmit, frame, cropping, erasing, transparentExport])

  useImperativeHandle(ref, () => ({ exportImage }), [exportImage])

  const selectedIndex = items.findIndex((i) => i.id === selectedId)
  const selectedItem = items[selectedIndex]
  const isSelected = selectedIndex !== -1
  const canMoveFront = isSelected && selectedIndex !== items.length - 1
  const canMoveBack = isSelected && selectedIndex !== 0
  const selectedPixabayId = selectedItem?.pixabayId
  const croppingItem = cropping ? items.find((i) => i.id === cropping.id) : undefined
  const erasingItem = erasing ? items.find((i) => i.id === erasing.id) : undefined
  const toolbarMode: ToolbarMode = croppingItem
    ? 'crop'
    : erasingItem
      ? 'erase'
      : selectedItem?.locked
        ? 'locked'
        : isSelected
          ? 'layer'
          : 'idle'
  // during a long-press reorder the stack previews the new order live
  const shownItems = depth ? moveToIndex(items, depth.id, depth.to) : items

  return (
    <div className="app">
      <PromptBar text={promptText} />

      <div className="canvas-container" ref={containerRef}>
        <Stage
          ref={stageRef}
          width={stageSize.w}
          height={stageSize.h}
          x={frame.x}
          y={frame.y}
          scaleX={frame.scale}
          scaleY={frame.scale}
          onMouseDown={handlePointerDown}
          onTouchStart={handlePointerDown}
          onTouchMove={handleTouchMove}
          onMouseMove={(e) => press.current?.handOff(e.evt.clientX, e.evt.clientY)}
          onTouchEnd={handleTouchEnd}
        >
          <Layer listening={false} ref={backgroundRef}>
            <Rect x={0} y={0} width={CANVAS_SIZE} height={CANVAS_SIZE} fill={theme.canvasBg} />
            {texture && (
              <Rect
                x={0}
                y={0}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                fillPatternImage={texture}
                fillPatternRepeat="repeat"
              />
            )}
            <CanvasFrame frame={theme.canvasFrame} />
            {underlay && underlayImage && (
              <>
                <KonvaImage image={underlayImage} x={0} y={0} width={CANVAS_SIZE} height={CANVAS_SIZE} />
                {/* where the strip begins: below it, the earlier passes as they are */}
                <Line
                  points={[0, CANVAS_SIZE * (1 - VISIBLE_STRIP), CANVAS_SIZE, CANVAS_SIZE * (1 - VISIBLE_STRIP)]}
                  stroke={theme.chromeBorder}
                  strokeWidth={1.5}
                  dash={[10, 8]}
                  strokeScaleEnabled={false}
                />
              </>
            )}
          </Layer>
          <Layer listening={!editing} ref={itemsLayerRef}>
            {shownItems.map((item) => (
              <DraggableImage
                key={item.id}
                item={item}
                isSelected={item.id === selectedId}
                hidden={item.id === croppingItem?.id || item.id === erasingItem?.id}
                // the layer being reordered stands out from the rest
                dimmed={depth !== null && item.id !== depth.id}
                isGestureOwner={isGestureOwner}
                onChange={updateItem}
              />
            ))}
          </Layer>
          {/* above the images: dims whatever hangs outside the frame, so it
              reads as "not in the picture"; never takes a tap */}
          <Layer listening={false} ref={frameDecorRef}>
            <Rect x={-OUTSIDE} y={-OUTSIDE} width={2 * OUTSIDE + CANVAS_SIZE} height={OUTSIDE} fill={theme.pageBg} opacity={OUTSIDE_DIM_OPACITY} />
            <Rect x={-OUTSIDE} y={CANVAS_SIZE} width={2 * OUTSIDE + CANVAS_SIZE} height={OUTSIDE} fill={theme.pageBg} opacity={OUTSIDE_DIM_OPACITY} />
            <Rect x={-OUTSIDE} y={0} width={OUTSIDE} height={CANVAS_SIZE} fill={theme.pageBg} opacity={OUTSIDE_DIM_OPACITY} />
            <Rect x={CANVAS_SIZE} y={0} width={OUTSIDE} height={CANVAS_SIZE} fill={theme.pageBg} opacity={OUTSIDE_DIM_OPACITY} />
            <Rect
              x={0}
              y={0}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              stroke={theme.chromeBorder}
              strokeWidth={1.5}
              strokeScaleEnabled={false}
            />
          </Layer>
          {erasing && erasingItem && (
            <EraseOverlay
              item={erasingItem}
              image={erasing.image}
              stageScale={frame.scale}
              brushPx={BRUSH_PX[erasing.brush]}
              onStroke={addEraseStroke}
            />
          )}
          {cropping && croppingItem && (
            <CropOverlay
              item={croppingItem}
              image={cropping.image}
              draft={cropping.draft}
              stageScale={frame.scale}
              onDraftChange={setCropDraft}
            />
          )}
        </Stage>
        {/* hidden with nothing selected, so what they act on is never a question */}
        {selectedItem && !selectedItem.locked && !editing && !depth && (
          <LayerSliders
            key={selectedItem.id}
            rotation={selectedItem.rotation}
            scale={selectedItem.scale}
            top={frame.y + (frame.size * (1 - SLIDER_SPAN)) / 2}
            height={frame.size * SLIDER_SPAN}
            onPreview={previewTransform}
            onCommit={commitTransform}
            onGestureStart={() => freezeOthers(selectedItem.id)}
            onGestureEnd={thawAll}
          />
        )}
        {depth && (
          <div className={`depth-badge${depth.below ? ' below' : ''}`} style={{ left: depth.x, top: depth.y }} aria-live="polite">
            <span className="depth-badge-hint" aria-hidden="true">
              ▲ front
            </span>
            <span className="depth-badge-count">
              {depth.to + 1} / {items.length}
            </span>
            <span className="depth-badge-hint" aria-hidden="true">
              back ▼
            </span>
          </div>
        )}
      </div>

      <LayerStrip items={shownItems} selectedId={selectedId} onSelect={selectItem} />

      <Toolbar
        mode={toolbarMode}
        selectedId={selectedId}
        addButtonRef={addButtonRef}
        onAdd={openSheet}
        addLimit={{ used: items.length, max: layerCap, perPass: maxLayers !== undefined }}
        onDone={exportImage}
        doneLabel={doneLabel}
        canMoveFront={canMoveFront}
        canMoveBack={canMoveBack}
        onFront={moveSelectedForward}
        onBack={moveSelectedBackward}
        mirrored={selectedItem?.mirrored ?? false}
        opacity={selectedItem?.opacity ?? 1}
        onMirror={mirrorSelected}
        onCrop={startCrop}
        onErase={startErase}
        onDelete={deleteSelected}
        onDuplicate={duplicateSelected}
        onToggleLock={toggleLockSelected}
        onReport={selectedPixabayId !== undefined ? () => setReportTarget(selectedPixabayId) : undefined}
        onOpacityPreview={previewOpacity}
        onOpacityCommit={commitOpacity}
        onCropReset={resetCrop}
        onCropCancel={cancelCrop}
        onCropApply={applyCrop}
        brush={erasing?.brush ?? 'M'}
        onBrush={setBrush}
        canUndoErase={(erasingItem?.erase?.length ?? 0) > 0}
        onEraseUndo={undoErase}
        onEraseReset={resetErase}
        onEraseDone={finishErase}
      />

      <Suspense fallback={null}>
        <AssetSheet
          key={promptText}
          open={sheetOpen}
          promptText={promptText}
          freestyle={freestyle}
          allowPhotos={allowPhotos}
          onClose={closeSheet}
          onPlace={handleAssetSelect}
          onCutShared={handleCutShared}
        />
      </Suspense>

      {reportTarget !== null && (
        <Suspense fallback={null}>
          <ReportDialog
            pixabayId={reportTarget}
            onReported={() => setReportTarget(null)}
            onClose={() => setReportTarget(null)}
          />
        </Suspense>
      )}
    </div>
  )
})

export default Canvas
