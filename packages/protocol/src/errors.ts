import { z } from 'zod'

export const ErrorCodeSchema = z.enum([
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ALREADY_STARTED',
  'NOT_HOST',
  'NOT_ENOUGH_PLAYERS',
  'INVALID_SETTINGS',
  'PHASE_MISMATCH',
  'LIE_MATCHES_TRUTH',
  'LIE_DUPLICATE',
  'CANNOT_PICK_OWN',
  'ALREADY_ACTED',
  'INVALID_PAYLOAD',
])
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

export class GameError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'GameError'
    this.code = code
  }
}
