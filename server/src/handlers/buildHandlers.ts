import { BeginBuildSchema, GameError, KeepPromptSchema, SwapPromptSchema } from '@smoosh/protocol'
import { touchRoom, type Room } from '../rooms/Room.ts'
import { rescheduleBuild, type PhaseMachineDeps } from '../game/phaseMachine.ts'
import { closeWindow, settleWindows, swapPrompt, swapProblem } from '../game/promptSwap.ts'
import { ok, fail, requireRoom, requireSeat, type TypedServer, type TypedSocket } from './context.ts'

// Guess, the start of BUILD: each player's prompt window (promptSwap.ts).
export function registerBuildHandlers(_io: TypedServer, socket: TypedSocket, deps: PhaseMachineDeps): void {
  const inBuild = (room: Room, round: number) => {
    if (room.phase.phase !== 'build' || room.phase.round !== round) {
      throw new GameError('PHASE_MISMATCH', 'not building now')
    }
    settleWindows(room, Date.now())
  }

  socket.on('prompt:swap', (payload, cb) => {
    try {
      const { round } = SwapPromptSchema.parse(payload)
      const room = requireRoom(socket)
      const seat = requireSeat(room, socket)
      inBuild(room, round)
      const problem = swapProblem(room, seat.playerId, Date.now(), room.swapPool)
      if (problem) throw new GameError('PHASE_MISMATCH', problem)
      swapPrompt(room, seat.playerId, Date.now(), room.swapPool, deps.random)
      touchRoom(room)
      cb(ok(undefined))
      rescheduleBuild(room, deps)
      deps.onSnapshot(room)
    } catch (err) {
      cb(fail(err))
    }
  })

  // which of the two to build — or, with no swap, just "start building":
  // either way the window closes and this player's clock starts
  const close = (keep: 'original' | 'swapped') => (room: Room, playerId: string) => {
    closeWindow(room, playerId, Date.now(), keep)
    touchRoom(room)
    rescheduleBuild(room, deps)
    deps.onSnapshot(room)
  }

  socket.on('prompt:keep', (payload, cb) => {
    try {
      const { round, keep } = KeepPromptSchema.parse(payload)
      const room = requireRoom(socket)
      const seat = requireSeat(room, socket)
      inBuild(room, round)
      cb(ok(undefined))
      close(keep)(room, seat.playerId)
    } catch (err) {
      cb(fail(err))
    }
  })

  socket.on('build:begin', (payload, cb) => {
    try {
      const { round } = BeginBuildSchema.parse(payload)
      const room = requireRoom(socket)
      const seat = requireSeat(room, socket)
      inBuild(room, round)
      cb(ok(undefined))
      close('swapped')(room, seat.playerId)
    } catch (err) {
      cb(fail(err))
    }
  })
}
