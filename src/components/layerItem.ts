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
