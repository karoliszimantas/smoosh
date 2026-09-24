import { z } from 'zod'

export const PlayerIdSchema = z.string().min(1)
export const SessionIdSchema = z.string().min(1)

// uppercase, no vowels — avoids accidentally spelling a real word
const ROOM_CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/

export const RoomCodeSchema = z
  .string()
  .length(4)
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(ROOM_CODE_RE))

export type PlayerId = z.infer<typeof PlayerIdSchema>
export type SessionId = z.infer<typeof SessionIdSchema>
export type RoomCode = z.infer<typeof RoomCodeSchema>
