import {
  LIE_PHASE_SEC,
  GUESS_PHASE_SEC,
  REVEAL_PHASE_SEC,
  SCORES_PHASE_SEC,
  RATE_PHASE_SEC,
  RATE_RESULT_PHASE_SEC,
} from '@smoosh/protocol'
import type { Room, PictureOption } from '../rooms/Room.ts'
import { connectedSeats, findSeatByPlayerId } from '../rooms/Room.ts'
import { submissionPath } from '../submissions/store.ts'
import { assignPrompts } from './promptAssignment.ts'
import { scorePicture, scoreRatings } from './scoring.ts'

export type PhaseMachineDeps = {
  promptPool: readonly string[]
  hasSubmission: (roomCode: string, round: number, playerId: string) => boolean
  onSnapshot: (room: Room) => void
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = copy[i]
    const b = copy[j]
    if (a === undefined || b === undefined) continue
    copy[i] = b
    copy[j] = a
  }
  return copy
}

function clearRoomTimer(room: Room): void {
  if (room.timer) clearTimeout(room.timer)
  room.timer = null
}

function schedulePhaseEnd(room: Room, durationMs: number, onEnd: () => void): void {
  clearRoomTimer(room)
  room.timer = setTimeout(onEnd, durationMs)
}

function deadlineIn(sec: number): number {
  return Date.now() + sec * 1000
}

// the only phases that can early-advance via a player action; reveal and
// scores are driven purely by their timers (pendingActors stays empty there,
// so dropPendingActor's guard never fires for them)
function advanceCurrentPhase(room: Room, deps: PhaseMachineDeps): void {
  switch (room.phase.phase) {
    case 'build':
      endBuild(room, deps)
      return
    case 'lie':
      startGuess(room, deps)
      return
    case 'guess':
      startReveal(room, deps)
      return
    case 'rate':
      startRateResult(room, deps)
      return
    default:
      return
  }
}

// called by every submit handler after recording an action, and by the
// disconnect handler for a leaving player. A no-op if the player wasn't
// actually pending (e.g. disconnecting during reveal, where pendingActors is
// always empty) — guarded by `delete`'s boolean return, not just size===0.
export function dropPendingActor(room: Room, deps: PhaseMachineDeps, playerId: string): void {
  const wasPending = room.pendingActors.delete(playerId)
  if (wasPending && room.pendingActors.size === 0) {
    clearRoomTimer(room)
    advanceCurrentPhase(room, deps)
  }
}

export function startBuild(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  room.round += 1
  room.liesByPictureIndex.clear()
  room.guessesByPictureIndex.clear()
  room.optionsByPictureIndex.clear()
  room.ratingsByPictureIndex.clear()
  room.pictureQueue = []
  room.pictureIndex = -1

  const seatPlayerIds = [...room.seats.values()].map((s) => s.playerId)
  const availablePool = deps.promptPool.filter((p) => !room.usedPrompts.has(p))
  if (room.settings.mode === 'guess') {
    const { assignments, used } = assignPrompts(seatPlayerIds, availablePool)
    room.promptByPlayer = assignments
    for (const p of used) room.usedPrompts.add(p)
  } else {
    // gallery: one prompt everybody shares — or, freestyle, an empty one.
    // Freestyle is otherwise the same game; the client shows a placeholder.
    let shared = ''
    if (room.settings.prompted) {
      const { used } = assignPrompts(['shared'], availablePool)
      shared = used[0] ?? ''
      if (shared) room.usedPrompts.add(shared)
    }
    room.promptByPlayer = new Map(seatPlayerIds.map((id) => [id, shared]))
  }

  room.pendingActors = new Set(connectedSeats(room).map((s) => s.playerId))
  const deadline = deadlineIn(room.settings.buildTimeSec)
  room.phase = { phase: 'build', round: room.round, totalRounds: room.settings.rounds, deadline }
  schedulePhaseEnd(room, room.settings.buildTimeSec * 1000, () => advanceCurrentPhase(room, deps))
  deps.onSnapshot(room)
}

function endBuild(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  room.pictureQueue = [...room.seats.values()]
    .filter((seat) => deps.hasSubmission(room.code, room.round, seat.playerId))
    .map((seat) => seat.playerId)
  room.pictureIndex = -1

  if (room.pictureQueue.length === 0) {
    endRoundOrGame(room, deps)
    return
  }
  if (room.settings.mode === 'gallery') startRate(room, deps)
  else startLie(room, deps)
}

export function startLie(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  room.pictureIndex += 1
  const authorId = room.pictureQueue[room.pictureIndex]
  if (authorId === undefined) throw new Error('internal error: startLie called with no current picture')

  room.pendingActors = new Set(connectedSeats(room).map((s) => s.playerId).filter((id) => id !== authorId))
  const deadline = deadlineIn(LIE_PHASE_SEC)
  room.phase = {
    phase: 'lie',
    round: room.round,
    totalRounds: room.settings.rounds,
    pictureIndex: room.pictureIndex,
    pictureCount: room.pictureQueue.length,
    authorId,
    imagePath: submissionPath(room.code, room.round, authorId),
    deadline,
  }
  schedulePhaseEnd(room, LIE_PHASE_SEC * 1000, () => advanceCurrentPhase(room, deps))
  deps.onSnapshot(room)
}

function startGuess(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  const pictureIndex = room.pictureIndex
  const authorId = room.pictureQueue[pictureIndex]
  if (authorId === undefined) throw new Error('internal error: startGuess called with no current picture')
  const truth = room.promptByPlayer.get(authorId)
  if (truth === undefined) throw new Error('internal error: no prompt recorded for picture author')

  const liesMap = room.liesByPictureIndex.get(pictureIndex) ?? new Map<string, string>()
  const lieOptions: PictureOption[] = [...liesMap.entries()].map(([lieAuthorId, text]) => ({
    id: crypto.randomUUID(),
    text,
    authorId: lieAuthorId,
  }))
  const truthOption: PictureOption = { id: crypto.randomUUID(), text: truth, authorId: null }
  const options = shuffle([truthOption, ...lieOptions])
  room.optionsByPictureIndex.set(pictureIndex, options)

  room.pendingActors = new Set(connectedSeats(room).map((s) => s.playerId).filter((id) => id !== authorId))
  const deadline = deadlineIn(GUESS_PHASE_SEC)
  room.phase = {
    phase: 'guess',
    round: room.round,
    totalRounds: room.settings.rounds,
    pictureIndex,
    pictureCount: room.pictureQueue.length,
    authorId,
    imagePath: submissionPath(room.code, room.round, authorId),
    options: options.map((o) => ({ id: o.id, text: o.text })),
    deadline,
  }
  schedulePhaseEnd(room, GUESS_PHASE_SEC * 1000, () => advanceCurrentPhase(room, deps))
  deps.onSnapshot(room)
}

function startReveal(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  const pictureIndex = room.pictureIndex
  const authorId = room.pictureQueue[pictureIndex]
  if (authorId === undefined) throw new Error('internal error: startReveal called with no current picture')
  const options = room.optionsByPictureIndex.get(pictureIndex) ?? []
  const truthOption = options.find((o) => o.authorId === null)
  if (!truthOption) throw new Error('internal error: no truth option recorded for picture')

  const guessesMap = room.guessesByPictureIndex.get(pictureIndex) ?? new Map<string, string>()
  const guesses = [...guessesMap.entries()].map(([playerId, optionId]) => ({ playerId, optionId }))
  const lies = options
    .filter((o): o is PictureOption & { authorId: string } => o.authorId !== null)
    .map((o) => ({ optionId: o.id, authorId: o.authorId }))

  const deltas = scorePicture({ authorId, truthOptionId: truthOption.id, lies, guesses })
  const totals = new Map<string, number>()
  for (const delta of deltas) {
    const seat = findSeatByPlayerId(room, delta.playerId)
    if (seat) seat.score += delta.points
    totals.set(delta.playerId, (totals.get(delta.playerId) ?? 0) + delta.points)
  }

  const pickedByOption = new Map<string, string[]>()
  for (const guess of guesses) {
    const list = pickedByOption.get(guess.optionId) ?? []
    list.push(guess.playerId)
    pickedByOption.set(guess.optionId, list)
  }

  room.phase = {
    phase: 'reveal',
    round: room.round,
    totalRounds: room.settings.rounds,
    pictureIndex,
    pictureCount: room.pictureQueue.length,
    authorId,
    imagePath: submissionPath(room.code, room.round, authorId),
    options: options.map((o) => ({
      id: o.id,
      text: o.text,
      isTruth: o.authorId === null,
      authorId: o.authorId,
      pickedBy: pickedByOption.get(o.id) ?? [],
    })),
    realOptionId: truthOption.id,
    pointsThisPicture: [...totals.entries()].map(([playerId, points]) => ({ playerId, points })),
    deadline: deadlineIn(REVEAL_PHASE_SEC),
  }
  room.pendingActors = new Set()
  schedulePhaseEnd(room, REVEAL_PHASE_SEC * 1000, () => afterReveal(room, deps))
  deps.onSnapshot(room)
}

function afterReveal(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  if (room.pictureIndex + 1 < room.pictureQueue.length) {
    startLie(room, deps)
  } else {
    endRoundOrGame(room, deps)
  }
}

// ---------- gallery: rate each picture, then show how it did

// the prompt everyone built to this round ("" in freestyle) — the same for
// every player in gallery, so any seat's assignment is the one
function sharedPrompt(room: Room, authorId: string): string {
  return room.promptByPlayer.get(authorId) ?? ''
}

export function startRate(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  room.pictureIndex += 1
  const authorId = room.pictureQueue[room.pictureIndex]
  if (authorId === undefined) throw new Error('internal error: startRate called with no current picture')

  room.pendingActors = new Set(connectedSeats(room).map((s) => s.playerId).filter((id) => id !== authorId))
  room.phase = {
    phase: 'rate',
    round: room.round,
    totalRounds: room.settings.rounds,
    pictureIndex: room.pictureIndex,
    pictureCount: room.pictureQueue.length,
    authorId,
    imagePath: submissionPath(room.code, room.round, authorId),
    prompt: sharedPrompt(room, authorId),
    deadline: deadlineIn(RATE_PHASE_SEC),
  }
  schedulePhaseEnd(room, RATE_PHASE_SEC * 1000, () => advanceCurrentPhase(room, deps))
  // nobody else connected to rate it — straight to the result
  if (room.pendingActors.size === 0) {
    startRateResult(room, deps)
    return
  }
  deps.onSnapshot(room)
}

function startRateResult(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  const pictureIndex = room.pictureIndex
  const authorId = room.pictureQueue[pictureIndex]
  if (authorId === undefined) throw new Error('internal error: startRateResult called with no current picture')

  const stars = [...(room.ratingsByPictureIndex.get(pictureIndex)?.values() ?? [])]
  const summary = scoreRatings(stars)
  const author = findSeatByPlayerId(room, authorId)
  if (author) author.score += summary.points

  room.phase = {
    phase: 'rateResult',
    round: room.round,
    totalRounds: room.settings.rounds,
    pictureIndex,
    pictureCount: room.pictureQueue.length,
    authorId,
    imagePath: submissionPath(room.code, room.round, authorId),
    prompt: sharedPrompt(room, authorId),
    average: summary.average,
    counts: summary.counts,
    points: summary.points,
    deadline: deadlineIn(RATE_RESULT_PHASE_SEC),
  }
  room.pendingActors = new Set()
  schedulePhaseEnd(room, RATE_RESULT_PHASE_SEC * 1000, () => afterRateResult(room, deps))
  deps.onSnapshot(room)
}

function afterRateResult(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  if (room.pictureIndex + 1 < room.pictureQueue.length) {
    startRate(room, deps)
  } else {
    endRoundOrGame(room, deps)
  }
}

function endRoundOrGame(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  const isFinalRound = room.round >= room.settings.rounds
  const scoreboard = [...room.seats.values()].map((s) => ({ playerId: s.playerId, total: s.score }))
  room.phase = {
    phase: 'scores',
    round: room.round,
    totalRounds: room.settings.rounds,
    isFinalRound,
    scoreboard,
    deadline: isFinalRound ? null : deadlineIn(SCORES_PHASE_SEC),
  }
  room.pendingActors = new Set()
  if (!isFinalRound) {
    schedulePhaseEnd(room, SCORES_PHASE_SEC * 1000, () => startBuild(room, deps))
  }
  deps.onSnapshot(room)
}

// --- action recording (validation lives in the handlers; these just store) ---

export function recordLie(room: Room, pictureIndex: number, authorId: string, text: string): void {
  const map = room.liesByPictureIndex.get(pictureIndex) ?? new Map<string, string>()
  map.set(authorId, text)
  room.liesByPictureIndex.set(pictureIndex, map)
}

export function recordGuess(room: Room, pictureIndex: number, playerId: string, optionId: string): void {
  const map = room.guessesByPictureIndex.get(pictureIndex) ?? new Map<string, string>()
  map.set(playerId, optionId)
  room.guessesByPictureIndex.set(pictureIndex, map)
}

export function recordRating(room: Room, pictureIndex: number, playerId: string, stars: number): void {
  const map = room.ratingsByPictureIndex.get(pictureIndex) ?? new Map<string, number>()
  map.set(playerId, stars)
  room.ratingsByPictureIndex.set(pictureIndex, map)
}

export function existingLieTexts(room: Room, pictureIndex: number): string[] {
  return [...(room.liesByPictureIndex.get(pictureIndex)?.values() ?? [])]
}

export function optionsForPicture(room: Room, pictureIndex: number): PictureOption[] {
  return room.optionsByPictureIndex.get(pictureIndex) ?? []
}
