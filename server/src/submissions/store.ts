const submissions = new Map<string, Buffer>()

function key(roomCode: string, round: number, playerId: string): string {
  return `${roomCode}:${round}:${playerId}`
}

export function putSubmission(roomCode: string, round: number, playerId: string, buffer: Buffer): void {
  submissions.set(key(roomCode, round, playerId), buffer)
}

export function getSubmission(roomCode: string, round: number, playerId: string): Buffer | undefined {
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
