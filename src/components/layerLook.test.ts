import { describe, it, expect, vi } from 'vitest'
import { liveShadow, stickerOptions, type LayerShape } from './layerLook'
import { stickerSprite, type buildStickerSprite, type StickerSprite } from './stickerEdge'
import { EXPORT_LOOK, pictureLook } from '../themes/exportLook'
import { day } from '../themes/day'

const cutout: LayerShape = { unitsPerSourcePx: 0.5, scale: 1, cropLongSide: 600, opaque: false }

describe('a cut-out’s sticker on a Day phone', () => {
  it('is cream on screen', () => {
    expect(stickerOptions(pictureLook(day, false), cutout)?.color).toBe('#FBF7EE')
  })

  it('is white, with Night’s shadow, in the picture that’s sent', () => {
    const sent = stickerOptions(pictureLook(day, true), cutout)
    expect(sent?.color).toBe('#FFFFFF')
    expect(sent?.shadow).toEqual({ color: EXPORT_LOOK.layerShadowColor, blur: EXPORT_LOOK.layerShadowBlur * 2.5 })
    // the same rim width: only the colour differs
    expect(sent?.radius).toBe(stickerOptions(day, cutout)?.radius)
  })

  it('is built as its own white sprite for the export, and the screen’s stays cream', () => {
    const build = vi.fn<typeof buildStickerSprite>((): StickerSprite => ({ canvas: {} as HTMLCanvasElement, pad: 4, shadow: null, reach: 4, ms: 0 }))
    const source = { width: 600, height: 400 } as unknown as HTMLCanvasElement
    const crop = { x: 0, y: 0, width: 600, height: 400 }
    const screen = stickerSprite(source, crop, stickerOptions(day, cutout)!, build)
    const sent = stickerSprite(source, crop, stickerOptions(EXPORT_LOOK, cutout)!, build)
    expect(sent).not.toBe(screen)
    expect(build.mock.calls.map(([, , options]) => options.color)).toEqual(['#FBF7EE', '#FFFFFF'])
    // and the screen's is still there, not rebuilt
    expect(stickerSprite(source, crop, stickerOptions(day, cutout)!, build)).toBe(screen)
  })

  it('is none on a whole photo', () => {
    expect(stickerOptions(EXPORT_LOOK, { ...cutout, opaque: true })).toBeNull()
  })
})

describe('Konva’s own shadow', () => {
  it('falls on a whole photo, sized for the layer’s scale and mirror', () => {
    expect(liveShadow(EXPORT_LOOK, { opaque: true, scale: 2, mirrored: true, stickerShadow: false })).toEqual({
      shadowEnabled: true,
      shadowColor: EXPORT_LOOK.layerShadowColor,
      shadowBlur: (EXPORT_LOOK.layerShadowBlur * 2.5) / 2,
      shadowOffsetX: -0,
      shadowOffsetY: (EXPORT_LOOK.layerShadowOffset.y * 2.5) / 2,
    })
  })

  it('stays off where the sticker baked one in', () => {
    expect(liveShadow(EXPORT_LOOK, { opaque: false, scale: 1, mirrored: false, stickerShadow: true }).shadowEnabled).toBe(false)
  })
})
