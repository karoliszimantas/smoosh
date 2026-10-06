// what Gallery's labels say — formal, and never a joke of their own

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with'])

// A title, as a museum would set it. Freestyle has no prompt, so its
// pictures hang as "Untitled". A prompt written all in lower case is set in
// title case; anything with capitals of its own is left as its author wrote it.
export function titleFor(prompt: string): string {
  const text = prompt.trim()
  if (!text) return 'Untitled'
  if (text !== text.toLowerCase()) return text
  return text
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

// vote counts for a label — never who. No votes: nothing at all, not a zero
export function countLine(favourites: number, runnerUps: number): string | null {
  const parts = [
    favourites > 0 && `${favourites} favourite${favourites === 1 ? '' : 's'}`,
    runnerUps > 0 && `${runnerUps} runner-up${runnerUps === 1 ? '' : 's'}`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}
