import { getRoom, findSeatBySession, touchRoom } from '../rooms/Room.ts'
import { seatAway, type PresenceDeps } from '../rooms/presence.ts'
import type { TypedServer, TypedSocket } from './context.ts'
import { roomLog, who } from '../roomLog.ts'

export function registerConnectionHandlers(_io: TypedServer, socket: TypedSocket, deps: PresenceDeps): void {
  // a socket going is never a player leaving — reloads, lost signal and
  // locked phones all look like this. The seat is held; see presence.ts.
  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode
    if (!roomCode) return
    const room = getRoom(roomCode)
    if (!room) return

    const seat = findSeatBySession(room, socket.data.sessionId)
    // a stale event after a newer socket already took the seat over
    if (!seat || seat.socketId !== socket.id) return

    seat.socketId = null
    touchRoom(room)
    seatAway(room, deps, seat)
    roomLog(room.code, `${who(seat)} away (connection closed)`)
    deps.onSnapshot(room)
  })
}
