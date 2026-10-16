import { CANVAS_SIZE } from './layerItem'
import { stickerRadius, type StickerOptions } from './stickerEdge'
import type { PictureLook } from '../themes/exportLook'

// theme sizes for canvas drawing are screen pixels on a 400px-wide frame;
// this many canvas units make one of them
export const CANVAS_UNITS_PER_THEME_PX = CANVAS_SIZE / 400

// a layer as its look needs it: canvas units per source pixel, its scale,
// its crop's long side in source pixels, and whether it's a whole photo
export type LayerShape = { unitsPerSourcePx: number; scale: number; cropLongSide: number; opaque: boolean }

// A cut-out's sticker in a look — the rim's radius and colour and the lift
// shadow baked under it — or null: a whole photo, or a look with no edge.
// The rim is the same width on screen at any scale, like the shadow.
export function stickerOptions(look: PictureLook, layer: LayerShape): StickerOptions | null {
  const edge = look.stickerEdge
  if (!edge || layer.opaque) return null
  const radius = stickerRadius(CANVAS_UNITS_PER_THEME_PX, edge.width, layer.unitsPerSourcePx, layer.scale, layer.cropLongSide)
  if (radius <= 0) return null
  return {
    radius,
    color: edge.color,
    // what the rounded radius stands for: the rim's width in units over it
    unitsPerSourcePx: (edge.width * CANVAS_UNITS_PER_THEME_PX) / radius,
    // a soft drop shadow reads as depth under a cut-out; a glow wouldn't
    shadow: look.cutoutShadow ? { color: look.layerShadowColor, blur: look.layerShadowBlur * CANVAS_UNITS_PER_THEME_PX } : null,
  }
}

// Konva's own shadow on a layer, in a look: whole photos, and cut-outs
// whose sticker didn't bake one. Konva scales shadow sizes by the node's
// absolute scale, so the layer's own scale is divided out (the shadow is
// the look's size whatever the layer's), and a mirror's sign undone so it
// still falls downward
export function liveShadow(
  look: PictureLook,
  layer: { opaque: boolean; scale: number; mirrored: boolean; stickerShadow: boolean },
): { shadowEnabled: boolean; shadowColor: string | undefined; shadowBlur: number; shadowOffsetX: number; shadowOffsetY: number } {
  const enabled = (look.cutoutShadow || layer.opaque) && !layer.stickerShadow
  const k = CANVAS_UNITS_PER_THEME_PX / layer.scale
  return {
    shadowEnabled: enabled,
    shadowColor: enabled ? look.layerShadowColor : undefined,
    shadowBlur: look.layerShadowBlur * k,
    shadowOffsetX: look.layerShadowOffset.x * k * (layer.mirrored ? -1 : 1),
    shadowOffsetY: look.layerShadowOffset.y * k,
  }
}
