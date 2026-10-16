import type { PictureType } from './imageType.ts'

// the picture, and what its bytes were found to be — it's served as that.
// `blank`: nothing on it (the phone said so, or its pixels did) — kept and
// served like any other, but never put up to be lied about and guessed
export type StoredPicture = { buffer: Buffer; type: PictureType; blank?: boolean }

const submissions = new Map<string, StoredPicture>()

function key(roomCode: string, round: number, playerId: string): string {
  return `${roomCode}:${round}:${playerId}`
}

export function putSubmission(roomCode: string, round: number, playerId: string, picture: StoredPicture): void {
  submissions.set(key(roomCode, round, playerId), picture)
}

export function getSubmission(roomCode: string, round: number, playerId: string): StoredPicture | undefined {
  return submissions.get(key(roomCode, round, playerId))
}

export function hasSubmission(roomCode: string, round: number, playerId: string): boolean {
  return submissions.has(key(roomCode, round, playerId))
}

export function isBlankSubmission(roomCode: string, round: number, playerId: string): boolean {
  return submissions.get(key(roomCode, round, playerId))?.blank === true
}

export function deleteRoomSubmissions(roomCode: string): void {
  const prefix = `${roomCode}:`
  for (const k of submissions.keys()) {
    if (k.startsWith(prefix)) submissions.delete(k)
  }
}

export function submissionPath(roomCode: string, round: number, playerId: string): string {
  return `/submissions/${roomCode}/${round}/${playerId}`
}
