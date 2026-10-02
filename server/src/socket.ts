import { Server } from 'socket.io'
import type { Server as HttpServer } from 'node:http'
import { HandshakeAuthSchema, type ClientToServerEvents, type ServerToClientEvents } from '@smoosh/protocol'
import { buildSnapshot } from './snapshot.ts'
import { PROMPT_POOL } from './game/promptPool.ts'
import { hasSubmission } from './submissions/store.ts'
import type { PhaseMachineDeps } from './game/phaseMachine.ts'
import type { Room } from './rooms/Room.ts'
import { registerLobbyHandlers } from './handlers/lobbyHandlers.ts'
import { registerLieHandlers } from './handlers/lieHandlers.ts'
import { registerGuessHandlers } from './handlers/guessHandlers.ts'
import { registerRatingHandlers } from './handlers/ratingHandlers.ts'
import { registerConnectionHandlers } from './handlers/connectionHandlers.ts'
import type { TypedServer, SocketData } from './handlers/context.ts'

export function createSocketServer(httpServer: HttpServer): { io: TypedServer; deps: PhaseMachineDeps } {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>(httpServer, {
    cors: { origin: '*' },
  })

  // untrusted phones — validate the reconnect credential before any event
  // handler runs. sessionId is client-generated and never re-sent to anyone
  // else, so this is not a real auth boundary, just structural validation.
  io.use((socket, next) => {
    const parsed = HandshakeAuthSchema.safeParse(socket.handshake.auth)
    if (!parsed.success) {
      next(new Error('invalid handshake: sessionId required'))
      return
    }
    socket.data.sessionId = parsed.data.sessionId
    next()
  })

  function broadcastRoom(room: Room): void {
    for (const seat of room.seats.values()) {
      if (!seat.connected || !seat.socketId) continue
      io.to(seat.socketId).emit('state:sync', buildSnapshot(room, seat))
    }
  }

  const deps: PhaseMachineDeps = {
    promptPool: PROMPT_POOL,
    hasSubmission,
    onSnapshot: broadcastRoom,
  }

  io.on('connection', (socket) => {
    registerLobbyHandlers(io, socket, deps)
    registerLieHandlers(io, socket, deps)
    registerGuessHandlers(io, socket, deps)
    registerRatingHandlers(io, socket, deps)
    registerConnectionHandlers(io, socket, deps)
  })

  return { io, deps }
}
