import type { RoomSnapshot } from '@smoosh/protocol'

// someone the room is still waiting for — `away` if they're not here now
export type WaitingFor = { id: string; name: string; away: boolean }

// Where the room is with this phase, from the server's own waitingOn and
// presence — no state of its own. `total` counts everyone the phase is
// for (not `exclude`, e.g. the picture's author; nobody who left), minus
// anyone away the room has already stopped waiting on: they aren't
// answering, and counting them as done would be a lie.
export function roomProgress(snapshot: RoomSnapshot, exclude: readonly string[] = []) {
  const waitingOn = new Set(snapshot.waitingOn)
  const inPlay = snapshot.players.filter(
    (p) => p.presence !== 'left' && !exclude.includes(p.id) && (p.presence === 'present' || waitingOn.has(p.id)),
  )
  const waiting: WaitingFor[] = inPlay
    .filter((p) => waitingOn.has(p.id) && p.id !== snapshot.you.playerId)
    .map((p) => ({ id: p.id, name: p.name, away: p.presence === 'away' }))
  const total = inPlay.length
  return { done: total - inPlay.filter((p) => waitingOn.has(p.id)).length, total, waiting }
}
