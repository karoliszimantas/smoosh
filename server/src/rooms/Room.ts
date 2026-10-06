import type { GameSettings, PhaseState, PointsBreakdown, Presence } from '@smoosh/protocol'
import { DEFAULT_SETTINGS } from '@smoosh/protocol'
import { generateRoomCode } from './roomCode.ts'

// A player is their seat, not their socket: sockets come and go (reloads,
// lost signal, a phone in a pocket) and attach to the seat they belong to.
export type Seat = {
  // the player's secret reconnect credential — never sent to anyone
  sessionId: string
  playerId: string
  name: string
  isHost: boolean
  presence: Presence
  socketId: string | null
  score: number
  joinedAt: number
  // when this seat last became present — "longest present" picks the host
  presentSince: number
  // where the game was when this seat went away, to tell them what they
  // missed when they're back
  awayFrom: { round: number; pictureIndex: number; phase: PhaseState['phase']; score: number } | null
}

// one option per picture during GUESS/REVEAL: the truth (authorId: null) plus
// one per accepted lie, pre-shuffled once and reused for every player so
// everyone sees the same order
export type PictureOption = { id: string; text: string; authorId: string | null }

// one slot per player in a round's presentation order. Built once when BUILD
// closes and consumed by index — never spliced — so every player's picture
// comes up exactly once; `hasPicture: false` slots show a placeholder.
export type PictureSlot = { authorId: string; hasPicture: boolean }

export type Room = {
  code: string
  settings: GameSettings
  seats: Map<string, Seat> // keyed by playerId
  usedPrompts: Set<string>
  phase: PhaseState
  timer: NodeJS.Timeout | null
  // the running phase's end, kept so the clock can stop while nobody is here
  phaseEnd: { at: number; onEnd: () => void } | null
  // set while nobody is present: the phase clock is stopped from this moment
  pausedAt: number | null
  // nobody present: the room is disposed when this fires
  emptyTimer: NodeJS.Timeout | null
  // the host has been away a while: the role moves on when this fires
  hostTimer: NodeJS.Timeout | null
  // lobby only: an away player's seat is released when theirs fires
  lobbyReleaseTimers: Map<string, NodeJS.Timeout>
  pendingActors: Set<string> // playerId — who must still act for the phase to early-advance
  round: number
  pictureQueue: PictureSlot[] // this round's presentation order, one slot per player
  shownThisRound: string[] // authors whose picture was actually put in front of the others
  pictureIndex: number
  promptByPlayer: Map<string, string> // this round's assignment, playerId -> prompt
  liesByPictureIndex: Map<number, Map<string, string>> // pictureIndex -> authorId -> lie text
  guessesByPictureIndex: Map<number, Map<string, string>> // pictureIndex -> guesserId -> optionId
  optionsByPictureIndex: Map<number, PictureOption[]>
  // gallery: this round's votes, voterId -> picks. Never sent to anyone but
  // the voter themselves — only counts leave the server
  votes: Map<string, { favourite: string; runnerUp: string | null }>
  // gallery: every round's Best in Show so far, for the final exhibition
  exhibition: { round: number; prompt: string; authorId: string; imagePath: string }[]
  // guess: each player's points by source — this round, and the game so far
  roundPoints: Map<string, PointsBreakdown>
  gamePoints: Map<string, PointsBreakdown>
  lastActivityAt: number
}

export function createRoom(code: string): Room {
  return {
    code,
    settings: DEFAULT_SETTINGS,
    seats: new Map(),
    usedPrompts: new Set(),
    phase: { phase: 'lobby' },
    timer: null,
    phaseEnd: null,
    pausedAt: null,
    emptyTimer: null,
    hostTimer: null,
    lobbyReleaseTimers: new Map(),
    pendingActors: new Set(),
    round: 0,
    pictureQueue: [],
    shownThisRound: [],
    pictureIndex: -1,
    promptByPlayer: new Map(),
    liesByPictureIndex: new Map(),
    guessesByPictureIndex: new Map(),
    optionsByPictureIndex: new Map(),
    votes: new Map(),
    exhibition: [],
    roundPoints: new Map(),
    gamePoints: new Map(),
    lastActivityAt: Date.now(),
  }
}

const rooms = new Map<string, Room>()

export function getRoom(code: string): Room | undefined {
  return rooms.get(code)
}

export function createAndRegisterRoom(): Room {
  const code = generateRoomCode((c) => rooms.has(c))
  const room = createRoom(code)
  rooms.set(code, room)
  return room
}

export function deleteRoom(code: string): void {
  const room = rooms.get(code)
  if (room) clearRoomTimers(room)
  rooms.delete(code)
}

export function clearRoomTimers(room: Room): void {
  for (const t of [room.timer, room.emptyTimer, room.hostTimer]) if (t) clearTimeout(t)
  room.timer = null
  room.emptyTimer = null
  room.hostTimer = null
  for (const t of room.lobbyReleaseTimers.values()) clearTimeout(t)
  room.lobbyReleaseTimers.clear()
}

export function allRooms(): IterableIterator<Room> {
  return rooms.values()
}

export function touchRoom(room: Room): void {
  room.lastActivityAt = Date.now()
}

export function findSeatByPlayerId(room: Room, playerId: string): Seat | undefined {
  return room.seats.get(playerId)
}

export function findSeatBySession(room: Room, sessionId: string): Seat | undefined {
  for (const seat of room.seats.values()) {
    if (seat.sessionId === sessionId) return seat
  }
  return undefined
}

export function presentSeats(room: Room): Seat[] {
  return [...room.seats.values()].filter((s) => s.presence === 'present')
}
