// What the canvas draws for the player but never sends: the frame's shadow
// and the dimming outside it, the selection's outline and handles. Each such
// Konva node carries this name (alongside any other), and the export hides
// every one of them for the capture.
export const NOT_IN_EXPORT = 'not-in-export'

type Hideable = { visible(): boolean; visible(visible: boolean): unknown }

// Hides everything named NOT_IN_EXPORT that's showing, and returns how to
// put back exactly those — nothing that was already hidden comes back.
export function hideForExport(stage: { find(selector: string): Hideable[] }): () => void {
  const shown = stage.find(`.${NOT_IN_EXPORT}`).filter((node) => node.visible())
  for (const node of shown) node.visible(false)
  return () => {
    for (const node of shown) node.visible(true)
  }
}

// The picture is sent in the export's look (EXPORT_LOOK), not the
// builder's theme. For the length of the capture the stage carries this
// flag — a cut-out's sceneFunc reads it and draws its export sticker — and
// every node with export attrs (EXPORT_ATTRS: the paper's fill, a layer's
// live shadow) takes them on. All synchronous, inside the capture: no
// setState to wait for.
const EXPORTING = 'smooshExporting'
export const EXPORT_ATTRS = 'exportAttrs'

type Attributed = {
  getAttr(name: string): unknown
  setAttr(name: string, value: unknown): unknown
  setAttrs(attrs: Record<string, unknown>): unknown
}
type LookStage = Attributed & { find(selector: (node: Attributed) => boolean): Attributed[] }

export function isExporting(shape: { getStage(): { getAttr(name: string): unknown } | null }): boolean {
  return shape.getStage()?.getAttr(EXPORTING) === true
}

// Puts the stage in the export's look, and returns how to put it back.
export function applyExportLook(stage: LookStage): () => void {
  const restores = stage
    .find((node) => node.getAttr(EXPORT_ATTRS) !== undefined)
    .map((node) => {
      const look = node.getAttr(EXPORT_ATTRS) as Record<string, unknown>
      const before = Object.fromEntries(Object.keys(look).map((key) => [key, node.getAttr(key)]))
      node.setAttrs(look)
      return () => node.setAttrs(before)
    })
  stage.setAttr(EXPORTING, true)
  return () => {
    stage.setAttr(EXPORTING, false)
    for (const restore of restores) restore()
  }
}

export type Box = { x: number; y: number; width: number; height: number }

// Nothing on the picture: no layers at all, or every one parked wholly
// outside the frame, where the export cuts it off. A layer not drawn yet
// (null) counts as something — better to send a blank picture as a real
// one than to have a real one skipped.
export function nothingInFrame(layers: readonly (Box | null)[], frame: Box): boolean {
  return layers.every(
    (box) =>
      box !== null &&
      (box.x + box.width <= frame.x ||
        box.x >= frame.x + frame.width ||
        box.y + box.height <= frame.y ||
        box.y >= frame.y + frame.height),
  )
}
