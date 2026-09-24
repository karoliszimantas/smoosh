import { z } from 'zod'
import { RoomCodeSchema } from './ids.ts'
import { GameSettingsSchema } from './settings.ts'
import { RoomSnapshotSchema } from './snapshot.ts'
import { ErrorCodeSchema } from './errors.ts'

const NameSchema = z.string().trim().min(1).max(12)

export const CreateRoomSchema = z.object({ name: NameSchema })
export const JoinRoomSchema = z.object({ roomCode: RoomCodeSchema, name: NameSchema })
export const UpdateSettingsSchema = GameSettingsSchema
export const StartGameSchema = z.object({})
export const PlayAgainSchema = z.object({})
export const SubmitLieSchema = z.object({
  pictureIndex: z.number().int().nonnegative(),
  text: z.string().trim().min(1).max(80),
})
export const SubmitGuessSchema = z.object({
  pictureIndex: z.number().int().nonnegative(),
  optionId: z.string().min(1),
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
  'lie:submit': (payload: z.infer<typeof SubmitLieSchema>, ack: (r: AckResult) => void) => void
  'guess:submit': (payload: z.infer<typeof SubmitGuessSchema>, ack: (r: AckResult) => void) => void
}

export interface ServerToClientEvents {
  'state:sync': (snapshot: z.infer<typeof RoomSnapshotSchema>) => void
}
