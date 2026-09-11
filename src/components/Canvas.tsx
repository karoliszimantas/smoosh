import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Image as KonvaImage } from 'react-konva'
import Konva from 'konva'
import { ASSETS } from '../assets'
import { warmup, cutout } from '../cutout'

Konva.hitOnDragEnabled = true

const MAX_SOURCE_PX = 1024

type LayerItem = {
  id: string
  src: string
  x: number
  y: number
}

export default function Canvas() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [items, setItems] = useState<LayerItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [modelReady, setModelReady] = useState(false)
  const [progress, setProgress] = useState(0)
  const [cutting, setCutting] = useState(false)
  const stageRef = useRef<Konva.Stage>(null)

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    warmup(setProgress)
      .then(() => setModelReady(true))
      .catch(() => setModelReady(false))
  }, [])

  const drawerHeight = 110

  const addItem = (src: string) => {
    const id = Math.random().toString(36).slice(2)
    setItems((prev) => [...prev, { id, src, x: size.w / 2, y: (size.h - drawerHeight) / 3 }])
    setSelectedId(id)
  }

  const deleteSelected = () => {
    if (!selectedId) return
    setItems((prev) => prev.filter((i) => i.id !== selectedId))
    setSelectedId(null)
  }

  const cutoutSelected = async () => {
    if (!selectedId) return
    const item = items.find((i) => i.id === selectedId)
    if (!item) return

    setCutting(true)
    try {
      const newSrc = await cutout(item.src)
      setItems((prev) => prev.map((i) => (i.id === selectedId ? { ...i, src: newSrc } : i)))
    } catch (e) {
      console.error('cutout failed', e)
    } finally {
      setCutting(false)
    }
  }

  const exportImage = async () => {
    const stage = stageRef.current
    if (!stage) return

    setSelectedId(null)
    await new Promise((r) => setTimeout(r, 50))

    const dataUrl = stage.toDataURL({
      pixelRatio: 2,
      mimeType: 'image/webp',
      quality: 0.8,
    })

    const res = await fetch(dataUrl)
    const blob = await res.blob()
    console.log('exported size:', Math.round(blob.size / 1024), 'KB')

    const link = document.createElement('a')
    link.download = 'creation.webp'
    link.href = dataUrl
    link.click()
  }

  return (
    <div className="app">
      <div className="canvas-container">
        <Stage
          ref={stageRef}
          width={size.w}
          height={size.h - drawerHeight}
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
                onSelect={() => setSelectedId(item.id)}
              />
            ))}
          </Layer>
        </Stage>
      </div>

      <button className="export-btn" onClick={exportImage}>
        Done
      </button>

      {!modelReady && <div className="loading-badge">Loading AI… {progress}%</div>}

      {selectedId && (
        <button className="delete-btn" onClick={deleteSelected}>
          Delete
        </button>
      )}

      {selectedId && modelReady && (
        <button className="cut-btn" onClick={cutoutSelected} disabled={cutting}>
          {cutting ? 'Cutting…' : 'Cut out'}
        </button>
      )}

      <div className="drawer">
        {ASSETS.map((asset) => (
          <button key={asset.id} className="asset-btn" onClick={() => addItem(asset.src)}>
            <img src={asset.src} alt={asset.label} />
          </button>
        ))}
      </div>
    </div>
  )
}

function downscale(image: HTMLImageElement): Promise<HTMLImageElement> {
  const scale = Math.min(1, MAX_SOURCE_PX / Math.max(image.width, image.height))
  if (scale >= 1) return Promise.resolve(image)

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.width * scale)
  canvas.height = Math.round(image.height * scale)
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)

  return new Promise((resolve) => {
    const small = new window.Image()
    small.onload = () => resolve(small)
    small.src = canvas.toDataURL('image/png')
  })
}

function DraggableImage({
  item,
  isSelected,
  onSelect,
}: {
  item: LayerItem
  isSelected: boolean
  onSelect: () => void
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [dims, setDims] = useState({ w: 120, h: 120 })
  const ref = useRef<Konva.Image>(null)
  const lastDist = useRef(0)
  const lastAngle = useRef(0)

  useEffect(() => {
    let cancelled = false

    const image = new window.Image()
    image.crossOrigin = 'anonymous'
    image.src = item.src

    image.onload = async () => {
      const small = await downscale(image)
      if (cancelled) return

      const maxSide = Math.min(window.innerWidth, window.innerHeight) * 0.3
      const ratio = small.width / small.height
      setDims({
        w: ratio > 1 ? maxSide : maxSide * ratio,
        h: ratio > 1 ? maxSide / ratio : maxSide,
      })
      setImg(small)
    }

    image.onerror = () => console.error('failed to load', item.src)

    return () => {
      cancelled = true
    }
  }, [item.src])

  const getDistance = (p1: Touch, p2: Touch) =>
    Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY)

  const getAngle = (p1: Touch, p2: Touch) =>
    (Math.atan2(p2.clientY - p1.clientY, p2.clientX - p1.clientX) * 180) / Math.PI

  const handleTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches
    if (touches.length !== 2) return

    e.evt.preventDefault()
    const node = ref.current
    if (!node) return

    node.stopDrag()

    const dist = getDistance(touches[0], touches[1])
    const angle = getAngle(touches[0], touches[1])

    if (!lastDist.current) lastDist.current = dist
    if (!lastAngle.current) lastAngle.current = angle

    const scale = node.scaleX() * (dist / lastDist.current)
    node.scaleX(scale)
    node.scaleY(scale)
    node.rotation(node.rotation() + (angle - lastAngle.current))

    lastDist.current = dist
    lastAngle.current = angle
  }

  const handleTouchEnd = () => {
    lastDist.current = 0
    lastAngle.current = 0
  }

  const handleSelect = () => {
    ref.current?.moveToTop()
    onSelect()
  }

  if (!img) return null

  return (
    <KonvaImage
      ref={ref}
      image={img}
      x={item.x}
      y={item.y}
      width={dims.w}
      height={dims.h}
      offsetX={dims.w / 2}
      offsetY={dims.h / 2}
      draggable
      stroke={isSelected ? '#4ade80' : undefined}
      strokeWidth={isSelected ? 3 : 0}
      onTouchStart={handleSelect}
      onMouseDown={handleSelect}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    />
  )
}