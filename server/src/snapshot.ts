import type { RoomSnapshot } from '@smoosh/protocol'
import type { Room, Seat } from './rooms/Room.ts'
import { hasSubmission } from './submissions/store.ts'
import { nextPassOf, optionsForPicture, passChainOf, votableChains, votablePictures } from './game/phaseMachine.ts'
import { effectivePrompt, personalDeadline, swapProblem, swapsLeft, windowView } from './game/promptSwap.ts'

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
  if (phase.phase === 'pass') {
    // nothing to add this pass counts as done
    return passChainOf(room, seat.playerId) === null || hasSubmission(room.code, phase.unit, seat.playerId)
  }
  if (phase.phase === 'chainVote') {
    return room.chainVotes.has(seat.playerId) || votableChains(room, seat.playerId).length === 0
  }
  if (phase.phase === 'vote') {
    // nothing to vote for (a lone picture's author) counts as done
    return room.votes.has(seat.playerId) || votablePictures(room, seat.playerId).length === 0
  }
  return false
}

// this player's own guess on the current picture, once made
function computeOwnGuess(room: Room, seat: Seat): string | null {
  const phase = room.phase
  if (phase.phase !== 'guess') return null
  return room.guessesByPictureIndex.get(phase.pictureIndex)?.get(seat.playerId) ?? null
}

// this player's own votes only — never anyone else's
function computeOwnVote(room: Room, seat: Seat): { favourite: string; runnerUp: string | null } | null {
  if (room.phase.phase !== 'vote') return null
  return room.votes.get(seat.playerId) ?? null
}

// A chain pass, as this player sees it: their chain's earlier passes (to
// be drawn as ghosts), and the prompt only on the first pass — nobody
// after the first player ever sees it before the reveal.
function computePass(room: Room, seat: Seat) {
  const phase = room.phase
  if (phase.phase !== 'pass') return null
  const chainId = passChainOf(room, seat.playerId)
  return {
    chainId,
    prompt: chainId !== null && phase.pass === 0 ? (room.chainPrompts.get(chainId) ?? null) : null,
    underlay: chainId === null ? [] : (room.chainPasses.get(chainId) ?? []).map((p) => p.imagePath),
    nextPass: chainId === null ? nextPassOf(room, seat.playerId) : null,
  }
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

  const now = Date.now()
  const building = room.phase.phase === 'build'
  const secretPrompt = building ? (effectivePrompt(room, seat.playerId, now) ?? null) : null
  const window = building ? windowView(room, seat.playerId, now) : null

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
      ownGuessId: computeOwnGuess(room, seat),
      ownVote: computeOwnVote(room, seat),
      pass: computePass(room, seat),
      chainVote:
        room.phase.phase === 'chainVote'
          ? { votable: votableChains(room, seat.playerId), own: room.chainVotes.get(seat.playerId) ?? null }
          : null,
      build: building
        ? {
            windowEndsAt: window && window.startedAt === null ? window.closesAt : null,
            deadline: personalDeadline(room, seat.playerId, now),
            swapsLeft: swapsLeft(room, seat.playerId),
            canSwap: swapProblem(room, seat.playerId, now, room.swapPool) === null,
            offered: window && window.startedAt === null ? window.offered : null,
          }
        : null,
    },
  }
}
