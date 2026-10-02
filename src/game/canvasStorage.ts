import { MIN_OPACITY, type CropRect, type LayerItem } from '../components/layerItem'

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

function isEraseStroke(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.r === 'number' &&
    v.r > 0 &&
    Array.isArray(v.p) &&
    v.p.length >= 2 &&
    v.p.length % 2 === 0 &&
    v.p.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

// Everything past the basics is newer than some saved canvases, so it's all
// optional here. Older shapes: `flipX`/`flipY` (before `mirrored`), no
// `opacity`, no `erase`.
type StoredLayerItem = Omit<LayerItem, 'mirrored' | 'opacity'> & {
  mirrored?: boolean
  opacity?: number
  flipX?: boolean
  flipY?: boolean
}

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
    (v.mirrored === undefined || typeof v.mirrored === 'boolean') &&
    (v.opacity === undefined || typeof v.opacity === 'number') &&
    (v.flipX === undefined || typeof v.flipX === 'boolean') &&
    (v.flipY === undefined || typeof v.flipY === 'boolean') &&
    (v.crop === undefined || isCropRect(v.crop)) &&
    (v.erase === undefined || (Array.isArray(v.erase) && v.erase.every(isEraseStroke))) &&
    (v.pixabayId === undefined || typeof v.pixabayId === 'number')
  )
}

// brings any stored shape up to the current one
function migrate(stored: StoredLayerItem): LayerItem {
  const { flipX, flipY, mirrored, opacity, ...rest } = stored
  let isMirrored = mirrored ?? flipX ?? false
  let rotation = rest.rotation
  // an old vertical flip is exactly a mirror plus a half turn — same picture
  if (mirrored === undefined && flipY) {
    isMirrored = !isMirrored
    rotation += 180
  }
  return {
    ...rest,
    scale: Math.abs(rest.scale),
    rotation,
    mirrored: isMirrored,
    opacity: Math.min(1, Math.max(MIN_OPACITY, opacity ?? 1)),
  }
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
      .map(migrate)
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
