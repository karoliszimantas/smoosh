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
  usedPromptWords,
} from './layerItem'
import { saveCanvasItems, type CanvasStorageArea } from '../game/canvasStorage'
import { encodePicture } from '../game/reencode'
import PromptBar from './PromptBar'
import Toolbar, { type ToolbarMode } from './Toolbar'
import { BRUSH_PX, keepErasedFor, type BrushSize } from './erase'
import EraseOverlay from './EraseOverlay'
import { loadImage } from './imageCache'
import LayerStrip from './LayerStrip'
import DraggableImage from './DraggableImage'
import CropOverlay from './CropOverlay'
import LayerSliders from './LayerSliders'
import { pivotAround, turnBetween, type Point } from './transformMath'
import { commitDoc, rewriteDoc, undoDoc, type Doc } from './history'
import { useTheme } from '../themes/useTheme'
import { haptic } from './haptic'
import { isPhotoSrc } from '../photos/photoStore'
import { buildUnderlay, passImageUrl } from './chainUnderlay'
import FrameDecor from './FrameDecor'
import { applyExportLook, hideForExport, nothingInFrame } from './canvasExport'
import { EXPORT_LOOK } from '../themes/exportLook'
import Tape from './Tape'
import SelectionOverlay from './SelectionOverlay'
import CutOverlay from './CutOverlay'
import { CUT_FAILED_TEXT, CUT_TOO_SLOW_TEXT, dropCut, landCuts, notesOnCut, withoutCut, type CutUpdate, type LandedCut } from './cutSwap'
import './canvas.css'
import type { SheetMode } from './AssetSheet'

Konva.hitOnDragEnabled = true

// The sheet (search, result cards, the cut client) is its own chunk so none
// of it weighs on first paint; Canvas starts fetching it on mount, well
// before anyone can tap Add.
const loadAssetSheet = () => import('./AssetSheet')
const AssetSheet = lazy(loadAssetSheet)
const ReportDialog = lazy(() => import('./ReportDialog'))

// the square frame: only what's inside it is exported and submitted. It's
// fitted into the stage with this much room around it — the screen's gutter
// — so layers can still be parked just outside it, and the paper's tape and
// shadow have somewhere to fall.
const FRAME_PADDING = 16
// the tape holding the paper down, off its top-left corner (screen px)
const TAPE_OFFSET = { x: -12, y: -10 }
// The rotate and zoom sliders float over the frame's edges rather than
// taking room beside it: they show only while a layer is selected, so the
// frame never gives way to them and never changes size. They sit clear of
// the screen edge (see .layer-slider in index.css), and span this much of
// the frame's height, centred on it.
const SLIDER_SPAN = 0.72
// the exported picture is always this many pixels square
const EXPORT_SIZE = 1024
// the picture's paper as it's sent, whatever the theme on screen
const EXPORT_PAPER = { fill: EXPORT_LOOK.canvasBg }
// how long a passing note over the canvas stays
const TOAST_MS = 4000
// how long words stay on a layer (a phone too slow to cut)
const LAYER_NOTE_MS = 4000

// the clean preview's fade in and out
const PREVIEW_FADE_MS = 150
// a mousedown this soon after a touch is that touch's compatibility echo
const COMPAT_MOUSE_MS = 1000

// The size, on screen, the room will judge the picture at — read from the
// same rules the screens use, so it can't drift from them
function previewSize(at: 'guess' | 'grid' | undefined, canvasSize: number): number {
  if (at === 'grid') {
    // Gallery's and Chain's vote grid: two tiles a row — 158px at 390 wide,
    // 123px at 320 (.vote-grid, .vote-view)
    return Math.max(80, Math.round((window.innerWidth - 74) / 2))
  }
  if (at === 'guess') {
    // the guessing screen's picture: .guess-view .picture-frame's size
    const view = document.createElement('div')
    view.className = 'guess-view'
    view.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;left:0;top:0'
    const frame = document.createElement('div')
    frame.className = 'picture-frame'
    view.appendChild(frame)
    document.body.appendChild(view)
    const size = frame.getBoundingClientRect().width
    view.remove()
    if (size > 0) return Math.round(size)
  }
  return Math.round(canvasSize)
}

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

// what the export knows about the picture beyond its pixels
export type ExportInfo = {
  // nothing on it: no layers, or none inside the frame
  blank: boolean
}

type CanvasProps = {
  promptText: string
  // called with the flattened picture once exportImage succeeds — WebP, or
  // JPEG/PNG where the browser can't write WebP (encodePicture) — the caller
  // (BuildView) owns what happens with it (upload, etc.). Omit it and the
  // export is downloaded instead (the sandbox, which has no game to submit to)
  onSubmit?: (blob: Blob, info: ExportInfo) => void
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
  // seconds until the picture is sent by itself, in the last ten: Done
  // says so
  doneAutoIn?: number | null
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
  // hold on empty canvas to see the picture alone, at the size the room
  // will judge it: 'guess' — the guessing screen's picture; 'grid' — a tile
  // in Gallery's or Chain's voting grid. Absent (the sandbox): canvas size
  previewAt?: 'guess' | 'grid'
  // laid out and measured, but not shown or reachable: the prompt window is
  // over it, before the build clock starts
  concealed?: boolean
}

function downloadBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  // named by what the browser actually wrote — Safari writes no WebP
  const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/png' ? 'png' : 'webp'
  a.download = `smoosh-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`
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
    doneAutoIn = null,
    freestyle = false,
    allowPhotos = true,
    underlay,
    maxLayers,
    transparentExport = false,
    concealed = false,
    previewAt,
  },
  ref,
) {
  // the layers and their undo history, changed together in one update so
  // every change is exactly one step (history.ts)
  // a cut that was running when the page went has gone with it
  const [doc, setDoc] = useState<Doc<LayerItem[]>>(() => ({ items: initialItems?.map(withoutCut) ?? [], past: [] }))
  const items = doc.items
  // every change to the layers goes through here, and so into history
  const setItems = useCallback((change: (prev: LayerItem[]) => LayerItem[]) => setDoc((d) => commitDoc(d, change)), [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheetMode, setSheetMode] = useState<SheetMode>('closed')
  // the prompt word chip that last asked for its tab, numbered so that
  // asking again for the same word is still a new request
  const [tabRequest, setTabRequest] = useState<{ key: string; seq: number } | null>(null)
  // whatever opened the sheet gets the focus back when it closes
  const sheetOpener = useRef<HTMLElement | null>(null)
  const [reportTarget, setReportTarget] = useState<number | null>(null)
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })
  const [cropping, setCropping] = useState<Cropping | null>(null)
  const [erasing, setErasing] = useState<Erasing | null>(null)
  // a mode that owns the canvas: no selecting, dragging or reordering layers
  const editing = cropping !== null || erasing !== null
  const [depth, setDepth] = useState<DepthDrag | null>(null)
  // a passing note over the canvas, said once (a cut that didn't work)
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  // words on a layer for a moment, in the cut overlay's chip: a phone too
  // slow to cut kept the whole picture
  const [layerNotes, setLayerNotes] = useState<{ id: string; label: string; until: number }[]>([])
  useEffect(() => {
    if (layerNotes.length === 0) return
    const next = Math.min(...layerNotes.map((n) => n.until))
    const timer = window.setTimeout(
      () => setLayerNotes((prev) => prev.filter((n) => n.until > Date.now())),
      Math.max(0, next - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [layerNotes])

  // Cut-outs made on this phone, landed and waiting to go on (cutSwap.ts).
  // They go on as soon as they're here — except onto a layer crop or erase
  // has open, which works on the whole picture's pixels until it's closed
  const [landed, setLanded] = useState<LandedCut[]>([])
  const heldCut = [cropping?.id, erasing?.id]
    .map((id) => (id ? items.find((i) => i.id === id)?.cutting : undefined))
    .find((token) => token !== undefined)
  if (landed.some((l) => l.token !== heldCut)) {
    const ready = landed.filter((l) => l.token !== heldCut)
    setLanded(landed.filter((l) => l.token === heldCut))
    setDoc((d) => rewriteDoc(d, (list) => landCuts(list, ready)))
  }
  // where each running cut has got to, for the chip on its layer: read as
  // the chip is drawn, so progress never re-renders anything
  const cutStatus = useRef(new Map<string, string>())
  const cutLabel = useCallback((token: string) => cutStatus.current.get(token) ?? 'Cutting…', [])

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

  // erased images only for what's on the canvas now: undo history holds old
  // stroke lists, and their images (one image-sized canvas each) mustn't
  // stay alive with them — an undo redraws an older one on demand
  useEffect(() => {
    keepErasedFor(items.flatMap((i) => (i.erase ? [i.erase] : [])))
  }, [items])

  const theme = useTheme()

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
        rotation: 0,
        mirrored: false,
        opacity: 1,
        ...(placement.pixabayId !== null ? { pixabayId: placement.pixabayId } : {}),
        ...(placement.fromWord ? { fromWord: placement.fromWord } : {}),
        ...(placement.cutting ? { cutting: placement.cutting } : {}),
      },
      ]
    })
    setSelectedId(id)
  }, [setItems])

  // A cut made on this device is placed straight away from a blob: URL; once
  // its upload lands, point the layer at the shared copy instead, so the
  // canvas still restores after a reload (blob: URLs die with the page).
  // DraggableImage keeps showing the old image until the new one decodes.
  // Not an undo step, and applied to history too — so undo can never bring
  // back the dead blob: URL.
  const handleCutShared = useCallback((localSrc: string, shared: ImageVariant) => {
    setDoc((d) =>
      rewriteDoc(d, (list) => list.map((i) => (i.src === localSrc ? { ...i, src: shared.full, thumb: shared.thumb } : i))),
    )
    // a cut-out still waiting for crop or erase to close goes on as the shared copy
    setLanded((prev) =>
      prev.some((l) => l.image.full === localSrc)
        ? prev.map((l) => (l.image.full === localSrc ? { ...l, image: { full: shared.full, thumb: shared.thumb } } : l))
        : prev,
    )
  }, [])

  // The sheet's word on a cut it's making for a layer showing the whole
  // picture: how far it's got, the cut-out, or that it didn't work — then
  // the whole picture stays, and the player is told so: in a passing note,
  // or on the layer itself when the phone is too slow to cut at all. A
  // layer deleted (or undone) meanwhile simply isn't there to change.
  const handleCut = useCallback((token: string, update: CutUpdate) => {
    if (update.kind === 'progress') {
      const p = update.progress
      const pct = p.stage === 'download' && p.total > 0 ? Math.floor((p.loaded / p.total) * 100) : 0
      cutStatus.current.set(token, p.stage === 'download' ? `Getting the cutter… ${pct}%` : 'Cutting…')
      return
    }
    cutStatus.current.delete(token)
    if (update.kind === 'done') {
      setLanded((prev) => [...prev, { token, image: update.image, trim: update.trim }])
      return
    }
    const showing = itemsRef.current.some((i) => i.cutting === token)
    if (update.kind === 'tooSlow') {
      const until = Date.now() + LAYER_NOTE_MS
      const notes = notesOnCut(itemsRef.current, token, CUT_TOO_SLOW_TEXT).map((n) => ({ ...n, until }))
      setLayerNotes((prev) => [...prev.filter((p) => !notes.some((n) => n.id === p.id)), ...notes])
    }
    setDoc((d) => rewriteDoc(d, (list) => dropCut(list, token)))
    if (showing && update.kind === 'failed') setToast((prev) => ({ id: (prev?.id ?? 0) + 1, text: CUT_FAILED_TEXT }))
  }, [])

  // stable identities: DraggableImage is memoized, so these must not be
  // recreated every render or every layer re-renders on any single commit
  const updateItem = useCallback(
    (id: string, patch: Partial<Omit<LayerItem, 'id' | 'src'>>) => {
      setItems((prev) => {
        const item = prev.find((i) => i.id === id)
        // a tap that moved nothing, a slider let go where it started: no step
        if (!item || (Object.keys(patch) as (keyof typeof patch)[]).every((k) => item[k] === patch[k])) return prev
        return prev.map((i) => (i.id === id ? { ...i, ...patch } : i))
      })
    },
    [setItems],
  )

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
    // After a touch, the browser also fires a "compatibility" mousedown for
    // it. That's the same finger again, already handled — and it would start
    // a hold with no release ever coming (the touch's pointerup has been and
    // gone), leaving the preview stuck on. Only a real mouse gets past.
    if ('touches' in e.evt) lastTouchAt.current = performance.now()
    else if (performance.now() - lastTouchAt.current < COMPAT_MOUSE_MS) return
    // only the first contact of a gesture picks its target
    if ('touches' in e.evt && e.evt.targetTouches.length > 1) return
    // crop handles and the eraser live on the stage too; they mustn't change
    // the selection
    if (editing) return
    const id = e.target.getClassName() === 'Image' ? e.target.id() : null
    // With the sheet peeking, a tap off the layers puts it away — that tap
    // alone: the new layer stays selected. A layer can still be taken and
    // moved, with the peek staying, ready for the next one
    if (sheetMode === 'peek' && id === null) {
      closeSheet()
      return
    }
    gestureOwner.current = id
    const point = 'touches' in e.evt ? e.evt.targetTouches[0] : e.evt
    // Off the layers (Konva's hit test reads each layer's alpha, so a cut-
    // out's transparent corner counts as off it): held still, this is the
    // clean preview; a tap lets the selection go — when the finger lifts,
    // so that a hold can keep it
    if (id === null) {
      if (point) startHold(point.clientX, point.clientY)
      else setSelectedId(null)
      return
    }
    // selecting must not reorder — the items array is the single source of
    // truth for z-order; Konva's own child order is never touched
    setSelectedId(id)
    if (point) startPress(id, point.clientX, point.clientY)
  }

  // ---- hold on empty canvas: the picture alone, as the room will see it
  //
  // Only while the finger stays down — release, and the build screen is
  // back as it was, the same layer selected. Nothing to tap in or out of,
  // so nobody can get stuck in it. The status strip (the room's clock) stays
  // above it; everything that's the player's own chrome is covered.
  const [preview, setPreview] = useState<{ src: string; size: number; leaving: boolean } | null>(null)
  const hold = useRef<(() => void) | null>(null)
  // when the last touch landed — to tell a real mouse from a touch's echo
  const lastTouchAt = useRef(-Infinity)

  const startHold = (startX: number, startY: number) => {
    hold.current?.()
    let shown = false
    let moved = false
    let fadeOut: number | undefined

    const timer = window.setTimeout(() => {
      if (moved) return
      const size = previewSize(previewAt, frame.size)
      const captured = capturePicture((size * window.devicePixelRatio) / frame.size)
      if (!captured) return
      shown = true
      setPreview({ src: captured.canvas.toDataURL('image/png'), size, leaving: false })
      haptic()
    }, LONG_PRESS_MS)

    const onMove = (e: PointerEvent) => {
      if (!e.isPrimary || shown) return
      // travel before it shows: not a hold — a swipe, or the start of a pinch
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > LONG_PRESS_SLOP_PX) moved = true
    }
    // a second finger before it shows: a pinch, not a hold
    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary && !shown) moved = true
    }
    const finish = () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', finish)
      document.removeEventListener('visibilitychange', finish)
      hold.current = null
      if (shown) {
        // the chrome fades back, then the preview is gone; the selection
        // was never touched
        setPreview((p) => (p ? { ...p, leaving: true } : p))
        fadeOut = window.setTimeout(() => setPreview(null), PREVIEW_FADE_MS)
      } else {
        setSelectedId(null)
      }
    }
    const onUp = (e: PointerEvent) => {
      if (e.isPrimary) finish()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', finish)
    document.addEventListener('visibilitychange', finish)
    hold.current = () => {
      window.clearTimeout(fadeOut)
      finish()
    }
  }

  useEffect(() => () => hold.current?.(), [])

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
      // a cut-out's sticker edge spills past its box (DraggableImage): the
      // snapshot is widened by as much so the rim and its shadow aren't clipped
      const pad = Math.ceil(Number(node.getAttr('stickerPad')) || 0)
      const side = Math.max(1, node.width() + 2 * pad, node.height() + 2 * pad)
      node.cache({ offset: pad, pixelRatio: Math.max(0.1, Math.min(onScreen, 2048 / side)) })
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
  }, [items, selectedId, setItems])

  // ---- drag to the bin to delete
  //
  // While a layer is dragged (one finger — a pinch stops the drag), a bin
  // band covers the strip and toolbar. The finger over it lights it up and
  // fades and shrinks the layer, so a drop there is never blind; letting go
  // there deletes, as one undo step, like the toolbar's Delete. Locked
  // layers can't be dragged, so they never get here.
  // `top`: where the band starts — the top of the layer strip (or of the
  // tools, with no strip showing), measured as the drag begins
  const [binDrag, setBinDrag] = useState<{ id: string; over: boolean; top: number } | null>(null)
  const binRef = useRef<HTMLDivElement>(null)
  const overBin = useRef(false)
  // the layer's own look, put back if it's dragged out of the bin again
  const binLook = useRef<{ opacity: number; scaleX: number; scaleY: number } | null>(null)
  const binDragId = binDrag?.id ?? null
  // a player's own photo has no URL to show (photo: is a key into this
  // device's storage) — the bin keeps its icon for those
  const binThumbSrc = binDrag ? items.find((i) => i.id === binDrag.id)?.thumb : undefined
  const binThumb = binThumbSrc && !isPhotoSrc(binThumbSrc) ? binThumbSrc : undefined

  const restoreBinLook = useCallback((id: string) => {
    const node = stageRef.current?.findOne<Konva.Image>(`#${id}`)
    const look = binLook.current
    binLook.current = null
    if (!node || !look) return
    node.opacity(look.opacity)
    node.scale({ x: look.scaleX, y: look.scaleY })
  }, [])

  useEffect(() => {
    if (!binDragId) return
    const onMove = (e: PointerEvent) => {
      if (!e.isPrimary) return
      const r = binRef.current?.getBoundingClientRect()
      const over = r !== undefined && e.clientY >= r.top && e.clientX >= r.left && e.clientX <= r.right
      if (over === overBin.current) return
      overBin.current = over
      const node = stageRef.current?.findOne<Konva.Image>(`#${binDragId}`)
      if (over && node) {
        binLook.current = { opacity: node.opacity(), scaleX: node.scaleX(), scaleY: node.scaleY() }
        node.opacity(binLook.current.opacity * 0.45)
        node.scale({ x: binLook.current.scaleX * 0.55, y: binLook.current.scaleY * 0.55 })
        haptic()
      } else {
        restoreBinLook(binDragId)
      }
      setBinDrag((d) => (d ? { ...d, over } : d))
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [binDragId, restoreBinLook])

  const handleDragBegin = useCallback((id: string) => {
    overBin.current = false
    binLook.current = null
    // over the strip and the tools: the band begins where the first of them
    // does, so the finger reaches it right under the canvas, while the
    // layer is still in sight to fade and shrink
    const root = containerRef.current?.closest('.app')
    const first = root?.querySelector('.layer-strip, .toolbar-wrap')
    const top = first ? first.getBoundingClientRect().top : window.innerHeight - 136
    setBinDrag({ id, over: false, top })
  }, [])

  const handleDragRelease = useCallback(
    (id: string, at: { x: number; y: number }) => {
      const dropped = overBin.current
      overBin.current = false
      setBinDrag(null)
      if (!dropped) {
        restoreBinLook(id)
        updateItem(id, at)
        return
      }
      binLook.current = null
      setItems((prev) => prev.filter((i) => i.id !== id || i.locked === true))
      setSelectedId((sel) => (sel === id ? null : sel))
      if ('vibrate' in navigator) navigator.vibrate(20)
    },
    [restoreBinLook, setItems, updateItem],
  )

  const deleteSelected = useCallback(() => {
    // a locked layer can't be deleted by accident any more than moved
    if (items.find((i) => i.id === selectedId)?.locked) return
    setItems((prev) => prev.filter((i) => i.id !== selectedId || i.locked === true))
    setSelectedId(null)
  }, [items, selectedId, setItems])

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
    [selectedId, setItems],
  )
  const moveSelectedForward = useCallback(() => moveSelected(1), [moveSelected])
  const moveSelectedBackward = useCallback(() => moveSelected(-1), [moveSelected])

  const toggleLockSelected = useCallback(() => {
    setItems((prev) => prev.map((i) => (i.id === selectedId ? { ...i, locked: !i.locked } : i)))
  }, [selectedId, setItems])

  const mirrorSelected = useCallback(() => {
    setItems((prev) => prev.map((i) => (i.id === selectedId ? { ...i, mirrored: !i.mirrored } : i)))
  }, [selectedId, setItems])

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
  // not on whatever the layer's node currently draws (an erased copy)
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
  }, [setItems])

  // one finger-down to finger-up is one stroke, and one undo step
  const addEraseStroke = useCallback(
    (stroke: EraseStroke) => {
      if (erasing) setErase(erasing.id, (s) => (s.length >= MAX_ERASE_STROKES ? s : [...s, stroke]))
    },
    [erasing, setErase],
  )
  const resetErase = useCallback(() => {
    if (erasing) setErase(erasing.id, () => [])
  }, [erasing, setErase])
  const finishErase = useCallback(() => setErasing(null), [])

  // Undo: the layers as they were before the last change. Not mid-crop —
  // nothing there is committed until Apply or Cancel. A step that takes away
  // the layer being erased (or the selected one) ends that too.
  const canUndo = doc.past.length > 0 && cropping === null
  const undo = useCallback(() => {
    if (cropping) return
    const prev = doc.past[doc.past.length - 1]
    if (!prev) return
    setDoc(undoDoc)
    if (erasing && !prev.some((i) => i.id === erasing.id)) setErasing(null)
    if (selectedId && !prev.some((i) => i.id === selectedId)) setSelectedId(null)
  }, [doc, cropping, erasing, selectedId])

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
  }, [cropping, setItems])

  const openSheet = useCallback(() => {
    sheetOpener.current = addButtonRef.current
    setSheetMode('open')
  }, [])
  // a prompt word's chip: the sheet, on that word's tab
  const openSheetOn = useCallback((term: string) => {
    sheetOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setTabRequest((prev) => ({ key: term, seq: (prev?.seq ?? 0) + 1 }))
    setSheetMode('open')
  }, [])
  const expandSheet = useCallback(() => setSheetMode('open'), [])
  const closeSheet = useCallback(() => {
    setSheetMode('closed')
    const opener = sheetOpener.current ?? addButtonRef.current
    opener?.focus()
  }, [])
  // the prompt words with a layer on the canvas placed from their tab
  const usedWords = useMemo(() => usedPromptWords(items), [items])
  // After a placement the sheet drops to its peek, the new layer selected on
  // the canvas above it — and it's Add that gets the focus back when it's
  // put away. At the layer limit there's no next one: it closes instead.
  const handleAssetSelect = useCallback(
    (placement: Placement): boolean => {
      const count = itemsRef.current.length
      if (count >= layerCapRef.current) return false
      addItem(placement)
      sheetOpener.current = addButtonRef.current
      if (count + 1 >= layerCapRef.current) closeSheet()
      else setSheetMode('peek')
      return true
    },
    [addItem, closeSheet],
  )

  // The picture exactly as it goes out — the frame only, in the export's
  // look (not this player's theme), without the selection, the frame's
  // shadow or a crop or erase mode's overlays — at `pixelRatio` canvas px per
  // screen px of the frame. Shared by the export and the hold-to-preview.
  const capturePicture = useCallback(
    (pixelRatio: number): { canvas: HTMLCanvasElement; blank: boolean } | null => {
      const stage = stageRef.current
      if (!stage) return null

      // a round can end mid-crop: export the layer as last applied, without
      // the crop mode's dimming and handles
      const cropOverlay = stage.findOne<Konva.Layer>('.crop-overlay')
      const eraseOverlay = stage.findOne<Konva.Layer>('.erase-overlay')
      const editedId = cropping?.id ?? erasing?.id
      const croppingNode = editedId ? stage.findOne<Konva.Image>(`#${editedId}`) : null

      // hide everything that isn't the picture (the selection's outline and
      // handles, the frame's shadow and dimming) for the capture without
      // touching React state — avoids the setState+sleep race that could bake
      // them in
      let restoreChrome: (() => void) | null = null
      let restoreLook: (() => void) | null = null
      try {
        restoreChrome = hideForExport(stage)
        // drawn in the export's look, not this player's theme: the same picture
        // whoever built it. A layer frozen mid-gesture (freezeOthers) would
        // draw from its snapshot, in the theme's look — so none is
        for (const node of itemsLayerRef.current?.find<Konva.Image>('Image') ?? []) node.clearCache()
        restoreLook = applyExportLook(stage)
        // a chain pass sends only its own layers
        if (transparentExport) backgroundRef.current?.visible(false)
        cropOverlay?.visible(false)
        eraseOverlay?.visible(false)
        croppingNode?.visible(true)
        stage.batchDraw()

        // only the frame is the picture; anything parked outside it is cut off
        const blank = nothingInFrame(
          itemsRef.current.map((item) => stage.findOne(`#${item.id}`)?.getClientRect() ?? null),
          { x: frame.x, y: frame.y, width: frame.size, height: frame.size },
        )
        const canvas = stage.toCanvas({ x: frame.x, y: frame.y, width: frame.size, height: frame.size, pixelRatio })
        return { canvas, blank }
      } finally {
        restoreLook?.()
        restoreChrome?.()
        backgroundRef.current?.visible(true)
        cropOverlay?.visible(true)
        eraseOverlay?.visible(true)
        croppingNode?.visible(false)
        stage.batchDraw()
      }
    },
    [frame, cropping, erasing, transparentExport],
  )

  const exportImage = useCallback(async (): Promise<Blob | null> => {
    try {
      const captured = capturePicture(EXPORT_SIZE / frame.size)
      if (!captured) return null
      // a chain pass keeps its transparency
      const blob = await encodePicture(captured.canvas, transparentExport, 0.8, 0.85)
      if (!blob) throw new Error('failed to encode export')

      if (onSubmit) onSubmit(blob, { blank: captured.blank })
      else downloadBlob(blob)
      return blob
    } catch (err) {
      console.error('export failed', err)
      return null
    }
  }, [onSubmit, frame, capturePicture, transparentExport])

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
  const cuttingLayers = useMemo(() => items.flatMap((i) => (i.cutting ? [{ id: i.id, token: i.cutting }] : [])), [items])

  return (
    <div className={concealed ? 'app concealed' : 'app'}>
      <PromptBar
        text={promptText}
        freestyle={freestyle}
        usedWords={usedWords}
        onWord={openSheetOn}
        canUndo={canUndo}
        onUndo={undo}
        submitLabel={doneLabel ?? 'Done'}
        onSubmit={() => void exportImage()}
        holdToSubmit={onSubmit !== undefined}
        submitAutoIn={doneAutoIn}
      />

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
            <Rect x={0} y={0} width={CANVAS_SIZE} height={CANVAS_SIZE} fill={theme.canvasBg} exportAttrs={EXPORT_PAPER} />
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
                hidden={item.id === croppingItem?.id || item.id === erasingItem?.id}
                // the layer being reordered stands out from the rest
                dimmed={depth !== null && item.id !== depth.id}
                isGestureOwner={isGestureOwner}
                onDragBegin={handleDragBegin}
                onDragRelease={handleDragRelease}
              />
            ))}
            {selectedItem && (
              <SelectionOverlay
                targetId={selectedItem.id}
                stageScale={frame.scale}
                color={theme.selectionColor}
                handles={!selectedItem.locked}
              />
            )}
          </Layer>
          <CutOverlay
            cutting={cuttingLayers}
            notes={layerNotes}
            stageScale={frame.scale}
            status={cutLabel}
            paper={theme.surface}
            ink={theme.surfaceText}
            font={theme.fontLabel}
          />
          {/* above the images: the frame's dimmed surround and its shadow */}
          <FrameDecor scale={frame.scale} pageBg={theme.pageBg} shadow={theme.shadow.card} />
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
        {/* DOM, so the export (which only sees the stage) can never catch it */}
        {stageSize.w > 0 && <Tape x={frame.x + TAPE_OFFSET.x} y={frame.y + TAPE_OFFSET.y} />}
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
        {/* said once, then gone; never over the frame's middle */}
        <div className="canvas-toasts" aria-live="polite">
          {toast && (
            <p key={toast.id} className="notice notice-toast" style={{ animationDuration: `${TOAST_MS}ms` }}>
              {toast.text}
            </p>
          )}
          {/* the words on a layer are drawn on the canvas: said here too */}
          {layerNotes[0] && <span className="visually-hidden">{layerNotes[0].label}</span>}
        </div>
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

      {binDrag && (
        <div ref={binRef} className={`bin-zone${binDrag.over ? ' over' : ''}`} style={{ top: binDrag.top }} aria-hidden="true">
          <span className="bin-zone-icon">
            {binDrag.over && binThumb ? (
              // which layer is about to go: there's no mistaking it
              <img src={binThumb} alt="" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
              </svg>
            )}
          </span>
          <span className="bin-zone-label">{binDrag.over ? 'Let go to delete' : 'Drag here to delete'}</span>
        </div>
      )}

      {preview && (
        <div
          className={`clean-preview${preview.leaving ? ' leaving' : ''}`}
          style={{ ['--preview-fade' as string]: `${PREVIEW_FADE_MS}ms` }}
          aria-hidden="true"
        >
          <img src={preview.src} width={preview.size} height={preview.size} alt="" />
        </div>
      )}

      <LayerStrip
        items={shownItems}
        selectedId={selectedId}
        onSelect={selectItem}
        canFront={canMoveFront && !selectedItem?.locked && !editing}
        canBack={canMoveBack && !selectedItem?.locked && !editing}
        onFront={moveSelectedForward}
        onBack={moveSelectedBackward}
      />

      <Toolbar
        mode={toolbarMode}
        selectedId={selectedId}
        addButtonRef={addButtonRef}
        onAdd={openSheet}
        addLimit={{ used: items.length, max: layerCap, perPass: maxLayers !== undefined }}
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
        canUndo={canUndo}
        onUndo={undo}
        hasStrokes={(erasingItem?.erase?.length ?? 0) > 0}
        onEraseReset={resetErase}
        onEraseDone={finishErase}
      />

      <Suspense fallback={null}>
        <AssetSheet
          key={promptText}
          mode={sheetMode}
          promptText={promptText}
          freestyle={freestyle}
          allowPhotos={allowPhotos}
          onClose={closeSheet}
          onExpand={expandSheet}
          onPlace={handleAssetSelect}
          onCut={handleCut}
          onCutShared={handleCutShared}
          tabRequest={tabRequest}
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
