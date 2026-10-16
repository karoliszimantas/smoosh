import type { Theme } from './types'
import { night } from './night'

// What a theme decides about the picture itself, as opposed to the desk
// round it: its paper, the cut-outs' sticker edge and the layers' shadows.
export type PictureLook = Pick<
  Theme,
  'canvasBg' | 'stickerEdge' | 'cutoutShadow' | 'layerShadowColor' | 'layerShadowBlur' | 'layerShadowOffset'
>

function lookOf(theme: PictureLook): PictureLook {
  const { canvasBg, stickerEdge, cutoutShadow, layerShadowColor, layerShadowBlur, layerShadowOffset } = theme
  return { canvasBg, stickerEdge, cutoutShadow, layerShadowColor, layerShadowBlur, layerShadowOffset }
}

// The submitted picture looks the same whoever built it and on whichever
// desk: it's always exported in Night's look — white sticker edges on the
// picture's own paper — while the builder still sees their theme's on
// screen. Fixed here, so a theme can never leak into what's sent.
export const EXPORT_LOOK: PictureLook = Object.freeze(lookOf(night))

// the look to draw the picture in: the export's while it's being captured,
// the theme's on screen
export function pictureLook(theme: PictureLook, exporting: boolean): PictureLook {
  return exporting ? EXPORT_LOOK : theme
}
