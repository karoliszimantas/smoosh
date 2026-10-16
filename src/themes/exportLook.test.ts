import { describe, it, expect } from 'vitest'
import { EXPORT_LOOK, pictureLook } from './exportLook'
import { day } from './day'
import { night } from './night'

describe('the look a picture is sent in', () => {
  it('is white sticker edges on the picture’s own paper', () => {
    expect(EXPORT_LOOK.canvasBg).toBe('#FBF7EE')
    expect(EXPORT_LOOK.stickerEdge).toEqual({ color: '#FFFFFF', width: 3 })
    expect(EXPORT_LOOK).toEqual({
      canvasBg: night.canvasBg,
      stickerEdge: night.stickerEdge,
      cutoutShadow: night.cutoutShadow,
      layerShadowColor: night.layerShadowColor,
      layerShadowBlur: night.layerShadowBlur,
      layerShadowOffset: night.layerShadowOffset,
    })
  })

  it('is the same whichever theme the builder is on', () => {
    for (const theme of [day, night]) expect(pictureLook(theme, true)).toBe(EXPORT_LOOK)
  })

  it('leaves the builder their own theme on screen (Day’s cream rim)', () => {
    expect(pictureLook(day, false).stickerEdge).toEqual({ color: '#FBF7EE', width: 3 })
  })

  it('can’t be changed by anything else', () => {
    expect(Object.isFrozen(EXPORT_LOOK)).toBe(true)
  })
})
