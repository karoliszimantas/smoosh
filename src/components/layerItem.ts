// The picture is a square frame of CANVAS_SIZE x CANVAS_SIZE canvas units.
// Item positions are stored in these units, not screen pixels — the stage is
// scaled to fit the frame on whatever screen it's on, so a composition stays
// put across rotation, window resizes, and restoring on another device.
export const CANVAS_SIZE = 1000

// array index is the sole source of z-order — index 0 renders at the back.
// Konva must never reorder its own children; reordering means reordering
// this array in React state.
export type LayerItem = {
  id: string
  src: string
  thumb: string
  label: string
  x: number
  y: number
  scale: number
  rotation: number
  // set for anything that came from Pixabay, so the layer can be reported
  pixabayId?: number
}

// what the asset sheet hands the canvas to place — a curated asset, a shared
// cut, a fresh on-device cut (blob: URL), or a full Pixabay rectangle
export type Placement = {
  full: string
  thumb: string
  label: string
  pixabayId: number | null
}
