import { MAX_PLAYERS } from '@smoosh/protocol'
import { GameError } from '@smoosh/protocol'
import { findSeatBySession, type Room, type Seat } from './Room.ts'

function uniqueName(room: Room, requestedName: string): string {
  const taken = new Set([...room.seats.values()].map((s) => s.name.toLowerCase()))
  if (!taken.has(requestedName.toLowerCase())) return requestedName

  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${requestedName} (${suffix})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  // effectively unreachable at MAX_PLAYERS=8, but keeps the function total
  return `${requestedName} (${crypto.randomUUID().slice(0, 4)})`
}

// resolves a sessionId to its seat — an existing seat means this is the
// same player coming back (reload, closed tab, lost signal, or after leaving,
// with the room code); no existing seat means a fresh join, subject to
// capacity and lobby-only gating
export function resolveSeat(room: Room, sessionId: string, requestedName: string, isLobby: boolean): Seat {
  const existing = findSeatBySession(room, sessionId)
  if (existing) return existing

  if (!isLobby) {
    throw new GameError('ALREADY_STARTED', 'cannot join a room that has already started')
  }
  if (room.seats.size >= MAX_PLAYERS) {
    throw new GameError('ROOM_FULL', `room is full (max ${MAX_PLAYERS} players)`)
  }

  const now = Date.now()
  const seat: Seat = {
    sessionId,
    playerId: crypto.randomUUID(),
    name: uniqueName(room, requestedName),
    isHost: room.seats.size === 0,
    // becomes present once a socket attaches (seatArrived)
    presence: 'away',
    socketId: null,
    score: 0,
    joinedAt: now,
    presentSince: now,
    awayFrom: null,
  }
  room.seats.set(seat.playerId, seat)
  return seat
}
