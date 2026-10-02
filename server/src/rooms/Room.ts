import type { GameSettings, PhaseState } from '@smoosh/protocol'
import { DEFAULT_SETTINGS } from '@smoosh/protocol'
import { generateRoomCode } from './roomCode.ts'

export type Seat = {
  sessionId: string
  playerId: string
  name: string
  isHost: boolean
  connected: boolean
  socketId: string | null
  score: number
  joinedAt: number
}

// one option per picture during GUESS/REVEAL: the truth (authorId: null) plus
// one per accepted lie, pre-shuffled once and reused for every player so
// everyone sees the same order
export type PictureOption = { id: string; text: string; authorId: string | null }

export type Room = {
  code: string
  settings: GameSettings
  seats: Map<string, Seat> // keyed by sessionId
  usedPrompts: Set<string>
  phase: PhaseState
  timer: NodeJS.Timeout | null
  pendingActors: Set<string> // playerId — who must still act for the phase to early-advance
  round: number
  pictureQueue: string[] // authorId per submitted picture, this round's presentation order
  pictureIndex: number
  promptByPlayer: Map<string, string> // this round's assignment, playerId -> prompt
  liesByPictureIndex: Map<number, Map<string, string>> // pictureIndex -> authorId -> lie text
  guessesByPictureIndex: Map<number, Map<string, string>> // pictureIndex -> guesserId -> optionId
  optionsByPictureIndex: Map<number, PictureOption[]>
  ratingsByPictureIndex: Map<number, Map<string, number>> // gallery: pictureIndex -> raterId -> stars
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
    pendingActors: new Set(),
    round: 0,
    pictureQueue: [],
    pictureIndex: -1,
    promptByPlayer: new Map(),
    liesByPictureIndex: new Map(),
    guessesByPictureIndex: new Map(),
    optionsByPictureIndex: new Map(),
    ratingsByPictureIndex: new Map(),
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
  if (room?.timer) clearTimeout(room.timer)
  rooms.delete(code)
}

export function allRooms(): IterableIterator<Room> {
  return rooms.values()
}

export function touchRoom(room: Room): void {
  room.lastActivityAt = Date.now()
}

export function findSeatByPlayerId(room: Room, playerId: string): Seat | undefined {
  for (const seat of room.seats.values()) {
    if (seat.playerId === playerId) return seat
  }
  return undefined
}

export function connectedSeats(room: Room): Seat[] {
  return [...room.seats.values()].filter((s) => s.connected)
}
