import {
  CreateRoomSchema,
  JoinRoomSchema,
  UpdateSettingsSchema,
  GameError,
  MIN_PLAYERS_TO_START,
} from '@smoosh/protocol'
import { createAndRegisterRoom, getRoom, touchRoom } from '../rooms/Room.ts'
import { resolveSeat } from '../rooms/seats.ts'
import { startBuild, type PhaseMachineDeps } from '../game/phaseMachine.ts'
import { deleteRoomSubmissions } from '../submissions/store.ts'
import { ok, fail, requireRoom, requireSeat, type TypedServer, type TypedSocket } from './context.ts'

export function registerLobbyHandlers(_io: TypedServer, socket: TypedSocket, deps: PhaseMachineDeps): void {
  socket.on('room:create', (payload, cb) => {
    try {
      const { name } = CreateRoomSchema.parse(payload)
      const room = createAndRegisterRoom()
      const seat = resolveSeat(room, socket.data.sessionId, name, true)
      seat.socketId = socket.id
      socket.data.roomCode = room.code
      touchRoom(room)
      cb(ok({ roomCode: room.code }))
      deps.onSnapshot(room)
    } catch (err) {
      cb(fail(err))
    }
  })

  socket.on('room:join', (payload, cb) => {
    try {
      const { roomCode, name } = JoinRoomSchema.parse(payload)
      const room = getRoom(roomCode)
      if (!room) throw new GameError('ROOM_NOT_FOUND', `no room with code ${roomCode}`)

      const isLobby = room.phase.phase === 'lobby'
      const seat = resolveSeat(room, socket.data.sessionId, name, isLobby)
      seat.connected = true
      seat.socketId = socket.id
      socket.data.roomCode = room.code
      touchRoom(room)
      cb(ok(undefined))
      deps.onSnapshot(room)
    } catch (err) {
      cb(fail(err))
    }
  })

  socket.on('room:updateSettings', (payload, cb) => {
    try {
      const room = requireRoom(socket)
      const seat = requireSeat(room, socket)
      if (!seat.isHost) throw new GameError('NOT_HOST', 'only the host can change settings')
      if (room.phase.phase !== 'lobby') throw new GameError('ALREADY_STARTED', 'settings are locked once the game starts')

      room.settings = UpdateSettingsSchema.parse(payload)
      touchRoom(room)
      cb(ok(undefined))
      deps.onSnapshot(room)
    } catch (err) {
      cb(fail(err))
    }
  })

  socket.on('room:start', (_payload, cb) => {
    try {
      const room = requireRoom(socket)
      const seat = requireSeat(room, socket)
      if (!seat.isHost) throw new GameError('NOT_HOST', 'only the host can start the game')
      if (room.phase.phase !== 'lobby') throw new GameError('ALREADY_STARTED', 'game already started')

      const seatCount = room.seats.size
      if (seatCount < MIN_PLAYERS_TO_START) {
        throw new GameError('NOT_ENOUGH_PLAYERS', `need at least ${MIN_PLAYERS_TO_START} players to start`)
      }

      const needed = room.settings.rounds * seatCount
      const available = deps.promptPool.length - room.usedPrompts.size
      if (available < needed) {
        throw new GameError('INVALID_SETTINGS', 'not enough prompts left for this many rounds and players')
      }

      touchRoom(room)
      cb(ok(undefined))
      startBuild(room, deps)
    } catch (err) {
      cb(fail(err))
    }
  })

  socket.on('room:playAgain', (_payload, cb) => {
    try {
      const room = requireRoom(socket)
      const seat = requireSeat(room, socket)
      if (!seat.isHost) throw new GameError('NOT_HOST', 'only the host can start a new game')
      if (!(room.phase.phase === 'scores' && room.phase.isFinalRound)) {
        throw new GameError('PHASE_MISMATCH', 'can only play again after the final scoreboard')
      }

      room.round = 0
      room.pictureQueue = []
      room.pictureIndex = -1
      room.promptByPlayer = new Map()
      room.liesByPictureIndex.clear()
      room.guessesByPictureIndex.clear()
      room.optionsByPictureIndex.clear()
      room.usedPrompts.clear()
      room.pendingActors = new Set()
      for (const s of room.seats.values()) s.score = 0
      room.phase = { phase: 'lobby' }
      deleteRoomSubmissions(room.code)

      touchRoom(room)
      cb(ok(undefined))
      deps.onSnapshot(room)
    } catch (err) {
      cb(fail(err))
    }
  })
}
