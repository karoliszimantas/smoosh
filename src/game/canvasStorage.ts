import type { LayerItem } from '../components/layerItem'

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

function isLayerItem(value: unknown): value is LayerItem {
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
    return parsed.filter(isLayerItem).filter((i) => !i.src.startsWith('blob:'))
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
