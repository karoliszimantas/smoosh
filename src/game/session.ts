import { generateId } from '../id'

// Who this player is, kept in localStorage so it outlives the tab: a closed
// tab, a reload, the browser killing a backgrounded page — all come back as
// the same player in the same seat.
//
// The session id is the secret the server knows this player by (never shown
// to anyone else); the player id is the public one everybody sees. The room
// record is what to rejoin on the next visit, and is cleared only by
// deliberately leaving or by the room no longer existing.

const SESSION_KEY = 'smoosh_session_id'
const ACTIVE_ROOM_KEY = 'smoosh_active_room'

export type ActiveRoom = { roomCode: string; playerId: string; name: string }

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // storage unavailable (some private modes): this visit still works, a
    // closed tab just can't find its way back
  }
}

export function getSessionId(): string {
  const existing = read(SESSION_KEY)
  if (existing) return existing
  // a tab from before identity moved to localStorage keeps its seat
  let id: string | null = null
  try {
    id = sessionStorage.getItem(SESSION_KEY)
  } catch {
    // fall through to a fresh id
  }
  id ??= generateId()
  write(SESSION_KEY, id)
  return id
}

export function getActiveRoom(): ActiveRoom | null {
  const raw = read(ACTIVE_ROOM_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { roomCode, playerId, name } = parsed as Record<string, unknown>
    if (typeof roomCode !== 'string' || typeof playerId !== 'string' || typeof name !== 'string') return null
    return { roomCode, playerId, name }
  } catch {
    return null
  }
}

export function setActiveRoom(room: ActiveRoom): void {
  write(ACTIVE_ROOM_KEY, JSON.stringify(room))
}

export function clearActiveRoom(): void {
  write(ACTIVE_ROOM_KEY, null)
}
