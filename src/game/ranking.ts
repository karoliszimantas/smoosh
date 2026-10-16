// Standings with ties, ranked the way sport does it ("competition"
// ranking): equal scores share a place, and the places they take up are
// skipped — 1, =2, =2, 4.

export type Ranked<T> = {
  item: T
  rank: number // 1-based
  tied: boolean // shares its rank with someone else
}

// highest score first; equal scores keep the order they came in
export function rankWithTies<T>(items: readonly T[], score: (item: T) => number): Ranked<T>[] {
  const sorted = [...items].sort((a, b) => score(b) - score(a))
  const count = new Map<number, number>()
  for (const item of sorted) count.set(score(item), (count.get(score(item)) ?? 0) + 1)
  let rank = 0
  return sorted.map((item, i) => {
    const prev = sorted[i - 1]
    if (prev === undefined || score(prev) !== score(item)) rank = i + 1
    return { item, rank, tied: (count.get(score(item)) ?? 0) > 1 }
  })
}

// the rank as printed: "1", "=2"
export function rankLabel({ rank, tied }: { rank: number; tied: boolean }): string {
  return tied ? `=${rank}` : String(rank)
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']

function ordinal(n: number): string {
  const word = ORDINALS[n - 1]
  if (word) return word
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix}`
}

// the rank as said: "First", "Joint second" — what "=2" means read aloud
export function rankName({ rank, tied }: { rank: number; tied: boolean }): string {
  const word = ordinal(rank)
  return tied ? `Joint ${word}` : `${word.charAt(0).toUpperCase()}${word.slice(1)}`
}
