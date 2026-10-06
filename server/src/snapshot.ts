import type { RoomSnapshot } from '@smoosh/protocol'
import type { Room, Seat } from './rooms/Room.ts'
import { hasSubmission } from './submissions/store.ts'
import { optionsForPicture, votablePictures } from './game/phaseMachine.ts'

function computeOwnOptionId(room: Room, seat: Seat): string | null {
  const phase = room.phase
  if (phase.phase !== 'guess') return null
  const own = optionsForPicture(room, phase.pictureIndex).find((o) => o.authorId === seat.playerId)
  return own?.id ?? null
}

function computeHasActed(room: Room, seat: Seat): boolean {
  const phase = room.phase
  if (phase.phase === 'build') {
    return hasSubmission(room.code, room.round, seat.playerId)
  }
  if (phase.phase === 'lie') {
    if (phase.authorId === seat.playerId) return true
    return room.liesByPictureIndex.get(phase.pictureIndex)?.has(seat.playerId) ?? false
  }
  if (phase.phase === 'guess') {
    if (phase.authorId === seat.playerId) return true
    return room.guessesByPictureIndex.get(phase.pictureIndex)?.has(seat.playerId) ?? false
  }
  if (phase.phase === 'vote') {
    // nothing to vote for (a lone picture's author) counts as done
    return room.votes.has(seat.playerId) || votablePictures(room, seat.playerId).length === 0
  }
  return false
}

// this player's own votes only — never anyone else's
function computeOwnVote(room: Room, seat: Seat): { favourite: string; runnerUp: string | null } | null {
  if (room.phase.phase !== 'vote') return null
  return room.votes.get(seat.playerId) ?? null
}

// per-recipient view — the `you` block differs per seat, so this is never
// broadcast verbatim; call once per socket.
export function buildSnapshot(room: Room, seat: Seat): RoomSnapshot {
  const players = [...room.seats.values()].map((s) => ({
    id: s.playerId,
    name: s.name,
    isHost: s.isHost,
    presence: s.presence,
    score: s.score,
  }))

  const secretPrompt = room.phase.phase === 'build' ? (room.promptByPlayer.get(seat.playerId) ?? null) : null

  return {
    roomCode: room.code,
    settings: room.settings,
    players,
    phase: room.phase,
    waitingOn: [...room.pendingActors],
    you: {
      playerId: seat.playerId,
      isHost: seat.isHost,
      secretPrompt,
      hasActedThisPhase: computeHasActed(room, seat),
      ownOptionId: computeOwnOptionId(room, seat),
      ownVote: computeOwnVote(room, seat),
    },
  }
}
