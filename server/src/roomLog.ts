import type { Room, Seat } from './rooms/Room.ts'

// One line per thing that changes what a player can do — joins, rejoins,
// going away, a tab taking the seat over, refused actions, phase changes
// and who the room is waiting on — prefixed with the room code, so one
// game's story is `journalctl -u smoosh | grep '\[room ABCD\]'`. Names are
// the throwaway ones typed at the door; nothing else about anyone.

export function roomLog(code: string, message: string): void {
  console.log(`[room ${code}] ${message}`)
}

export function who(seat: Seat | undefined): string {
  return seat ? `${seat.name} (${seat.playerId.slice(0, 8)})` : 'unknown seat'
}

// "lie, round 2, picture 3/4" — where the room is
export function phaseLabel(room: Room): string {
  const p = room.phase
  const at = 'pictureIndex' in p && 'pictureCount' in p ? `, picture ${p.pictureIndex + 1}/${p.pictureCount}` : ''
  const unit = p.phase === 'pass' ? `, pass ${p.pass + 1}` : ''
  return p.phase === 'lobby' ? 'lobby' : `${p.phase}, round ${room.round}${at}${unit}`
}

export function waitingLabel(room: Room): string {
  const names = [...room.pendingActors].map((id) => room.seats.get(id)?.name ?? id.slice(0, 8))
  return names.length === 0 ? 'waiting on nobody' : `waiting on ${names.length}: ${names.join(', ')}`
}

// logged when the room's phase (or picture, or pass) is a new one
const lastLogged = new WeakMap<Room, string>()
export function logPhaseChange(room: Room): void {
  const key = phaseLabel(room)
  if (lastLogged.get(room) === key) return
  lastLogged.set(room, key)
  const present = [...room.seats.values()].filter((s) => s.presence === 'present').length
  roomLog(room.code, `→ ${key}; ${present}/${room.seats.size} here; ${waitingLabel(room)}`)
}
