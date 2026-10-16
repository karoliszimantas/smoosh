import type { RoomSnapshot } from '@smoosh/protocol'
import { nameList, revealSummary } from './revealSummary'
import { NO_FAKES_TEXT } from './roomMessages'

// A reveal in one line — "Mara fooled Teo · Bob found it" — so the moment
// isn't gone when the reveal is. The last picture's line opens the next Lie
// screen; Scores lists the round's lines. Kept for this tab, per room and
// round (sessionStorage, else this page's memory): a player who joined late
// or reloaded may simply have fewer.

export type PictureLine = {
  pictureIndex: number
  authorId: string
  // as they were called when it was shown — they may have left since
  authorName: string
  line: string
}

const PREFIX = 'smoosh_lines_'

function linesKey(roomCode: string, round: number): string {
  return `${PREFIX}${roomCode}_${round}`
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

// The line itself, from the reveal on screen: who fooled whom (the best
// fib first), then who found the real one. You are "you".
export function pictureLine(snapshot: RoomSnapshot): string | null {
  const summary = revealSummary(snapshot)
  if (!summary) return null
  const youId = snapshot.you.playerId
  const nameOf = (id: string) => (id === youId ? 'you' : (snapshot.players.find((p) => p.id === id)?.name ?? 'someone'))
  // you last, as everywhere else: "Teo and you"
  const names = (ids: readonly string[]) =>
    nameList([...ids.filter((id) => id !== youId), ...ids.filter((id) => id === youId)].map(nameOf))

  if (summary.lies.length === 0) return NO_FAKES_TEXT
  const fooled = summary.lies.filter((l) => l.fooled.length > 0).map((l) => `${nameOf(l.authorId)} fooled ${names(l.fooled)}`)
  const finders = summary.truth?.pickedBy ?? []
  const found = finders.length > 0 ? `${names(finders)} found it` : 'nobody found it'
  return sentence([...fooled, found].join(' · '))
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

function session(): Store | null {
  try {
    return sessionStorage
  } catch {
    return null
  }
}

// what this page keeps when storage won't — and what a read falls back on
const memory = new Map<string, PictureLine[]>()

function isLine(value: unknown): value is PictureLine {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.pictureIndex === 'number' &&
    typeof v.authorId === 'string' &&
    typeof v.authorName === 'string' &&
    typeof v.line === 'string'
  )
}

function read(key: string, store: Store | null): PictureLine[] {
  try {
    const raw = store?.getItem(key)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.filter(isLine)
    }
  } catch {
    // fall back on this page's own copy
  }
  return memory.get(key) ?? []
}

// Notes this reveal's line (once per picture; a later snapshot of the same
// reveal replaces it). Only this room's current round is kept: lines from
// other rounds and rooms are cleared, so storage never grows.
export function recordPictureLine(snapshot: RoomSnapshot, store: Store | null = session()): void {
  const { phase } = snapshot
  if (phase.phase !== 'reveal') return
  const line = pictureLine(snapshot)
  if (line === null) return
  const key = linesKey(snapshot.roomCode, phase.round)
  const authorName = snapshot.players.find((p) => p.id === phase.authorId)?.name ?? 'Someone'
  const entry: PictureLine = { pictureIndex: phase.pictureIndex, authorId: phase.authorId, authorName, line }
  const lines = [...read(key, store).filter((l) => l.pictureIndex !== phase.pictureIndex), entry].sort(
    (a, b) => a.pictureIndex - b.pictureIndex,
  )
  for (const other of [...memory.keys()]) if (other !== key) memory.delete(other)
  memory.set(key, lines)
  try {
    if (!store) return
    const stale: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k?.startsWith(PREFIX) && k !== key) stale.push(k)
    }
    for (const k of stale) store.removeItem(k)
    store.setItem(key, JSON.stringify(lines))
  } catch {
    // kept in memory only
  }
}

// every line noted this round, in picture order
export function roundPictureLines(roomCode: string, round: number, store: Store | null = session()): PictureLine[] {
  return read(linesKey(roomCode, round), store)
}

// the line of the picture before this one, if it was seen
export function previousPictureLine(
  roomCode: string,
  round: number,
  pictureIndex: number,
  store: Store | null = session(),
): PictureLine | null {
  return roundPictureLines(roomCode, round, store).findLast((l) => l.pictureIndex < pictureIndex) ?? null
}

// for tests: a fresh page
export function forgetPictureLines(): void {
  memory.clear()
}
