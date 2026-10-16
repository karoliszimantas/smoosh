// A lie being written is the player's own words: kept on this phone as it's
// typed, per room, round and picture, so a reload (or the browser killing a
// backgrounded tab) brings it back. Only the picture on screen keeps one —
// opening the next picture, or going home, clears the rest, so storage
// never grows. Storage can be missing or refuse (some private modes): then
// the draft simply lives as long as the screen does.

const PREFIX = 'smoosh_lie_'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

function local(): Store | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

export function lieDraftKey(roomCode: string, round: number, pictureIndex: number): string {
  return `${PREFIX}${roomCode}_${round}_${pictureIndex}`
}

export function loadLieDraft(key: string, store: Store | null = local()): string {
  try {
    return store?.getItem(key) ?? ''
  } catch {
    return ''
  }
}

// an empty draft is no draft: its key goes
export function saveLieDraft(key: string, text: string, store: Store | null = local()): void {
  try {
    if (text.trim() === '') store?.removeItem(key)
    else store?.setItem(key, text)
  } catch {
    // kept on screen only
  }
}

// every lie draft but `keep` (none, on the way home)
export function pruneLieDrafts(keep: string | null, store: Store | null = local()): void {
  try {
    if (!store) return
    const stale: string[] = []
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key?.startsWith(PREFIX) && key !== keep) stale.push(key)
    }
    for (const key of stale) store.removeItem(key)
  } catch {
    // nothing to tidy that we can reach
  }
}

// One law for every deadline: what's started goes in. A lie with words in
// it, not yet sent, by someone who isn't the picture's author, is sent for
// them as time runs out — the same lead as a guess's lock-in (autoLock.ts).
export function lieAutoSendArmed({
  text,
  submitted,
  isAuthor,
}: {
  text: string
  submitted: boolean
  isAuthor: boolean
}): boolean {
  return !isAuthor && !submitted && text.trim() !== ''
}
