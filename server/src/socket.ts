import { Server } from 'socket.io'
import type { Server as HttpServer } from 'node:http'
import { HandshakeAuthSchema, type ClientToServerEvents, type ServerToClientEvents } from '@smoosh/protocol'
import { buildSnapshot } from './snapshot.ts'
import { gamePrompts } from './prompts/gamePrompts.ts'
import { hasSubmission, deleteRoomSubmissions } from './submissions/store.ts'
import type { PresenceDeps } from './rooms/presence.ts'
import { deleteRoom, findSeatBySession, getRoom, type Room } from './rooms/Room.ts'
import { logPhaseChange, roomLog, who } from './roomLog.ts'
import { registerLobbyHandlers } from './handlers/lobbyHandlers.ts'
import { registerLieHandlers } from './handlers/lieHandlers.ts'
import { registerGuessHandlers } from './handlers/guessHandlers.ts'
import { registerVoteHandlers } from './handlers/voteHandlers.ts'
import { registerBuildHandlers } from './handlers/buildHandlers.ts'
import { registerChainHandlers } from './handlers/chainHandlers.ts'
import { registerConnectionHandlers } from './handlers/connectionHandlers.ts'
import type { TypedServer, SocketData } from './handlers/context.ts'

export function createSocketServer(httpServer: HttpServer): { io: TypedServer; deps: PresenceDeps } {
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
    logPhaseChange(room)
    for (const seat of room.seats.values()) {
      // an away seat may still have a socket (a backgrounded page): it gets
      // the state too, so it's current the moment it's looked at again
      if (!seat.socketId) continue
      io.to(seat.socketId).emit('state:sync', buildSnapshot(room, seat))
    }
  }

  const deps: PresenceDeps = {
    prompts: gamePrompts,
    hasSubmission,
    onSnapshot: broadcastRoom,
    onEvent: (room, event, playerId) => {
      for (const seat of room.seats.values()) {
        if (!seat.socketId || (playerId !== undefined && seat.playerId !== playerId)) continue
        io.to(seat.socketId).emit('room:event', event)
      }
    },
    dispose: (room) => {
      deleteRoomSubmissions(room.code)
      deleteRoom(room.code)
    },
  }

  io.on('connection', (socket) => {
    // every answered action, by whom and how it went — a refusal is the
    // trail a "my screen froze" report needs. Wraps the ack; the handlers
    // don't know it's there.
    socket.use((packet, next) => {
      const ack: unknown = packet[packet.length - 1]
      const event = String(packet[0])
      if (typeof ack === 'function' && event !== 'room:join' && event !== 'room:create') {
        packet[packet.length - 1] = (res: unknown) => {
          const code = socket.data.roomCode
          const room = code ? getRoom(code) : undefined
          if (room) {
            const seat = findSeatBySession(room, socket.data.sessionId)
            const outcome =
              typeof res === 'object' && res !== null && 'ok' in res && res.ok === false && 'code' in res
                ? `refused ${String(res.code)}`
                : 'ok'
            roomLog(room.code, `${who(seat)}: ${event} ${outcome}`)
          }
          ;(ack as (r: unknown) => void)(res)
        }
      }
      next()
    })
    registerLobbyHandlers(io, socket, deps)
    registerLieHandlers(io, socket, deps)
    registerGuessHandlers(io, socket, deps)
    registerVoteHandlers(io, socket, deps)
    registerBuildHandlers(io, socket, deps)
    registerChainHandlers(io, socket, deps)
    registerConnectionHandlers(io, socket, deps)
  })

  return { io, deps }
}
