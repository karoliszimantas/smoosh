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
}
