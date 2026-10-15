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
