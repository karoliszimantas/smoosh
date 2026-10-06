import { PROMPT_CHOICE_SEC, PROMPT_WINDOW_SEC, swapAllowance } from '@smoosh/protocol'
import type { Room } from '../rooms/Room.ts'

// Each player's start of BUILD, in Guess: a short window showing their
// prompt, with one chance to swap it, before their own build clock starts.
// Their clock starts when the window closes — they decide, tap to start,
// or it runs out — so one player's slow choice never moves anyone else's.
//
// Plain functions over room state, so it's all testable without sockets.
// A window that has run out is settled lazily (settleWindows) rather than
// on a timer per player; buildEndsAt reads windows as settled.

export type BuildWindow = {
  // the window ends here (pushed back once, by a swap)
  closesAt: number
  // when this player's build clock started — null while the window is open
  startedAt: number | null
  // what a swap brought up, while they choose; null before any swap
  offered: string | null
}

// the swap-free start everyone gets in Gallery, or when they're away as
// BUILD begins: the clock runs from the start of the phase
function closedAt(now: number): BuildWindow {
  return { closesAt: now, startedAt: now, offered: null }
}

// at the start of BUILD: a window for everyone here in Guess. Anyone away
// gets no swap and spends none — they come back to the prompt they were dealt
export function openBuildWindows(room: Room, now: number): void {
  room.buildWindows = new Map()
  for (const seat of room.seats.values()) {
    const window =
      room.settings.mode === 'guess' && seat.presence === 'present'
        ? { closesAt: now + PROMPT_WINDOW_SEC * 1000, startedAt: null, offered: null }
        : closedAt(now)
    room.buildWindows.set(seat.playerId, window)
  }
}

// a window as it stands at `now` — run out means closed, its clock started
// when it ended, and a choice not made means the swapped-in prompt (they
// swapped because they couldn't picture the first)
function settled(w: BuildWindow, now: number): BuildWindow & { keepOffered: boolean } {
  if (w.startedAt !== null || now < w.closesAt) return { ...w, keepOffered: false }
  return { closesAt: w.closesAt, startedAt: w.closesAt, offered: null, keepOffered: w.offered !== null }
}

export function settleWindows(room: Room, now: number): void {
  for (const [playerId, w] of room.buildWindows) {
    const s = settled(w, now)
    if (s.startedAt === w.startedAt) continue
    if (s.keepOffered && w.offered) room.promptByPlayer.set(playerId, w.offered)
    room.buildWindows.set(playerId, { closesAt: s.closesAt, startedAt: s.startedAt, offered: null })
  }
}

// the window, read without changing anything — for snapshots
export function windowView(room: Room, playerId: string, now: number): BuildWindow | null {
  const w = room.buildWindows.get(playerId)
  return w ? settled(w, now) : null
}

// when this player's build ends: their clock's start (or, while their
// window is open, the latest it can start) plus the build time
export function personalDeadline(room: Room, playerId: string, now: number): number {
  const buildMs = room.settings.buildTimeSec * 1000
  const w = windowView(room, playerId, now)
  if (!w) return (room.buildStartedAt ?? now) + buildMs
  return (w.startedAt ?? w.closesAt) + buildMs
}

// the phase closes when the last clock runs out
export function buildEndsAt(room: Room, now: number): number {
  let end = (room.buildStartedAt ?? now) + room.settings.buildTimeSec * 1000
  for (const seat of room.seats.values()) {
    if (seat.presence === 'left') continue
    end = Math.max(end, personalDeadline(room, seat.playerId, now))
  }
  return end
}

export function swapsLeft(room: Room, playerId: string): number {
  return Math.max(0, swapAllowance(room.settings.rounds) - (room.swapsUsed.get(playerId) ?? 0))
}

// Prompts a swap may draw from: the game's pool, minus everything dealt or
// burned this game — which includes every prompt held this round.
function swapCandidates(room: Room, pool: readonly string[]): string[] {
  return pool.filter((p) => !room.usedPrompts.has(p))
}

// A swap is only offered when the pool can spare a prompt and still deal
// every later round in full — swaps must never leave a round short.
export function poolCanSpare(room: Room, pool: readonly string[]): boolean {
  const seated = [...room.seats.values()].filter((s) => s.presence !== 'left').length
  const stillNeeded = Math.max(0, room.settings.rounds - room.round) * seated
  return swapCandidates(room, pool).length - 1 >= stillNeeded
}

// null when this player may swap now; otherwise why not
export function swapProblem(room: Room, playerId: string, now: number, pool: readonly string[]): string | null {
  if (room.phase.phase !== 'build' || room.settings.mode !== 'guess') return 'no swapping now'
  const w = windowView(room, playerId, now)
  if (!w || w.startedAt !== null) return 'too late to swap — your build has started'
  if (w.offered !== null) return 'one swap a round'
  if (swapsLeft(room, playerId) === 0) return 'no swaps left this game'
  if (!poolCanSpare(room, pool)) return 'no prompts to spare'
  return null
}

// Deals a second prompt alongside the first. Both are burned for the rest
// of the game whichever is kept — a player who has seen two mustn't meet
// the other later as someone's real prompt. The allowance pays for the look.
export function swapPrompt(room: Room, playerId: string, now: number, pool: readonly string[], random = Math.random): string {
  const problem = swapProblem(room, playerId, now, pool)
  if (problem) throw new Error(problem)
  const candidates = swapCandidates(room, pool)
  const offered = candidates[Math.floor(random() * candidates.length)]
  if (offered === undefined) throw new Error('no prompts to spare')
  room.usedPrompts.add(offered)
  room.swapsUsed.set(playerId, (room.swapsUsed.get(playerId) ?? 0) + 1)
  const w = room.buildWindows.get(playerId)
  if (w) room.buildWindows.set(playerId, { ...w, offered, closesAt: Math.max(w.closesAt, now + PROMPT_CHOICE_SEC * 1000) })
  return offered
}

// The window closes now: keep the first prompt or the swapped-in one, and
// the build clock starts. Without a swap there's nothing to choose — this
// is "start building".
export function closeWindow(room: Room, playerId: string, now: number, keep: 'original' | 'swapped' = 'swapped'): void {
  const w = room.buildWindows.get(playerId)
  if (!w || w.startedAt !== null || now >= w.closesAt) return
  if (w.offered !== null && keep === 'swapped') room.promptByPlayer.set(playerId, w.offered)
  room.buildWindows.set(playerId, { closesAt: w.closesAt, startedAt: now, offered: null })
}

// the prompt a player is building to right now — a choice that ran out
// unmade has already become the swapped-in one, settled or not
export function effectivePrompt(room: Room, playerId: string, now: number): string | undefined {
  const w = room.buildWindows.get(playerId)
  if (w && w.startedAt === null && now >= w.closesAt && w.offered !== null) return w.offered
  return room.promptByPlayer.get(playerId)
}
