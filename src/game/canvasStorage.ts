import type { CropRect, LayerItem } from '../components/layerItem'

// session: a BUILD round's canvas, which only needs to survive a reload.
// local: the sandbox, which should survive closing the tab.
export type CanvasStorageArea = 'session' | 'local'

function area(which: CanvasStorageArea): Storage {
  return which === 'local' ? localStorage : sessionStorage
}

// scoped per round so a stale canvas from a previous round never resurrects
// into a new one
export function canvasStorageKey(roomCode: string, round: number, playerId: string): string {
  return `smoosh_canvas_${roomCode}_${round}_${playerId}`
}

function isCropRect(value: unknown): value is CropRect {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const { x, y, width, height } = v
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') {
    return false
  }
  const eps = 1e-6
  return x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 + eps && y + height <= 1 + eps
}

// flips and crop are newer than the rest — a canvas saved before they
// existed still restores, as unflipped and uncropped
type StoredLayerItem = Omit<LayerItem, 'flipX' | 'flipY'> & { flipX?: boolean; flipY?: boolean }

function isLayerItem(value: unknown): value is StoredLayerItem {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.src === 'string' &&
    typeof v.thumb === 'string' &&
    typeof v.label === 'string' &&
    typeof v.x === 'number' &&
    typeof v.y === 'number' &&
    typeof v.scale === 'number' &&
    typeof v.rotation === 'number' &&
    (v.flipX === undefined || typeof v.flipX === 'boolean') &&
    (v.flipY === undefined || typeof v.flipY === 'boolean') &&
    (v.crop === undefined || isCropRect(v.crop)) &&
    (v.pixabayId === undefined || typeof v.pixabayId === 'number')
  )
}

// Anything stored may be from an older build or hand-edited, so it's
// validated item by item. blob: URLs (an on-device cut whose upload never
// landed) die with the page that made them — dropped rather than restored
// as layers that can never load.
export function loadCanvasItems(key: string, which: CanvasStorageArea = 'session'): LayerItem[] | undefined {
  try {
    const raw = area(which).getItem(key)
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return undefined
    return parsed
      .filter(isLayerItem)
      .filter((i) => !i.src.startsWith('blob:'))
      .map((i) => ({ ...i, scale: Math.abs(i.scale), flipX: i.flipX ?? false, flipY: i.flipY ?? false }))
  } catch {
    return undefined
  }
}

export function saveCanvasItems(key: string, items: LayerItem[], which: CanvasStorageArea = 'session'): void {
  try {
    area(which).setItem(key, JSON.stringify(items))
  } catch {
    // ignore — persistence is a convenience, not a requirement
  }
}

export function clearCanvasItems(key: string, which: CanvasStorageArea = 'session'): void {
  try {
    area(which).removeItem(key)
  } catch {
    // best effort
  }
}
