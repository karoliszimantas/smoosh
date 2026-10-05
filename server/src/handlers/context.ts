import type { Server, Socket } from 'socket.io'
import { GameError, type AckResult, type ClientToServerEvents, type ServerToClientEvents } from '@smoosh/protocol'
import { getRoom, findSeatBySession, type Room, type Seat } from '../rooms/Room.ts'

export type SocketData = { sessionId: string; roomCode?: string }
export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>

export function ok<T>(data: T): AckResult<T> {
  return { ok: true, data }
}

export function fail(err: unknown): AckResult<never> {
  if (err instanceof GameError) return { ok: false, code: err.code, message: err.message }
  const message = err instanceof Error ? err.message : 'invalid request'
  return { ok: false, code: 'INVALID_PAYLOAD', message }
}

export function requireRoom(socket: TypedSocket): Room {
  const roomCode = socket.data.roomCode
  const room = roomCode ? getRoom(roomCode) : undefined
  if (!room) throw new GameError('ROOM_NOT_FOUND', 'you are not in a room')
  return room
}

export function requireSeat(room: Room, socket: TypedSocket): Seat {
  const seat = findSeatBySession(room, socket.data.sessionId)
  if (!seat) throw new GameError('ROOM_NOT_FOUND', 'you do not have a seat in this room')
  return seat
}
