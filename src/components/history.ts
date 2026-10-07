// The picture's undo history: the layer list as it was before each change.
// Layers are never edited in place — a change replaces the one layer it
// touches — so a step costs a list of references and that one layer, not a
// copy of the picture. Kept in memory only: the saved canvas is always the
// current state, so undo-then-refresh can't bring an undone state back.

// Thirty steps: far more than anyone takes back under a build timer, and,
// with erased images cached only for what's on the canvas (erase.ts), well
// under a megabyte on a phone.
export const UNDO_DEPTH = 30

export type Doc<T> = { items: T; past: T[] }

// a change: one undo step, unless it changed nothing
export function commitDoc<T>(doc: Doc<T>, change: (prev: T) => T, depth = UNDO_DEPTH): Doc<T> {
  const next = change(doc.items)
  if (next === doc.items) return doc
  const past = [...doc.past, doc.items]
  return { items: next, past: past.length > depth ? past.slice(past.length - depth) : past }
}

export function undoDoc<T>(doc: Doc<T>): Doc<T> {
  const prev = doc.past[doc.past.length - 1]
  if (prev === undefined) return doc
  return { items: prev, past: doc.past.slice(0, -1) }
}

// not a change the player made (a cut's local copy swapped for its shared
// one): applied to the present and to every past state alike, with no step
export function rewriteDoc<T>(doc: Doc<T>, fix: (state: T) => T): Doc<T> {
  return { items: fix(doc.items), past: doc.past.map(fix) }
}
