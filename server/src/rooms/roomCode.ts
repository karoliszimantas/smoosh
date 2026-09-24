// matches packages/protocol/src/ids.ts's RoomCodeSchema regex exactly —
// uppercase consonants only, so a code never accidentally spells a word
const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXZ'

function randomCode(): string {
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += CONSONANTS[Math.floor(Math.random() * CONSONANTS.length)]
  }
  return code
}

export function generateRoomCode(isTaken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const code = randomCode()
    if (!isTaken(code)) return code
  }
  throw new Error('failed to generate a unique room code after 100 attempts')
}
