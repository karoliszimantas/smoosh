import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadCanvasItems, saveCanvasItems } from './canvasStorage'
import type { LayerItem } from '../components/layerItem'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
  }
}

const layer: LayerItem = {
  id: 'a',
  src: '/assets/cat.png',
  thumb: '/assets/cat.thumb.png',
  label: 'cat',
  x: 500,
  y: 500,
  scale: 1,
  rotation: 0,
  mirrored: false,
  opacity: 1,
}

describe('a saved canvas', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', memoryStorage())
  })

  it('keeps a cut-out’s edge off', () => {
    saveCanvasItems('k', [{ ...layer, noEdge: true }, layer])
    expect(loadCanvasItems('k')?.map((i) => i.noEdge)).toEqual([true, undefined])
  })

  it('drops a layer whose edge flag is not a boolean', () => {
    sessionStorage.setItem('k', JSON.stringify([{ ...layer, noEdge: 'yes' }, layer]))
    expect(loadCanvasItems('k')).toEqual([layer])
  })
})
