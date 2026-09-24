import type { LayerItem } from '../components/layerItem'

// scoped per round so a stale canvas from a previous round never resurrects
// into a new one
export function canvasStorageKey(roomCode: string, round: number, playerId: string): string {
  return `smoosh_canvas_${roomCode}_${round}_${playerId}`
}

export function loadCanvasItems(key: string): LayerItem[] | undefined {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as LayerItem[]) : undefined
  } catch {
    return undefined
  }
}

export function clearCanvasItems(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // best effort
  }
}
