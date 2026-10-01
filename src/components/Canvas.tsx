import { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Rect } from 'react-konva'
import Konva from 'konva'
import type { ImageVariant } from '../assets'
import { generateId } from '../id'
import { CANVAS_SIZE, type LayerItem, type Placement } from './layerItem'
import { saveCanvasItems, type CanvasStorageArea } from '../game/canvasStorage'
import PromptBar from './PromptBar'
import Toolbar from './Toolbar'
import LayerStrip from './LayerStrip'
import DraggableImage from './DraggableImage'

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
// the exported picture is always this many pixels square
const EXPORT_SIZE = 1024
const FRAME_FILL = '#262626' // matches .picture-display, where submissions are shown
// far enough past the frame to cover any visible part of the stage
const OUTSIDE = 20000

const MIN_SCALE = 0.15
const MAX_SCALE = 5

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const touchDistance = (p1: Touch, p2: Touch) =>
  Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY)

const touchAngle = (p1: Touch, p2: Touch) =>
  (Math.atan2(p2.clientY - p1.clientY, p2.clientX - p1.clientX) * 180) / Math.PI

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
  { promptText, onSubmit, initialItems, storageKey, storageArea = 'session', doneLabel },
  ref,
) {
  const [items, setItems] = useState<LayerItem[]>(() => initialItems ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [reportTarget, setReportTarget] = useState<number | null>(null)
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })

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
  const containerRef = useRef<HTMLDivElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  // the image the current gesture started on (first finger / mouse press).
  // every action in that gesture — drag, pinch-scale, rotate — applies to it
  // alone; extra fingers landing on other images never retarget or move them
  const gestureOwner = useRef<string | null>(null)
  const pinch = useRef<{ dist: number; angle: number } | null>(null)

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

  const addItem = useCallback((placement: Placement) => {
    const id = generateId()
    const jitter = () => (Math.random() - 0.5) * 100 // ±50 units so stacked copies are distinguishable
    setItems((prev) => [
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
        ...(placement.pixabayId !== null ? { pixabayId: placement.pixabayId } : {}),
      },
    ])
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

  const selectItem = useCallback((id: string) => setSelectedId(id), [])

  const isGestureOwner = useCallback((id: string) => gestureOwner.current === id, [])

  const handlePointerDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // only the first contact of a gesture picks its target
    if ('touches' in e.evt && e.evt.touches.length > 1) return
    const id = e.target.getClassName() === 'Image' ? e.target.id() : null
    gestureOwner.current = id
    // selecting must not reorder — the items array is the single source of
    // truth for z-order; Konva's own child order is never touched
    setSelectedId(id)
  }

  const ownerNode = () => {
    const id = gestureOwner.current
    return id ? stageRef.current?.findOne<Konva.Image>(`#${id}`) : undefined
  }

  const handleTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const touch0 = e.evt.touches[0]
    const touch1 = e.evt.touches[1]
    if (e.evt.touches.length !== 2 || !touch0 || !touch1) return
    const node = ownerNode()
    if (!node) return

    e.evt.preventDefault()
    const dist = touchDistance(touch0, touch1)
    const angle = touchAngle(touch0, touch1)

    if (!pinch.current) {
      node.stopDrag()
      pinch.current = { dist, angle }
      return
    }

    const scale = clamp(node.scaleX() * (dist / pinch.current.dist), MIN_SCALE, MAX_SCALE)
    node.scaleX(scale)
    node.scaleY(scale)
    node.rotation(node.rotation() + (angle - pinch.current.angle))
    pinch.current = { dist, angle }
  }

  const handleTouchEnd = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const remaining = e.evt.touches.length
    if (pinch.current && remaining < 2) {
      pinch.current = null
      const node = ownerNode()
      if (node) {
        updateItem(node.id(), { scale: node.scaleX(), rotation: node.rotation() })
        // one finger is still down after the pinch — Konva's own drag was
        // stopped mid-gesture, so restart it from here or the layer freezes
        // until re-touched, then jumps
        if (remaining === 1) node.startDrag()
      }
    }
    if (remaining === 0) gestureOwner.current = null
  }

  const deleteSelected = useCallback(() => {
    setItems((prev) => prev.filter((i) => i.id !== selectedId))
    setSelectedId(null)
  }, [selectedId])

  // z-order lives only in the items array's index (0 = back). The toolbar
  // moves the selected layer one step at a time — swapping it with its
  // neighbour — so it can land between two others; dragging a thumbnail in
  // LayerStrip is the way to jump it straight to an exact position.
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

  const reorderLayers = useCallback((next: LayerItem[]) => setItems(next), [])

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

    try {
      // hide the selection outline and the frame's border/dimming for the
      // capture without touching React state — avoids the setState+sleep
      // race that could bake them in
      selectedNode?.strokeWidth(0)
      frameDecor?.visible(false)
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
      stage.batchDraw()
    }
  }, [selectedId, onSubmit, frame])

  useImperativeHandle(ref, () => ({ exportImage }), [exportImage])

  const selectedIndex = items.findIndex((i) => i.id === selectedId)
  const isSelected = selectedIndex !== -1
  const canMoveFront = isSelected && selectedIndex !== items.length - 1
  const canMoveBack = isSelected && selectedIndex !== 0
  const selectedPixabayId = items[selectedIndex]?.pixabayId

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
          onTouchEnd={handleTouchEnd}
        >
          <Layer listening={false}>
            <Rect x={0} y={0} width={CANVAS_SIZE} height={CANVAS_SIZE} fill={FRAME_FILL} />
          </Layer>
          <Layer>
            {items.map((item) => (
              <DraggableImage
                key={item.id}
                item={item}
                isSelected={item.id === selectedId}
                isGestureOwner={isGestureOwner}
                onChange={updateItem}
              />
            ))}
          </Layer>
          {/* above the images: dims whatever hangs outside the frame, so it
              reads as "not in the picture"; never takes a tap */}
          <Layer listening={false} ref={frameDecorRef}>
            <Rect x={-OUTSIDE} y={-OUTSIDE} width={2 * OUTSIDE + CANVAS_SIZE} height={OUTSIDE} fill="rgba(10, 10, 10, 0.62)" />
            <Rect x={-OUTSIDE} y={CANVAS_SIZE} width={2 * OUTSIDE + CANVAS_SIZE} height={OUTSIDE} fill="rgba(10, 10, 10, 0.62)" />
            <Rect x={-OUTSIDE} y={0} width={OUTSIDE} height={CANVAS_SIZE} fill="rgba(10, 10, 10, 0.62)" />
            <Rect x={CANVAS_SIZE} y={0} width={OUTSIDE} height={CANVAS_SIZE} fill="rgba(10, 10, 10, 0.62)" />
            <Rect
              x={0}
              y={0}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              stroke="rgba(255, 255, 255, 0.35)"
              strokeWidth={1.5}
              strokeScaleEnabled={false}
            />
          </Layer>
        </Stage>
      </div>

      <LayerStrip items={items} selectedId={selectedId} onSelect={selectItem} onReorder={reorderLayers} />

      <Toolbar
        addButtonRef={addButtonRef}
        onAdd={openSheet}
        onDone={exportImage}
        doneLabel={doneLabel}
        isSelected={isSelected}
        canMoveFront={canMoveFront}
        canMoveBack={canMoveBack}
        onFront={moveSelectedForward}
        onBack={moveSelectedBackward}
        onDelete={deleteSelected}
        onReport={selectedPixabayId !== undefined ? () => setReportTarget(selectedPixabayId) : undefined}
      />

      <Suspense fallback={null}>
        <AssetSheet
          key={promptText}
          open={sheetOpen}
          promptText={promptText}
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
