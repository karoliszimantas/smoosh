import type { ErrorCode, RoomEvent } from '@smoosh/protocol'

// What the player reads about comings and goings — plain words, never an
// error code. Kept apart from the components so the wording is easy to find
// and test.

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`
}

// a room event as a short notice; null for events shown some other way
export function roomEventText(event: RoomEvent, youId: string | null): string | null {
  switch (event.type) {
    case 'left':
      return `${event.name} left the game.`
    case 'hostChanged':
      return event.playerId === youId ? 'You’re the host now.' : `${event.name} is the host now.`
    case 'caughtUp': {
      const missed: string[] = []
      if (event.roundsFinished > 0) missed.push(`${plural(event.roundsFinished, 'a round', 'rounds')} finished`)
      else if (event.picturesMissed > 0) missed.push(`${plural(event.picturesMissed, 'a picture', 'pictures')} went by`)
      const gained = event.pointsGained > 0 ? ` (+${event.pointsGained})` : ''
      return `While you were away, ${missed.join(', ')}. You’re ${ordinal(event.rank)} of ${event.playerCount}${gained}.`
    }
    case 'replaced':
      return null
  }
}

// why a stored game couldn't be picked back up
export function rejoinFailedText(roomCode: string, code: ErrorCode): string {
  switch (code) {
    case 'ROOM_NOT_FOUND':
      return `Game ${roomCode} has finished. Start a new one, or join another.`
    case 'ALREADY_STARTED':
      return `Game ${roomCode} is already under way, and this device isn’t in it.`
    default:
      return `Couldn’t get you back into game ${roomCode}.`
  }
}

export function leftText(roomCode: string): string {
  return `You left game ${roomCode}. You can rejoin with the code.`
}

// why typing a code in didn't get them into a game
export function joinFailedText(roomCode: string, code: ErrorCode): string {
  switch (code) {
    case 'ROOM_NOT_FOUND':
      return `There’s no game with the code ${roomCode}. Check the code?`
    case 'ALREADY_STARTED':
      return `Game ${roomCode} has already started.`
    case 'ROOM_FULL':
      return `Game ${roomCode} is full.`
    default:
      return 'Couldn’t join that game. Try again?'
  }
}

// One step, saying what happens to everyone else — that's the question in
// the player's head, not what happens to them.
export function leaveDialogText(opts: { roomCode: string; isLobby: boolean; isHost: boolean }): {
  title: string
  body: string
} {
  const host = opts.isHost ? ' Someone else will become the host.' : ''
  if (opts.isLobby) {
    return {
      title: 'Leave this room?',
      body: `The others can still start without you.${host} You can join again with the code ${opts.roomCode}.`,
    }
  }
  return {
    title: 'Leave the game?',
    body: `The others will keep playing without you.${host} You can rejoin with the room code ${opts.roomCode}.`,
  }
}
