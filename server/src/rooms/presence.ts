import type { RoomEvent } from '@smoosh/protocol'
import type { Room, Seat } from './Room.ts'
import { presentSeats } from './Room.ts'
import {
  dropPendingActor,
  pausePhaseClock,
  restorePendingActor,
  resumePhaseClock,
  type PhaseMachineDeps,
} from '../game/phaseMachine.ts'

// Who is in the room, and what follows from it. Leaving is only ever a
// deliberate act (room:leave); every other way of disappearing — reload,
// closed tab, lost signal, a locked phone — makes a player away, and an away
// player keeps their seat for the rest of the game. The room never waits on
// someone who isn't here, and never throws anyone out for a network event.
//
// Pure room logic — the socket layer calls in, and hears back through deps.

// every player away: the room is kept this long for someone to come back
export const EMPTY_ROOM_HOLD_MS = 10 * 60_000
// the host away this long hands the role on — long enough that a reload or
// a moment out of signal doesn't bounce it between players
export const HOST_AWAY_GRACE_MS = 30_000
// In the lobby there's no score or history to hold a seat for — only a slot
// against MAX_PLAYERS, and a placeholder every round if the game started
// with them in it. An away lobby seat is kept this long, then released.
export const LOBBY_SEAT_HOLD_MS = 60_000

export type PresenceDeps = PhaseMachineDeps & {
  // to everyone in the room, or only to `playerId`
  onEvent: (room: Room, event: RoomEvent, playerId?: string) => void
  // the room is done with: free it
  dispose: (room: Room) => void
}

// A socket has (re)attached to this seat — a new join, a reload, a
// reconnect, the page coming back to the foreground.
export function seatArrived(room: Room, deps: PresenceDeps, seat: Seat, socketId: string): void {
  const returning = seat.presence !== 'present'
  seat.socketId = socketId
  if (!returning) return

  cancelLobbyRelease(room, seat.playerId)
  seat.presence = 'present'
  seat.presentSince = Date.now()
  if (room.emptyTimer) clearTimeout(room.emptyTimer)
  room.emptyTimer = null
  const wasEmpty = room.pausedAt !== null
  resumePhaseClock(room)
  // a phase still open to them: they're expected again, and can act
  restorePendingActor(room, deps, seat.playerId)
  // the room froze with everyone's expectations as they were; whoever is
  // still gone isn't waited on (which may let the phase move on now) —
  // except in BUILD, which waits for away players anyway
  if (wasEmpty) {
    for (const id of [...room.pendingActors]) {
      const presence = room.seats.get(id)?.presence
      if (presence === 'left' || (presence === 'away' && !waitsForAway(room))) dropPendingActor(room, deps, id)
    }
  }

  const caughtUp = catchUp(room, seat)
  seat.awayFrom = null
  if (caughtUp) deps.onEvent(room, caughtUp, seat.playerId)

  const host = hostSeat(room)
  if (!host || host.presence === 'left') migrateHost(room, deps)
  else if (host.presence === 'away') scheduleHostHandover(room, deps)
}

// Gone for now: the seat stays, the room stops waiting on them.
export function seatAway(room: Room, deps: PresenceDeps, seat: Seat): void {
  if (seat.presence !== 'present') return
  seat.presence = 'away'
  seat.awayFrom = { round: room.round, pictureIndex: room.pictureIndex, phase: room.phase.phase, score: seat.score }
  if (seat.isHost) scheduleHostHandover(room, deps)
  if (room.phase.phase === 'lobby') scheduleLobbyRelease(room, deps, seat)
  stopWaitingOn(room, deps, seat)
  afterDeparture(room, deps)
}

// Chose to leave. Before the game starts there's nothing to keep, so the
// seat goes; after, it stays (score and all) in case they come back with the
// room code, but the room no longer counts on them.
export function seatLeft(room: Room, deps: PresenceDeps, seat: Seat): void {
  cancelLobbyRelease(room, seat.playerId)
  seat.socketId = null
  seat.awayFrom = null
  const wasHost = seat.isHost
  seat.isHost = false
  if (room.phase.phase === 'lobby') room.seats.delete(seat.playerId)
  else seat.presence = 'left'
  deps.onEvent(room, { type: 'left', playerId: seat.playerId, name: seat.name })
  if (wasHost) migrateHost(room, deps)
  stopWaitingOn(room, deps, seat)
  afterDeparture(room, deps)
}

// BUILD waits for away players: everyone is busy for a fixed, visible time
// anyway, so waiting costs nothing the timer wasn't already going to take.
// Every phase after it moves on without them — there, waiting holds the
// whole room up.
function waitsForAway(room: Room): boolean {
  return room.phase.phase === 'build'
}

// The room may have been waiting only on them: if so it moves on now —
// unless they were the last one here. An empty room freezes as it is
// (seatArrived sorts out who's expected when someone is back); otherwise
// every phase would see "nobody left to wait for" and the game would play
// itself out to the end with nobody watching.
function stopWaitingOn(room: Room, deps: PresenceDeps, seat: Seat): void {
  if (presentSeats(room).length === 0) {
    pausePhaseClock(room)
    return
  }
  if (seat.presence === 'away' && waitsForAway(room)) return
  dropPendingActor(room, deps, seat.playerId)
}

// ---------- the lobby

function cancelLobbyRelease(room: Room, playerId: string): void {
  const timer = room.lobbyReleaseTimers.get(playerId)
  if (timer) clearTimeout(timer)
  room.lobbyReleaseTimers.delete(playerId)
}

function scheduleLobbyRelease(room: Room, deps: PresenceDeps, seat: Seat): void {
  cancelLobbyRelease(room, seat.playerId)
  const timer = setTimeout(() => {
    room.lobbyReleaseTimers.delete(seat.playerId)
    if (room.phase.phase !== 'lobby' || room.seats.get(seat.playerId)?.presence !== 'away') return
    releaseSeat(room, deps, seat)
    deps.onSnapshot(room)
  }, LOBBY_SEAT_HOLD_MS)
  room.lobbyReleaseTimers.set(seat.playerId, timer)
}

// gone from the room as if they'd never joined: the slot is free, and the
// room code gets them a fresh seat for as long as the game hasn't started
function releaseSeat(room: Room, deps: PresenceDeps, seat: Seat): void {
  cancelLobbyRelease(room, seat.playerId)
  room.seats.delete(seat.playerId)
  room.pendingActors.delete(seat.playerId)
  if (seat.isHost) {
    seat.isHost = false
    migrateHost(room, deps)
  }
  if (room.seats.size === 0) dispose(room, deps)
}

// The game is starting: only players here now are dealt in. Anyone away
// gets no seat, no score line and no placeholders; they can't come back to
// this game, as with anyone who wasn't in the lobby when it began.
export function dealIn(room: Room, deps: PresenceDeps): void {
  for (const seat of [...room.seats.values()]) {
    if (seat.presence !== 'present') releaseSeat(room, deps, seat)
  }
}

// back in the lobby after a game (play again): away players get the
// lobby's 60 seconds from now
export function enterLobby(room: Room, deps: PresenceDeps): void {
  for (const seat of room.seats.values()) {
    if (seat.presence === 'away') scheduleLobbyRelease(room, deps, seat)
  }
}

function afterDeparture(room: Room, deps: PresenceDeps): void {
  const seats = [...room.seats.values()]
  if (seats.every((s) => s.presence === 'left')) {
    // everyone chose to go: nothing to hold
    dispose(room, deps)
    return
  }
  if (presentSeats(room).length > 0) return
  // nobody here, but someone may be back: stop the clock and hold the room
  pausePhaseClock(room)
  if (!room.emptyTimer) room.emptyTimer = setTimeout(() => dispose(room, deps), EMPTY_ROOM_HOLD_MS)
}

function dispose(room: Room, deps: PresenceDeps): void {
  if (room.emptyTimer) clearTimeout(room.emptyTimer)
  if (room.hostTimer) clearTimeout(room.hostTimer)
  room.emptyTimer = null
  room.hostTimer = null
  deps.dispose(room)
}

// ---------- host

function hostSeat(room: Room): Seat | undefined {
  return [...room.seats.values()].find((s) => s.isHost)
}

function scheduleHostHandover(room: Room, deps: PresenceDeps): void {
  if (room.hostTimer) return
  room.hostTimer = setTimeout(() => {
    room.hostTimer = null
    const host = hostSeat(room)
    if (host && host.presence === 'present') return
    // nobody here to hand it to — whoever comes back first gets it then
    if (presentSeats(room).length === 0) return
    migrateHost(room, deps)
    deps.onSnapshot(room)
  }, HOST_AWAY_GRACE_MS)
}

// The longest-present player takes over. The old host coming back doesn't
// take it back — that's how the role ends up bouncing between phones.
export function migrateHost(room: Room, deps: PresenceDeps): void {
  if (room.hostTimer) clearTimeout(room.hostTimer)
  room.hostTimer = null
  let next: Seat | undefined
  for (const seat of presentSeats(room)) {
    if (!next || seat.presentSince < next.presentSince) next = seat
  }
  if (!next || next.isHost) return
  for (const seat of room.seats.values()) seat.isHost = false
  next.isHost = true
  deps.onEvent(room, { type: 'hostChanged', playerId: next.playerId, name: next.name })
}

// ---------- catching up

function roundEnded(round: number, phase: Room['phase']['phase'], at: { round: number; phase: string }): boolean {
  return at.round > round || (at.round === round && at.phase === 'scores' && phase !== 'scores')
}

// what went by while a returning player was away — null if nothing did
function catchUp(room: Room, seat: Seat): RoomEvent | null {
  const from = seat.awayFrom
  if (!from || room.phase.phase === 'lobby') return null
  let roundsFinished = 0
  for (let r = from.round; r <= room.round; r++) {
    if (r === 0) continue
    const endedBefore = r < from.round || (r === from.round && from.phase === 'scores')
    if (!endedBefore && roundEnded(r, from.phase, { round: room.round, phase: room.phase.phase })) roundsFinished++
  }
  const picturesMissed =
    room.round === from.round && room.pictureIndex > from.pictureIndex ? room.pictureIndex - from.pictureIndex : 0
  if (roundsFinished === 0 && picturesMissed === 0) return null
  const others = [...room.seats.values()].filter((s) => s.presence !== 'left')
  return {
    type: 'caughtUp',
    roundsFinished,
    picturesMissed,
    pointsGained: seat.score - from.score,
    rank: 1 + others.filter((s) => s.score > seat.score).length,
    playerCount: others.length,
  }
}
