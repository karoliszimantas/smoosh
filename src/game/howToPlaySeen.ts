// The three how-to-play cards open by themselves the first time a player
// is in a Lobby — remembered on this device, so they open once. Storage can
// be missing or refuse (some private modes): then they're remembered for
// this visit only, and the next visit shows them again. Nothing worse.

const SEEN_KEY = 'smoosh_how_to_play_seen'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function local(): Store | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

let seenThisVisit = false

export function howToPlaySeen(store: Store | null = local()): boolean {
  if (seenThisVisit) return true
  try {
    return store?.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function markHowToPlaySeen(store: Store | null = local()): void {
  seenThisVisit = true
  try {
    store?.setItem(SEEN_KEY, '1')
  } catch {
    // remembered for this visit only
  }
}

// for tests: a fresh visit
export function resetHowToPlayVisit(): void {
  seenThisVisit = false
}
