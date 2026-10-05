import { allRooms, deleteRoom } from './rooms/Room.ts'
import { deleteRoomSubmissions } from './submissions/store.ts'

const SWEEP_INTERVAL_MS = 60_000
// A backstop only: rooms nobody is in are disposed by presence.ts after
// EMPTY_ROOM_HOLD_MS. This catches a room people are still connected to but
// have stopped using (a final scoreboard left open on a phone overnight) —
// long enough that no game in progress is ever reaped.
const IDLE_TIMEOUT_MS = 3 * 60 * 60_000

export function startIdleReaper(): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now()
    for (const room of allRooms()) {
      if (now - room.lastActivityAt > IDLE_TIMEOUT_MS) {
        deleteRoomSubmissions(room.code)
        deleteRoom(room.code)
      }
    }
  }, SWEEP_INTERVAL_MS)
}
