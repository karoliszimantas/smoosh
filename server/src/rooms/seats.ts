import { MAX_PLAYERS } from '@smoosh/protocol'
import { GameError } from '@smoosh/protocol'
import type { Room, Seat } from './Room.ts'

function uniqueName(room: Room, requestedName: string): string {
  const taken = new Set([...room.seats.values()].map((s) => s.name.toLowerCase()))
  if (!taken.has(requestedName.toLowerCase())) return requestedName

  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${requestedName} (${suffix})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  // effectively unreachable at MAX_PLAYERS=4, but keeps the function total
  return `${requestedName} (${crypto.randomUUID().slice(0, 4)})`
}

// resolves a sessionId to its seat — an existing seat means this is a
// reconnect (rejoin after a dropped connection or page reload); no existing
// seat means a fresh join, subject to capacity and lobby-only gating
export function resolveSeat(room: Room, sessionId: string, requestedName: string, isLobby: boolean): Seat {
  const existing = room.seats.get(sessionId)
  if (existing) return existing

  if (!isLobby) {
    throw new GameError('ALREADY_STARTED', 'cannot join a room that has already started')
  }
  if (room.seats.size >= MAX_PLAYERS) {
    throw new GameError('ROOM_FULL', `room is full (max ${MAX_PLAYERS} players)`)
  }

  const seat: Seat = {
    sessionId,
    playerId: crypto.randomUUID(),
    name: uniqueName(room, requestedName),
    isHost: room.seats.size === 0,
    connected: true,
    socketId: null,
    score: 0,
    joinedAt: Date.now(),
  }
  room.seats.set(sessionId, seat)
  return seat
}

// promotes the earliest-joined still-connected seat to host. Called after a
// host's seat is marked disconnected. "Longest-connected" is read as
// earliest original joiner still connected, not most-recently-reconnected —
// stable, doesn't churn on flaky connections.
export function promoteHostIfNeeded(room: Room, disconnectedSeat: Seat): void {
  if (!disconnectedSeat.isHost) return
  disconnectedSeat.isHost = false
  ensureHost(room)
}

// a room whose host left while nobody else was connected ends up hostless —
// nobody could start or change settings, so whoever (re)connects next takes it
export function ensureHost(room: Room): void {
  let next: Seat | null = null
  for (const seat of room.seats.values()) {
    if (seat.isHost) return
    if (!seat.connected) continue
    if (!next || seat.joinedAt < next.joinedAt) next = seat
  }
  if (next) next.isHost = true
}
