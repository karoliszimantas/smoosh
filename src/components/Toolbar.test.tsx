import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Toolbar, { MoreMenu, type ToolbarMode } from './Toolbar'
import { layerMoreTools } from './moreTools'

const noop = () => {}

function toolbar(mode: ToolbarMode, used = 2, onReport?: () => void) {
  return renderToStaticMarkup(
    <Toolbar
      mode={mode}
      selectedId="a"
      addButtonRef={null}
      onAdd={noop}
      addLimit={{ used, max: 8, perPass: false }}
      mirrored={false}
      opacity={1}
      onMirror={noop}
      edged
      onCrop={noop}
      onErase={noop}
      onDelete={noop}
      onDuplicate={noop}
      onToggleLock={noop}
      onReport={onReport}
      onOpacityPreview={noop}
      onOpacityCommit={noop}
      onCropReset={noop}
      onCropCancel={noop}
      onCropApply={noop}
      brush="M"
      onBrush={noop}
      canUndo={false}
      onUndo={noop}
      hasStrokes={false}
      onEraseReset={noop}
      onEraseDone={noop}
    />,
  )
}

const labels = (html: string) => [...html.matchAll(/<span class="toolbar-label">([^<]*)<\/span>/g)].map((m) => m[1])

describe('the layer toolbar', () => {
  it('keeps Add, Delete and Lock on the strip and the rest behind More, closed', () => {
    const html = toolbar('layer')
    expect(labels(html)).toEqual(['Add', 'Delete', 'Lock', 'More'])
    expect(html).toMatch(/aria-label="More tools" aria-expanded="false" aria-haspopup="menu"/)
    expect(html).not.toContain('role="menu"')
  })

  it('puts Report on the strip, before More, for a Pixabay layer', () => {
    expect(labels(toolbar('layer', 2, noop))).toEqual(['Add', 'Delete', 'Lock', 'Report', 'More'])
  })

  it('leaves the other modes as they were', () => {
    expect(labels(toolbar('locked'))).toEqual(['Add', 'Unlock'])
    expect(labels(toolbar('idle'))).toEqual(['Add'])
    expect(labels(toolbar('crop'))).toEqual(['Reset', 'Cancel', 'Apply'])
    expect(labels(toolbar('erase'))).toEqual(['S', 'M', 'L', 'Undo', 'Reset', 'Done'])
  })
})

describe('the More card', () => {
  const tools = (full: boolean, mirrored: boolean) => [
    { icon: 'duplicate' as const, label: 'Copy', onPick: noop, disabled: full, ariaLabel: full ? 'Layer limit reached: 8' : 'Duplicate this layer' },
    { icon: 'mirror' as const, label: 'Mirror', onPick: noop, checked: mirrored },
    { icon: 'crop' as const, label: 'Crop', onPick: noop },
    { icon: 'erase' as const, label: 'Erase', onPick: noop },
    { icon: 'opacity' as const, label: 'Fade', onPick: noop },
  ]

  it('is a menu of the five rarer tools, Mirror a checkbox', () => {
    const html = renderToStaticMarkup(<MoreMenu tools={tools(false, true)} onClose={noop} />)
    expect(html).toMatch(/^<div class="paper-card toolbar-more-menu" role="menu"/)
    expect(labels(html)).toEqual(['Copy', 'Mirror', 'Crop', 'Erase', 'Fade'])
    expect(html.match(/role="menuitem"/g)).toHaveLength(4)
    expect(html).toContain('class="toolbar-more-item toolbar-btn-on" role="menuitemcheckbox" aria-checked="true"')
    expect(html).not.toContain('disabled')
  })

  it('greys Copy at the layer limit, saying why', () => {
    const html = renderToStaticMarkup(<MoreMenu tools={tools(true, false)} onClose={noop} />)
    expect(html).toContain('aria-label="Layer limit reached: 8" disabled=""')
    expect(html).toContain('role="menuitemcheckbox" aria-checked="false"')
  })
})

describe('a layer’s More tools', () => {
  const layerTools = (onEdge: (() => void) | undefined, edged: boolean) =>
    layerMoreTools({
      full: false,
      limitLabel: 'Layer limit reached: 8',
      mirrored: false,
      edged,
      onDuplicate: noop,
      onMirror: noop,
      onEdge,
      onCrop: noop,
      onErase: noop,
      onFade: noop,
    })

  it('offer a cut-out its sticker edge as a switch, after Mirror', () => {
    const tools = layerTools(noop, true)
    expect(tools.map((t) => t.label)).toEqual(['Copy', 'Mirror', 'Edge', 'Crop', 'Erase', 'Fade'])
    expect(tools[2]).toMatchObject({ checked: true, ariaLabel: 'Sticker edge' })
    expect(layerTools(noop, false)[2]?.checked).toBe(false)
  })

  it('leave Edge out for a whole photo, which has none', () => {
    expect(layerTools(undefined, true).map((t) => t.label)).toEqual(['Copy', 'Mirror', 'Crop', 'Erase', 'Fade'])
  })
})
