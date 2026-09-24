import { allRooms, deleteRoom } from './rooms/Room.ts'
import { deleteRoomSubmissions } from './submissions/store.ts'

const SWEEP_INTERVAL_MS = 60_000
const IDLE_TIMEOUT_MS = 20 * 60_000 // games last ~20 minutes; backstop for tabs that die without a clean disconnect

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
