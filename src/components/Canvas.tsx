import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Stage, Layer } from 'react-konva'
import Konva from 'konva'
import type { Asset } from '../assets'
import { generateId } from '../id'
import { randomPrompt } from '../prompts'
import type { LayerItem } from './layerItem'
import PromptBar from './PromptBar'
import Toolbar from './Toolbar'
import LayerStrip from './LayerStrip'
import AssetSheet from './AssetSheet'
import DraggableImage from './DraggableImage'

Konva.hitOnDragEnabled = true

export default function Canvas() {
  const [promptText] = useState(randomPrompt)
  const [items, setItems] = useState<LayerItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })

  const stageRef = useRef<Konva.Stage>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)

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

  const addItem = useCallback((asset: Asset) => {
    const id = generateId()
    const jitter = () => (Math.random() - 0.5) * 80 // ±40px so stacked copies are distinguishable
    setItems((prev) => [
      ...prev,
      {
        id,
        src: asset.full,
        thumb: asset.thumb,
        label: asset.label,
        x: stageSize.w / 2 + jitter(),
        y: stageSize.h / 2 + jitter(),
        scale: 1,
        rotation: 0,
      },
    ])
    setSelectedId(id)
  }, [stageSize])

  // stable identities: DraggableImage is memoized, so these must not be
  // recreated every render or every layer re-renders on any single commit
  const updateItem = useCallback((id: string, patch: Partial<Omit<LayerItem, 'id' | 'src'>>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }, [])

  const selectItem = useCallback((id: string) => setSelectedId(id), [])

  const deleteSelected = useCallback(() => {
    setItems((prev) => prev.filter((i) => i.id !== selectedId))
    setSelectedId(null)
  }, [selectedId])

  // z-order lives only in the items array's index (0 = back). These are the
  // only two ways it ever changes, besides drag-to-reorder in LayerStrip.
  const moveSelectedToFront = useCallback(() => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === selectedId)
      if (idx === -1 || idx === prev.length - 1) return prev
      const next = prev.slice()
      const [item] = next.splice(idx, 1)
      if (item) next.push(item)
      return next
    })
  }, [selectedId])

  const moveSelectedToBack = useCallback(() => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === selectedId)
      if (idx <= 0) return prev
      const next = prev.slice()
      const [item] = next.splice(idx, 1)
      if (item) next.unshift(item)
      return next
    })
  }, [selectedId])

  const reorderLayers = useCallback((next: LayerItem[]) => setItems(next), [])

  const openSheet = useCallback(() => setSheetOpen(true), [])
  const closeSheet = useCallback(() => {
    setSheetOpen(false)
    addButtonRef.current?.focus()
  }, [])
  const handleAssetSelect = useCallback((asset: Asset) => addItem(asset), [addItem])

  const exportImage = async () => {
    const stage = stageRef.current
    if (!stage) return

    const selectedNode = selectedId ? stage.findOne<Konva.Image>(`#${selectedId}`) : null

    try {
      // hide the selection outline for the capture without touching React
      // state — avoids the setState+sleep race that could bake the stroke in
      selectedNode?.strokeWidth(0)
      stage.batchDraw()

      const canvas = stage.toCanvas({ pixelRatio: 2 })
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/webp', 0.8)
      })
      if (!blob) throw new Error('failed to encode export')

      console.log('exported size:', Math.round(blob.size / 1024), 'KB')

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = 'creation.webp'
      link.href = url
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('export failed', err)
    } finally {
      if (selectedNode) {
        selectedNode.strokeWidth(3)
        stage.batchDraw()
      }
    }
  }

  const selectedIndex = items.findIndex((i) => i.id === selectedId)
  const isSelected = selectedIndex !== -1
  const canMoveFront = isSelected && selectedIndex !== items.length - 1
  const canMoveBack = isSelected && selectedIndex !== 0

  return (
    <div className="app">
      <PromptBar text={promptText} />

      <div className="canvas-container" ref={containerRef}>
        <Stage
          ref={stageRef}
          width={stageSize.w}
          height={stageSize.h}
          onMouseDown={(e) => {
            if (e.target === e.target.getStage()) setSelectedId(null)
          }}
          onTouchStart={(e) => {
            if (e.target === e.target.getStage()) setSelectedId(null)
          }}
        >
          <Layer>
            {items.map((item) => (
              <DraggableImage
                key={item.id}
                item={item}
                isSelected={item.id === selectedId}
                onSelect={selectItem}
                onChange={updateItem}
              />
            ))}
          </Layer>
        </Stage>
      </div>

      <LayerStrip items={items} selectedId={selectedId} onSelect={selectItem} onReorder={reorderLayers} />

      <Toolbar
        addButtonRef={addButtonRef}
        onAdd={openSheet}
        onDone={exportImage}
        isSelected={isSelected}
        canMoveFront={canMoveFront}
        canMoveBack={canMoveBack}
        onFront={moveSelectedToFront}
        onBack={moveSelectedToBack}
        onDelete={deleteSelected}
      />

      <AssetSheet open={sheetOpen} onClose={closeSheet} onSelect={handleAssetSelect} />
    </div>
  )
}
