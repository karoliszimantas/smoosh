import { describe, it, expect } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { applyExportLook, EXPORT_ATTRS, hideForExport, isExporting, NOT_IN_EXPORT } from './canvasExport'
import FrameDecor from './FrameDecor'
import SelectionOverlay from './SelectionOverlay'
import { parseHardShadow } from './hardShadow'
import { CANVAS_SIZE } from './layerItem'

// a stand-in for a Konva node: just what the export touches
function node(name: string, visible = true) {
  let shown = visible
  function shownOrSet(): boolean
  function shownOrSet(v: boolean): void
  function shownOrSet(v?: boolean): boolean | void {
    if (v === undefined) return shown
    shown = v
  }
  return { name, visible: shownOrSet }
}

// Konva's find('.name') matches any one of a node's space-separated names
function stageOf(nodes: ReturnType<typeof node>[]) {
  return { find: (selector: string) => nodes.filter((n) => n.name.split(' ').includes(selector.slice(1))) }
}

type Props = { name?: string; listening?: boolean; children?: ReactNode; x?: number; y?: number; width?: number; height?: number }

describe('the export leaves the chrome out', () => {
  it('hides everything named not-in-export, then puts back only what it hid', () => {
    const decor = node(NOT_IN_EXPORT)
    const handles = node(`selection-overlay ${NOT_IN_EXPORT}`)
    const alreadyHidden = node(NOT_IN_EXPORT, false)
    const picture = node('layer')
    const restore = hideForExport(stageOf([decor, handles, alreadyHidden, picture]))
    expect([decor, handles, alreadyHidden, picture].map((n) => n.visible())).toEqual([false, false, false, true])
    restore()
    expect([decor, handles, alreadyHidden, picture].map((n) => n.visible())).toEqual([true, true, false, true])
  })

  it('draws the frame’s shadow strips and dimming in a layer the export hides', () => {
    const layer = FrameDecor({ scale: 0.5, pageBg: '#1A1714', shadow: '3px 4px 0 rgba(0,0,0,.55)' }) as ReactElement<Props>
    expect(layer.props.name?.split(' ')).toContain(NOT_IN_EXPORT)
    expect(layer.props.listening).toBe(false)
    const strips = (layer.props.children as ReactNode[])
      .filter((c): c is ReactElement<Props> => isValidElement(c))
      .filter((c) => c.props.name === 'frame-shadow')
      .map(({ props: { x, y, width, height } }) => ({ x, y, width, height }))
    // 3 and 4 screen px at half scale are 6 and 8 canvas units
    expect(strips).toEqual([
      { x: CANVAS_SIZE, y: 8, width: 6, height: CANVAS_SIZE },
      { x: 6, y: CANVAS_SIZE, width: CANVAS_SIZE - 6, height: 8 },
    ])
  })
})

describe('the selection’s outline and handles', () => {
  it('take no taps and are hidden from the export', () => {
    const overlay = SelectionOverlay({ targetId: 'a', stageScale: 0.4, color: '#B8320A', handles: true }) as ReactElement<Props>
    expect(overlay.props.name?.split(' ')).toContain(NOT_IN_EXPORT)
    expect(overlay.props.listening).toBe(false)
  })
})

describe('reading the card shadow', () => {
  it('takes the offset and colour of a hard shadow', () => {
    expect(parseHardShadow('3px 4px 0 rgba(0,0,0,.55)')).toEqual({ x: 3, y: 4, color: 'rgba(0,0,0,.55)' })
    expect(parseHardShadow('2px 3px 0 #000')).toEqual({ x: 2, y: 3, color: '#000' })
  })

  it('falls back to the approved shadow for anything else', () => {
    expect(parseHardShadow('0 6px 10px rgba(0,0,0,.3)')).toEqual({ x: 3, y: 4, color: 'rgba(0,0,0,.55)' })
    expect(parseHardShadow('3px 4px 0 red, 1px 1px 0 blue')).toEqual({ x: 3, y: 4, color: 'rgba(0,0,0,.55)' })
  })
})

describe('the export’s look', () => {
  // a stand-in for a Konva node or stage: just its attrs
  function attributed(attrs: Record<string, unknown>) {
    const a = { ...attrs }
    return {
      attrs: a,
      getAttr: (name: string) => a[name],
      setAttr: (name: string, value: unknown) => void (a[name] = value),
      setAttrs: (next: Record<string, unknown>) => void Object.assign(a, next),
    }
  }

  it('is drawn for the capture alone, then the theme’s look is back', () => {
    const paper = attributed({ fill: '#E6DCC9', [EXPORT_ATTRS]: { fill: '#FBF7EE' } })
    const photo = attributed({ shadowColor: 'rgba(1,2,3,.4)', shadowEnabled: true, [EXPORT_ATTRS]: { shadowColor: 'rgba(0,0,0,.3)' } })
    const plain = attributed({ fill: 'red' })
    const nodes = [paper, photo, plain]
    const stage = { ...attributed({}), find: (match: (n: (typeof nodes)[number]) => boolean) => nodes.filter(match) }
    const shape = { getStage: () => stage }

    expect(isExporting(shape)).toBe(false)
    const restore = applyExportLook(stage)
    expect(isExporting(shape)).toBe(true)
    expect(paper.attrs.fill).toBe('#FBF7EE')
    expect(photo.attrs).toMatchObject({ shadowColor: 'rgba(0,0,0,.3)', shadowEnabled: true })
    expect(plain.attrs.fill).toBe('red')

    restore()
    expect(isExporting(shape)).toBe(false)
    expect(paper.attrs.fill).toBe('#E6DCC9')
    expect(photo.attrs.shadowColor).toBe('rgba(1,2,3,.4)')
  })

  it('isn’t on for a shape not on a stage', () => {
    expect(isExporting({ getStage: () => null })).toBe(false)
  })
})
