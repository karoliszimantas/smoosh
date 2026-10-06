import {
  AWARDS_HOLD_MS,
  BUILD_GRACE_SEC,
  REVEAL_PHASE_SEC,
  MISSING_PHASE_SEC,
  SCORES_PHASE_SEC,
  EMPTY_BREAKDOWN,
  addToBreakdown,
  announcements,
  awardsTimeline,
  galleryResults,
  runnerUpRequired,
  scorePicture,
  type GameMode,
} from '@smoosh/protocol'
import type { Room, PictureOption, PictureSlot } from '../rooms/Room.ts'
import { presentSeats, findSeatByPlayerId } from '../rooms/Room.ts'
import { submissionPath } from '../submissions/store.ts'
import { assignPrompts } from './promptAssignment.ts'
import { buildEndsAt, openBuildWindows, settleWindows } from './promptSwap.ts'

export type PhaseMachineDeps = {
  // the prompts a game in this mode can be dealt, as of now
  prompts: (mode: GameMode) => readonly string[]
  hasSubmission: (roomCode: string, round: number, playerId: string) => boolean
  onSnapshot: (room: Room) => void
  // [0, 1) — injectable so tests can replay a game from a seed
  random?: () => number
  // console by default; tests pass a quiet one
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
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
  room.phaseEnd = null
}

function clearWindowTimer(room: Room): void {
  if (room.windowTimer) clearTimeout(room.windowTimer)
  room.windowTimer = null
}

function schedulePhaseEnd(room: Room, durationMs: number, onEnd: () => void): void {
  clearRoomTimer(room)
  room.phaseEnd = { at: Date.now() + durationMs, onEnd }
  // nobody is here: a phase that starts now starts with its clock stopped
  if (room.pausedAt !== null) room.pausedAt = Date.now()
  else room.timer = setTimeout(onEnd, durationMs)
}

// Nobody is present: stop the clock, so a room whose every phone dropped at
// once (a whole flat's wifi) doesn't play itself out to the final scores.
export function pausePhaseClock(room: Room): void {
  if (room.pausedAt !== null) return
  room.pausedAt = Date.now()
  if (room.timer) clearTimeout(room.timer)
  room.timer = null
  clearWindowTimer(room)
}

// someone is back: the clock picks up where it stopped, deadline and all
export function resumePhaseClock(room: Room): void {
  if (room.pausedAt === null) return
  const pausedFor = Date.now() - room.pausedAt
  room.pausedAt = null
  const end = room.phaseEnd
  if (!end) return
  end.at += pausedFor
  if ('deadline' in room.phase && typeof room.phase.deadline === 'number') {
    room.phase = { ...room.phase, deadline: room.phase.deadline + pausedFor }
  }
  // every player's prompt window and build clock waited too
  if (room.phase.phase === 'build') {
    if (room.buildStartedAt !== null) room.buildStartedAt += pausedFor
    for (const [id, w] of room.buildWindows) {
      room.buildWindows.set(id, {
        ...w,
        closesAt: w.closesAt + pausedFor,
        startedAt: w.startedAt === null ? null : w.startedAt + pausedFor,
      })
    }
    room.rearmWindows?.()
  }
  room.timer = setTimeout(end.onEnd, Math.max(0, end.at - Date.now()))
}

function deadlineIn(sec: number): number {
  return Date.now() + sec * 1000
}

function currentSlot(room: Room, caller: string): PictureSlot {
  const slot = room.pictureQueue[room.pictureIndex]
  if (!slot) throw new Error(`internal error: ${caller} called with no current picture`)
  return slot
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
    case 'vote':
      startAwards(room, deps)
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
  clearWindowTimer(room)
  room.round += 1
  // a new game: everyone's swaps are back (burned prompts return with
  // usedPrompts, cleared when the game is set up)
  if (room.round === 1) room.swapsUsed.clear()
  room.liesByPictureIndex.clear()
  room.guessesByPictureIndex.clear()
  room.optionsByPictureIndex.clear()
  room.votes.clear()
  room.roundPoints.clear()
  room.pictureQueue = []
  room.pictureIndex = -1

  const seatPlayerIds = [...room.seats.values()].map((s) => s.playerId)
  const availablePool = deps.prompts(room.settings.mode).filter((p) => !room.usedPrompts.has(p))
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

  // Everyone seated, here or not: BUILD only ends early once every picture
  // is in. An away player isn't done — they may be back with one before the
  // deadline, and the room has nothing to move on to meanwhile anyway.
  room.pendingActors = new Set([...room.seats.values()].filter((s) => s.presence !== 'left').map((s) => s.playerId))
  // each player's clock starts when their prompt window closes; the phase
  // closes when the last one runs out
  const now = Date.now()
  room.buildStartedAt = now
  room.swapPool = deps.prompts(room.settings.mode)
  openBuildWindows(room, now)
  room.rearmWindows = () => armWindowTimer(room, deps)
  room.phase = { phase: 'build', round: room.round, totalRounds: room.settings.rounds, deadline: buildEndsAt(room, now), collecting: false }
  rescheduleBuild(room, deps)
  deps.onSnapshot(room)
}

// After any window opens, closes or stretches: settle the ones that have
// run out, and move the phase's close to the last player's deadline.
export function rescheduleBuild(room: Room, deps: PhaseMachineDeps): void {
  if (room.phase.phase !== 'build' || room.phase.collecting) return
  const now = Date.now()
  settleWindows(room, now)
  const deadline = buildEndsAt(room, now)
  room.phase = { ...room.phase, deadline }
  schedulePhaseEnd(room, Math.max(0, deadline - now), () => closeBuild(room, deps))
  armWindowTimer(room, deps)
}

// wake when the next open window runs out, so the room hears about it
function armWindowTimer(room: Room, deps: PhaseMachineDeps): void {
  clearWindowTimer(room)
  if (room.pausedAt !== null || room.phase.phase !== 'build') return
  const open = [...room.buildWindows.values()].filter((w) => w.startedAt === null).map((w) => w.closesAt)
  if (open.length === 0) return
  room.windowTimer = setTimeout(
    () => {
      room.windowTimer = null
      rescheduleBuild(room, deps)
      deps.onSnapshot(room)
    },
    Math.max(0, Math.min(...open) - Date.now()),
  )
}

// the BUILD deadline. A phone that hasn't submitted auto-submits when its own
// timer runs out, so its upload lands just after this — wait a few seconds
// for those (ending sooner if they all arrive) rather than cutting them off
function closeBuild(room: Room, deps: PhaseMachineDeps): void {
  if (room.phase.phase !== 'build') return
  clearWindowTimer(room)
  settleWindows(room, Date.now())
  room.phase = { ...room.phase, collecting: true }
  schedulePhaseEnd(room, BUILD_GRACE_SEC * 1000, () => endBuild(room, deps))
  deps.onSnapshot(room)
}

function endBuild(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  clearWindowTimer(room)
  // a window still open (everyone submitted early) settles on its prompt
  settleWindows(room, Number.POSITIVE_INFINITY)
  room.rearmWindows = null
  // every player gets a slot, picture or not, so nobody can be skipped
  // silently: a missing picture comes up as a placeholder everyone sees.
  // Except someone who chose to leave — their absence is no news, unless
  // they'd already sent a picture in.
  room.pictureQueue = shuffle([...room.seats.values()], deps.random)
    .map((seat) => ({
      authorId: seat.playerId,
      hasPicture: deps.hasSubmission(room.code, room.round, seat.playerId),
      left: seat.presence === 'left',
    }))
    .filter((slot) => slot.hasPicture || !slot.left)
    .map(({ authorId, hasPicture }) => ({ authorId, hasPicture }))
  room.pictureIndex = -1
  room.shownThisRound = []

  // nobody submitted anything — a row of placeholders would tell no one
  // anything new
  if (!room.pictureQueue.some((slot) => slot.hasPicture)) {
    endRoundOrGame(room, deps)
    return
  }
  if (room.settings.mode === 'gallery') startVote(room, deps)
  else nextPicture(room, deps)
}

// on to the next slot in the order, or the round's end after the last one
function nextPicture(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  room.pictureIndex += 1
  const slot = room.pictureQueue[room.pictureIndex]
  if (!slot) {
    endRoundOrGame(room, deps)
    return
  }
  if (!slot.hasPicture) startMissing(room, deps, slot.authorId)
  else startLie(room, deps, slot.authorId)
}

function startMissing(room: Room, deps: PhaseMachineDeps, authorId: string): void {
  room.pendingActors = new Set()
  room.phase = {
    phase: 'missing',
    round: room.round,
    totalRounds: room.settings.rounds,
    pictureIndex: room.pictureIndex,
    pictureCount: room.pictureQueue.length,
    authorId,
    deadline: deadlineIn(MISSING_PHASE_SEC),
  }
  schedulePhaseEnd(room, MISSING_PHASE_SEC * 1000, () => nextPicture(room, deps))
  deps.onSnapshot(room)
}

function startLie(room: Room, deps: PhaseMachineDeps, authorId: string): void {
  room.shownThisRound.push(authorId)
  room.pendingActors = new Set(presentSeats(room).map((s) => s.playerId).filter((id) => id !== authorId))
  const deadline = deadlineIn(room.settings.answerTimeSec)
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
  schedulePhaseEnd(room, room.settings.answerTimeSec * 1000, () => advanceCurrentPhase(room, deps))
  deps.onSnapshot(room)
}

function startGuess(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  const pictureIndex = room.pictureIndex
  const { authorId } = currentSlot(room, 'startGuess')
  const truth = room.promptByPlayer.get(authorId)
  if (truth === undefined) throw new Error('internal error: no prompt recorded for picture author')

  const liesMap = room.liesByPictureIndex.get(pictureIndex) ?? new Map<string, string>()
  const lieOptions: PictureOption[] = [...liesMap.entries()].map(([lieAuthorId, text]) => ({
    id: crypto.randomUUID(),
    text,
    authorId: lieAuthorId,
  }))
  const truthOption: PictureOption = { id: crypto.randomUUID(), text: truth, authorId: null }
  const options = shuffle([truthOption, ...lieOptions], deps.random)
  room.optionsByPictureIndex.set(pictureIndex, options)

  room.pendingActors = new Set(presentSeats(room).map((s) => s.playerId).filter((id) => id !== authorId))
  const deadline = deadlineIn(room.settings.answerTimeSec)
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
  schedulePhaseEnd(room, room.settings.answerTimeSec * 1000, () => advanceCurrentPhase(room, deps))
  deps.onSnapshot(room)
}

function startReveal(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  const pictureIndex = room.pictureIndex
  const { authorId } = currentSlot(room, 'startReveal')
  const options = room.optionsByPictureIndex.get(pictureIndex) ?? []
  const truthOption = options.find((o) => o.authorId === null)
  if (!truthOption) throw new Error('internal error: no truth option recorded for picture')

  const guessesMap = room.guessesByPictureIndex.get(pictureIndex) ?? new Map<string, string>()
  const guesses = [...guessesMap.entries()].map(([playerId, optionId]) => ({ playerId, optionId }))
  const lies = options
    .filter((o): o is PictureOption & { authorId: string } => o.authorId !== null)
    .map((o) => ({ optionId: o.id, authorId: o.authorId }))

  // scored at the size of the table this round was dealt to — everyone with
  // a slot in the picture order, so the values hold still for the round
  const deltas = scorePicture({ players: room.pictureQueue.length, authorId, truthOptionId: truthOption.id, lies, guesses })
  const totals = new Map<string, number>()
  for (const delta of deltas) {
    const seat = findSeatByPlayerId(room, delta.playerId)
    if (seat) seat.score += delta.points
    totals.set(delta.playerId, (totals.get(delta.playerId) ?? 0) + delta.points)
    room.roundPoints.set(delta.playerId, addToBreakdown(room.roundPoints.get(delta.playerId) ?? EMPTY_BREAKDOWN, delta))
    room.gamePoints.set(delta.playerId, addToBreakdown(room.gamePoints.get(delta.playerId) ?? EMPTY_BREAKDOWN, delta))
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
  schedulePhaseEnd(room, REVEAL_PHASE_SEC * 1000, () => nextPicture(room, deps))
  deps.onSnapshot(room)
}

// ---------- gallery: everyone votes on the whole round, then the awards

// the prompt everyone built to this round ("" in freestyle) — the same for
// every player in gallery, so any seat's assignment is the one
function sharedPrompt(room: Room): string {
  return [...room.promptByPlayer.values()][0] ?? ''
}

// the round's pictures someone other than `voterId` made
export function votablePictures(room: Room, voterId: string): string[] {
  return room.pictureQueue.filter((s) => s.hasPicture && s.authorId !== voterId).map((s) => s.authorId)
}

function startVote(room: Room, deps: PhaseMachineDeps): void {
  for (const slot of room.pictureQueue) if (slot.hasPicture) room.shownThisRound.push(slot.authorId)
  // everyone here with something to vote for — a lone picture's author has
  // nothing to choose between
  room.pendingActors = new Set(
    presentSeats(room)
      .map((s) => s.playerId)
      .filter((id) => votablePictures(room, id).length > 0),
  )
  room.phase = {
    phase: 'vote',
    round: room.round,
    totalRounds: room.settings.rounds,
    prompt: sharedPrompt(room),
    pictures: room.pictureQueue.map((slot) => ({
      authorId: slot.authorId,
      imagePath: slot.hasPicture ? submissionPath(room.code, room.round, slot.authorId) : null,
    })),
    deadline: deadlineIn(room.settings.answerTimeSec),
  }
  if (room.pendingActors.size === 0) {
    startAwards(room, deps)
    return
  }
  schedulePhaseEnd(room, room.settings.answerTimeSec * 1000, () => advanceCurrentPhase(room, deps))
  deps.onSnapshot(room)
}

// null when the vote is fine; otherwise why not, in a sentence
export function voteProblem(room: Room, voterId: string, favourite: string, runnerUp: string | null): string | null {
  const votable = votablePictures(room, voterId)
  if (favourite === voterId || runnerUp === voterId) return 'you cannot vote for your own picture'
  if (!votable.includes(favourite)) return 'that picture is not up for a vote'
  if (runnerUp !== null && !votable.includes(runnerUp)) return 'that picture is not up for a vote'
  if (runnerUp === favourite) return 'your runner-up has to be a different picture'
  if (runnerUp === null && runnerUpRequired(votable.length)) return 'pick a runner-up too'
  return null
}

function startAwards(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  const authors = room.pictureQueue.filter((s) => s.hasPicture).map((s) => s.authorId)
  const votes = [...room.votes.entries()].map(([voterId, v]) => ({ voterId, ...v }))
  const results = galleryResults(authors, votes)
  for (const r of results) {
    const seat = findSeatByPlayerId(room, r.authorId)
    if (seat) seat.score += r.points
  }
  const prompt = sharedPrompt(room)
  for (const r of results) {
    if (r.award === 'best') {
      room.exhibition.push({
        round: room.round,
        prompt,
        authorId: r.authorId,
        imagePath: submissionPath(room.code, room.round, r.authorId),
      })
    }
  }

  const order = announcements(results)
  const { totalMs } = awardsTimeline(order)
  const startsAt = Date.now()
  room.phase = {
    phase: 'awards',
    round: room.round,
    totalRounds: room.settings.rounds,
    prompt,
    pictures: results.map((r) => ({ ...r, imagePath: submissionPath(room.code, room.round, r.authorId) })),
    announcements: order,
    startsAt,
    skipped: false,
    deadline: startsAt + totalMs,
  }
  room.pendingActors = new Set()
  schedulePhaseEnd(room, totalMs, () => endRoundOrGame(room, deps))
  deps.onSnapshot(room)
}

// the host's tap: every phone cuts to the full wall, which holds a moment
// so the result is still seen
export function skipAwards(room: Room, deps: PhaseMachineDeps): void {
  if (room.phase.phase !== 'awards' || room.phase.skipped) return
  room.phase = { ...room.phase, skipped: true, deadline: Date.now() + AWARDS_HOLD_MS }
  schedulePhaseEnd(room, AWARDS_HOLD_MS, () => endRoundOrGame(room, deps))
  deps.onSnapshot(room)
}

// ---------- end of round: report what happened, and check nobody was lost

export type RoundAudit = {
  players: number
  submitted: string[] // players whose picture the server holds for the round
  shown: string[] // authors whose picture was presented, in order
  placeholders: string[] // players shown as "picture missing"
}

export function auditRound(room: Room, deps: PhaseMachineDeps): RoundAudit {
  return {
    players: room.seats.size,
    submitted: [...room.seats.values()]
      .map((s) => s.playerId)
      .filter((id) => deps.hasSubmission(room.code, room.round, id)),
    shown: [...room.shownThisRound],
    placeholders: room.pictureQueue.filter((slot) => !slot.hasPicture).map((slot) => slot.authorId),
  }
}

// null when every submitted picture was shown exactly once and nothing else was
export function roundAuditProblem(audit: RoundAudit): string | null {
  const problems: string[] = []
  const shown = new Set(audit.shown)
  if (shown.size !== audit.shown.length) problems.push('a picture was shown more than once')
  const notShown = audit.submitted.filter((id) => !shown.has(id))
  if (notShown.length > 0) problems.push(`submitted but never shown: ${notShown.join(', ')}`)
  const submitted = new Set(audit.submitted)
  const notSubmitted = audit.shown.filter((id) => !submitted.has(id))
  if (notSubmitted.length > 0) problems.push(`shown without a submission: ${notSubmitted.join(', ')}`)
  return problems.length > 0 ? problems.join('; ') : null
}

function reportRound(room: Room, deps: PhaseMachineDeps): void {
  const log = deps.log ?? console
  const audit = auditRound(room, deps)
  log.info(
    `[round] ${room.code} round ${room.round}: ${audit.players} players, ${audit.submitted.length} submitted, ` +
      `${audit.shown.length} shown, ${audit.placeholders.length} missing`,
  )
  if (process.env.NODE_ENV === 'production') return
  const problem = roundAuditProblem(audit)
  if (problem) {
    log.error(`[round] !!! INVARIANT BROKEN in ${room.code} round ${room.round}: ${problem}`, {
      submitted: audit.submitted,
      shown: audit.shown,
    })
  }
}

function endRoundOrGame(room: Room, deps: PhaseMachineDeps): void {
  clearRoomTimer(room)
  reportRound(room, deps)
  const isFinalRound = room.round >= room.settings.rounds
  const guess = room.settings.mode === 'guess'
  const scoreboard = [...room.seats.values()].map((s) => ({
    playerId: s.playerId,
    total: s.score,
    round: guess ? (room.roundPoints.get(s.playerId) ?? EMPTY_BREAKDOWN) : null,
    game: guess ? (room.gamePoints.get(s.playerId) ?? EMPTY_BREAKDOWN) : null,
  }))
  room.phase = {
    phase: 'scores',
    round: room.round,
    totalRounds: room.settings.rounds,
    isFinalRound,
    scoreboard,
    exhibition: [...room.exhibition],
    deadline: isFinalRound ? null : deadlineIn(SCORES_PHASE_SEC),
  }
  room.pendingActors = new Set()
  if (!isFinalRound) {
    schedulePhaseEnd(room, SCORES_PHASE_SEC * 1000, () => startBuild(room, deps))
  }
  deps.onSnapshot(room)
}

// too_late: that round's BUILD (grace window included) has closed and its
// pictures are already being shown. wrong_phase: some other round entirely.
export type SubmissionRejection = 'too_late' | 'wrong_phase'
export type SubmissionResult = { ok: true } | { ok: false; reason: SubmissionRejection }

export function submissionRejection(room: Room, round: number): SubmissionRejection | null {
  if (room.phase.phase === 'build' && room.phase.round === round) return null
  return round === room.round ? 'too_late' : 'wrong_phase'
}

// a BUILD upload has arrived (the HTTP layer has already checked who sent
// it). `save` stores the picture; it only runs if the upload is accepted —
// a rejected one is reported back, never dropped quietly.
export function acceptSubmission(
  room: Room,
  deps: PhaseMachineDeps,
  playerId: string,
  round: number,
  save: () => void,
): SubmissionResult {
  const rejection = submissionRejection(room, round)
  if (rejection) {
    const log = deps.log ?? console
    log.warn(`[build] ${room.code} round ${round}: rejected upload from ${playerId} (${rejection})`)
    return { ok: false, reason: rejection }
  }
  save()
  dropPendingActor(room, deps, playerId)
  deps.onSnapshot(room)
  return { ok: true }
}

// a player reconnecting mid-phase who hasn't acted yet is waited for again —
// the disconnect dropped them from pendingActors, and without this their
// answer would be refused as ALREADY_ACTED
export function restorePendingActor(room: Room, deps: PhaseMachineDeps, playerId: string): void {
  const phase = room.phase
  let acted: boolean
  switch (phase.phase) {
    case 'build':
      acted = deps.hasSubmission(room.code, room.round, playerId)
      break
    case 'lie':
      acted = phase.authorId === playerId || (room.liesByPictureIndex.get(phase.pictureIndex)?.has(playerId) ?? false)
      break
    case 'guess':
      acted =
        phase.authorId === playerId || (room.guessesByPictureIndex.get(phase.pictureIndex)?.has(playerId) ?? false)
      break
    case 'vote':
      acted = room.votes.has(playerId) || votablePictures(room, playerId).length === 0
      break
    default:
      return
  }
  if (!acted) room.pendingActors.add(playerId)
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

export function recordVote(room: Room, voterId: string, favourite: string, runnerUp: string | null): void {
  room.votes.set(voterId, { favourite, runnerUp })
}

export function existingLieTexts(room: Room, pictureIndex: number): string[] {
  return [...(room.liesByPictureIndex.get(pictureIndex)?.values() ?? [])]
}

export function optionsForPicture(room: Room, pictureIndex: number): PictureOption[] {
  return room.optionsByPictureIndex.get(pictureIndex) ?? []
}
