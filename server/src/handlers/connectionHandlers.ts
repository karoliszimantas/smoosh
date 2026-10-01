import { getRoom, deleteRoom, touchRoom } from '../rooms/Room.ts'
import { promoteHostIfNeeded } from '../rooms/seats.ts'
import { dropPendingActor, type PhaseMachineDeps } from '../game/phaseMachine.ts'
import { deleteRoomSubmissions } from '../submissions/store.ts'
import type { TypedServer, TypedSocket } from './context.ts'

export function registerConnectionHandlers(_io: TypedServer, socket: TypedSocket, deps: PhaseMachineDeps): void {
  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode
    if (!roomCode) return
    const room = getRoom(roomCode)
    if (!room) return

    const seat = room.seats.get(socket.data.sessionId)
    // a stale event after a newer reconnect already replaced this socket
    if (!seat || seat.socketId !== socket.id) return

    seat.connected = false
    seat.socketId = null
    // before the game starts there's nothing to hold a seat for — dropping it
    // frees the slot (MAX_PLAYERS counts seats) and clears the "(disconnected)"
    // ghost; a reload just rejoins as a fresh seat
    if (room.phase.phase === 'lobby') room.seats.delete(socket.data.sessionId)
    promoteHostIfNeeded(room, seat)
    touchRoom(room)

    const anyoneConnected = [...room.seats.values()].some((s) => s.connected)
    if (!anyoneConnected && room.phase.phase === 'scores' && room.phase.isFinalRound) {
      deleteRoomSubmissions(room.code)
      deleteRoom(room.code)
      return
    }

    dropPendingActor(room, deps, seat.playerId)
    deps.onSnapshot(room)
  })
}
