export function normalizeGuessText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

export type LieRejectionReason = 'matches_truth' | 'duplicate_lie'

// pure — no Room/Socket.io coupling. `existingLies` is the raw (un-normalized)
// text of lies already accepted for this picture; order matters (the first
// submission wins, later duplicates are rejected).
export function validateLie(
  candidate: string,
  truth: string,
  existingLies: readonly string[],
): LieRejectionReason | null {
  const normalizedCandidate = normalizeGuessText(candidate)

  if (normalizedCandidate === normalizeGuessText(truth)) return 'matches_truth'

  for (const existing of existingLies) {
    if (normalizedCandidate === normalizeGuessText(existing)) return 'duplicate_lie'
  }

  return null
}
