// Prompt words the library had nothing for — counted on this device, so
// after a party there's a list of what to add. Deliberately tiny: a count
// per word in localStorage, readable in the dev panel and the console.

const KEY = 'smoosh_missing_words'

export function missingWords(): [string, number][] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (typeof parsed !== 'object' || parsed === null) return []
    return Object.entries(parsed as Record<string, unknown>)
      .filter((e): e is [string, number] => typeof e[1] === 'number')
      .sort((a, b) => b[1] - a[1])
  } catch {
    return []
  }
}

export function recordMissingWord(word: string): void {
  try {
    const counts = Object.fromEntries(missingWords())
    counts[word] = (counts[word] ?? 0) + 1
    localStorage.setItem(KEY, JSON.stringify(counts))
    console.info(`[library] nothing for "${word}" (${counts[word]}× on this device)`)
  } catch {
    // storage unavailable — nothing to keep
  }
}

export function clearMissingWords(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing to clear
  }
}
