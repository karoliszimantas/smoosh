import { phaseKey } from '@smoosh/protocol'
import type { Room, Seat } from '../rooms/Room.ts'

// How long each phone took to show a new phase, from the moment the server
// sent it — the number that says why a room feels out of step. One line per
// phase per room, once every phone it went to has answered (or the next
// phase comes first, naming whoever never did):
//   [room ABCD] ops seen reveal r2 p3: Mara 85ms, Teo 2.1s (phone 640ms), Ana —

type Sent = { at: number; name: string }
type Ack = { ms: number; frameMs: number }
type PhaseState = {
  key: string
  sent: Map<string, Sent>
  acks: Map<string, Ack>
  logged: boolean
  timer: ReturnType<typeof setTimeout> | null
}

const current = new WeakMap<Room, PhaseState>()

// a phone that takes longer than this between receiving and showing a phase
// has its own share said
const PHONE_NOTE_MS = 50
// a phase that outlasts this without every answer — the last screen of a
// game, say — is logged with what it has
const WAIT_FOR_ACKS_MS = 15_000

const show = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)

function line(state: PhaseState): string {
  const parts = [...state.sent].map(([playerId, sent]) => {
    const ack = state.acks.get(playerId)
    if (!ack) return `${sent.name} —`
    return ack.frameMs > PHONE_NOTE_MS ? `${sent.name} ${show(ack.ms)} (phone ${show(ack.frameMs)})` : `${sent.name} ${show(ack.ms)}`
  })
  return `ops seen ${state.key}: ${parts.join(', ')}`
}

function flush(state: PhaseState, log: (message: string) => void): void {
  if (state.timer) clearTimeout(state.timer)
  state.timer = null
  if (state.logged || state.sent.size === 0) return
  state.logged = true
  log(line(state))
}

// every snapshot broadcast goes through here; only a new phase starts a count
export function notePhaseSent(room: Room, log: (message: string) => void, now = Date.now()): void {
  const key = phaseKey(room.phase)
  const was = current.get(room)
  if (was?.key === key) return
  if (was) flush(was, log)
  const sent = new Map<string, Sent>()
  for (const seat of room.seats.values()) {
    if (seat.socketId) sent.set(seat.playerId, { at: now, name: seat.name })
  }
  const state: PhaseState = { key, sent, acks: new Map(), logged: false, timer: null }
  if (sent.size > 0) {
    state.timer = setTimeout(() => flush(state, log), WAIT_FOR_ACKS_MS)
    state.timer.unref()
  }
  current.set(room, state)
}

// a phone says it has shown `key`. Only counts for the phase the room is in,
// and only for a phone it was sent to as it began (one that joined later
// would be timed from before it arrived)
export function notePhaseSeen(
  room: Room,
  seat: Seat,
  key: string,
  frameMs: number,
  log: (message: string) => void,
  now = Date.now(),
): void {
  const state = current.get(room)
  if (!state || state.key !== key || state.logged) return
  const sent = state.sent.get(seat.playerId)
  if (!sent || state.acks.has(seat.playerId)) return
  state.acks.set(seat.playerId, { ms: now - sent.at, frameMs })
  if (state.acks.size === state.sent.size) flush(state, log)
}
