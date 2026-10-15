import type { PictureType } from './imageType.ts'

// the picture, and what its bytes were found to be — it's served as that
export type StoredPicture = { buffer: Buffer; type: PictureType }

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

export function deleteRoomSubmissions(roomCode: string): void {
  const prefix = `${roomCode}:`
  for (const k of submissions.keys()) {
    if (k.startsWith(prefix)) submissions.delete(k)
  }
}

export function submissionPath(roomCode: string, round: number, playerId: string): string {
  return `/submissions/${roomCode}/${round}/${playerId}`
}
