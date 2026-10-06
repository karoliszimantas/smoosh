import {
  CreateRoomSchema,
  JoinRoomSchema,
  LeaveRoomSchema,
  UpdateSettingsSchema,
  GameError,
  MIN_PLAYERS_TO_START,
  settingsProblem,
  promptsNeeded,
} from '@smoosh/protocol'
import {
  allRooms,
  createAndRegisterRoom,
  getRoom,
  findSeatBySession,
  presentSeats,
  touchRoom,
  type Room,
  type Seat,
} from '../rooms/Room.ts'
import { resolveSeat } from '../rooms/seats.ts'
import { dealIn, enterLobby, seatArrived, seatAway, seatLeft, type PresenceDeps } from '../rooms/presence.ts'
import { startBuild } from '../game/phaseMachine.ts'
import { deleteRoomSubmissions } from '../submissions/store.ts'
import { ok, fail, requireRoom, requireSeat, type TypedServer, type TypedSocket } from './context.ts'

export function registerLobbyHandlers(io: TypedServer, socket: TypedSocket, deps: PresenceDeps): void {
  // Taking a seat in a room is leaving any other: a player is in one game
  // at a time. Found by session, not socket — the old room may be from a
  // socket long gone (a closed tab).
  function leaveOtherRooms(nextCode: string | null): void {
    for (const room of allRooms()) {
      if (room.code === nextCode) continue
      const seat = findSeatBySession(room, socket.data.sessionId)
      if (!seat || seat.presence === 'left') continue
      seatLeft(room, deps, seat)
      deps.onSnapshot(room)
    }
  }

  function attach(room: Room, seat: Seat): void {
    // the same player open somewhere else (another tab, another browser
    // window): this one takes the seat, the old one is told and let go
    const previous = seat.socketId
    if (previous && previous !== socket.id) {
      io.to(previous).emit('room:event', { type: 'replaced' })
      io.in(previous).disconnectSockets(true)
    }
    socket.data.roomCode = room.code
    seatArrived(room, deps, seat, socket.id)
    touchRoom(room)
  }

  socket.on('room:create', (payload, cb) => {
    try {
      const { name } = CreateRoomSchema.parse(payload)
      leaveOtherRooms(null)
      const room = createAndRegisterRoom()
      const seat = resolveSeat(room, socket.data.sessionId, name, true)
      attach(room, seat)
      cb(ok({ roomCode: room.code }))
      deps.onSnapshot(room)
    } catch (err) {
      cb(fail(err))
    }
  })

  // a first join, and every way of coming back: reload, reopened tab,
  // reconnect, the page returning from the background, the room code typed
  // in again after leaving
  socket.on('room:join', (payload, cb) => {
    try {
      const { roomCode, name } = JoinRoomSchema.parse(payload)
      const room = getRoom(roomCode)
      if (!room) throw new GameError('ROOM_NOT_FOUND', `no room with code ${roomCode}`)

      const seat = resolveSeat(room, socket.data.sessionId, name, room.phase.phase === 'lobby')
      leaveOtherRooms(room.code)
      attach(room, seat)
      cb(ok(undefined))
      deps.onSnapshot(room)
    } catch (err) {
      cb(fail(err))
    }
  })

  socket.on('room:leave', (payload, cb) => {
    try {
      const { roomCode } = LeaveRoomSchema.parse(payload)
      const room = (roomCode ? getRoom(roomCode) : undefined) ?? requireRoom(socket)
      const seat = requireSeat(room, socket)
      socket.data.roomCode = undefined
      seatLeft(room, deps, seat)
      touchRoom(room)
      cb(ok(undefined))
      deps.onSnapshot(room)
    } catch (err) {
      cb(fail(err))
    }
  })

  socket.on('presence:away', (_payload, cb) => {
    try {
      const room = requireRoom(socket)
      const seat = requireSeat(room, socket)
      // only the socket holding the seat speaks for it
      if (seat.socketId === socket.id) seatAway(room, deps, seat)
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

      const settings = UpdateSettingsSchema.parse(payload)
      const problem = settingsProblem(settings)
      if (problem) throw new GameError('INVALID_SETTINGS', problem)
      room.settings = settings
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

      // only players here now are dealt in (dealIn, below)
      const seatCount = presentSeats(room).length
      if (seatCount < MIN_PLAYERS_TO_START) {
        throw new GameError('NOT_ENOUGH_PLAYERS', `need at least ${MIN_PLAYERS_TO_START} players to start`)
      }

      // settings are locked from here on (updateSettings rejects outside the
      // lobby); re-checked in case a bad combination slipped in some other way
      const problem = settingsProblem(room.settings)
      if (problem) throw new GameError('INVALID_SETTINGS', problem)

      const needed = promptsNeeded(room.settings, seatCount)
      const available = deps.prompts(room.settings.mode).filter((p) => !room.usedPrompts.has(p)).length
      if (available < needed) {
        throw new GameError('INVALID_SETTINGS', 'not enough prompts left for this many rounds and players')
      }

      dealIn(room, deps)
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
      room.shownThisRound = []
      room.pictureIndex = -1
      room.promptByPlayer = new Map()
      room.liesByPictureIndex.clear()
      room.guessesByPictureIndex.clear()
      room.optionsByPictureIndex.clear()
      room.votes.clear()
      room.exhibition = []
      room.roundPoints.clear()
      room.gamePoints.clear()
      room.usedPrompts.clear()
      room.pendingActors = new Set()
      for (const s of room.seats.values()) {
        s.score = 0
        s.awayFrom = null
        // a new game starts in the lobby, where there's no seat to keep for
        // someone who chose to go
        if (s.presence === 'left') room.seats.delete(s.playerId)
      }
      room.phase = { phase: 'lobby' }
      deleteRoomSubmissions(room.code)

      enterLobby(room, deps)
      touchRoom(room)
      cb(ok(undefined))
      deps.onSnapshot(room)
    } catch (err) {
      cb(fail(err))
    }
  })
}
