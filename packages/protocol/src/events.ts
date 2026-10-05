import { z } from 'zod'
import { RoomCodeSchema } from './ids.ts'
import { GameSettingsSchema, MIN_RATING, MAX_RATING } from './settings.ts'
import { RoomSnapshotSchema } from './snapshot.ts'
import { ErrorCodeSchema } from './errors.ts'
import type { RoomEvent } from './roomEvents.ts'

const NameSchema = z.string().trim().min(1).max(12)

export const CreateRoomSchema = z.object({ name: NameSchema })
export const JoinRoomSchema = z.object({ roomCode: RoomCodeSchema, name: NameSchema })
export const UpdateSettingsSchema = GameSettingsSchema
export const StartGameSchema = z.object({})
export const PlayAgainSchema = z.object({})
// the room code too: a leave sent over a socket that has only just
// (re)connected still finds the room it means
export const LeaveRoomSchema = z.object({ roomCode: RoomCodeSchema.optional() })
export const AwaySchema = z.object({})
export const SubmitLieSchema = z.object({
  pictureIndex: z.number().int().nonnegative(),
  text: z.string().trim().min(1).max(80),
})
export const SubmitGuessSchema = z.object({
  pictureIndex: z.number().int().nonnegative(),
  optionId: z.string().min(1),
})

export const SubmitRatingSchema = z.object({
  pictureIndex: z.number().int().nonnegative(),
  stars: z.number().int().min(MIN_RATING).max(MAX_RATING),
})

// handshake `auth` payload, validated in an io.use middleware before any
// event handler runs
export const HandshakeAuthSchema = z.object({ sessionId: z.string().min(1) })

export type AckResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: z.infer<typeof ErrorCodeSchema>; message: string }

export interface ClientToServerEvents {
  'room:create': (payload: z.infer<typeof CreateRoomSchema>, ack: (r: AckResult<{ roomCode: string }>) => void) => void
  'room:join': (payload: z.infer<typeof JoinRoomSchema>, ack: (r: AckResult) => void) => void
  'room:updateSettings': (payload: z.infer<typeof UpdateSettingsSchema>, ack: (r: AckResult) => void) => void
  'room:start': (payload: z.infer<typeof StartGameSchema>, ack: (r: AckResult) => void) => void
  'room:playAgain': (payload: z.infer<typeof PlayAgainSchema>, ack: (r: AckResult) => void) => void
  // deliberately leaving — the one thing that frees a seat mid-game
  'room:leave': (payload: z.infer<typeof LeaveRoomSchema>, ack: (r: AckResult) => void) => void
  // the page went to the background: away now, without waiting for the
  // socket to time out. Coming back is a room:join.
  'presence:away': (payload: z.infer<typeof AwaySchema>, ack: (r: AckResult) => void) => void
  'lie:submit': (payload: z.infer<typeof SubmitLieSchema>, ack: (r: AckResult) => void) => void
  'guess:submit': (payload: z.infer<typeof SubmitGuessSchema>, ack: (r: AckResult) => void) => void
  'rating:submit': (payload: z.infer<typeof SubmitRatingSchema>, ack: (r: AckResult) => void) => void
}

export interface ServerToClientEvents {
  'state:sync': (snapshot: z.infer<typeof RoomSnapshotSchema>) => void
  'room:event': (event: RoomEvent) => void
}
