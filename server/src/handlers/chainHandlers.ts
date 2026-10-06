import { GameError, SkipChainRevealSchema, SubmitChainVoteSchema } from '@smoosh/protocol'
import { touchRoom } from '../rooms/Room.ts'
import { dropPendingActor, recordChainVote, skipChainReveal, votableChains, type PhaseMachineDeps } from '../game/phaseMachine.ts'
import { ok, fail, requireRoom, requireSeat, type TypedServer, type TypedSocket } from './context.ts'

export function registerChainHandlers(_io: TypedServer, socket: TypedSocket, deps: PhaseMachineDeps): void {
  socket.on('chainVote:submit', (payload, cb) => {
    try {
      const { round, chainId } = SubmitChainVoteSchema.parse(payload)
      const room = requireRoom(socket)
      const seat = requireSeat(room, socket)
      if (room.phase.phase !== 'chainVote' || room.phase.round !== round) {
        throw new GameError('PHASE_MISMATCH', 'not currently taking votes')
      }
      if (!room.pendingActors.has(seat.playerId)) throw new GameError('ALREADY_ACTED', 'you already voted')
      if (!votableChains(room, seat.playerId).includes(chainId)) {
        throw new GameError('CANNOT_PICK_OWN', 'you can’t vote for a chain you added to')
      }
      recordChainVote(room, seat.playerId, chainId)
      touchRoom(room)
      cb(ok(undefined))
      dropPendingActor(room, deps, seat.playerId)
      deps.onSnapshot(room)
    } catch (err) {
      cb(fail(err))
    }
  })

  socket.on('chainReveal:skip', (payload, cb) => {
    try {
      const { round } = SkipChainRevealSchema.parse(payload)
      const room = requireRoom(socket)
      const seat = requireSeat(room, socket)
      if (!seat.isHost) throw new GameError('NOT_HOST', 'only the host can skip')
      if (room.phase.phase !== 'chainReveal' || room.phase.round !== round) throw new GameError('PHASE_MISMATCH', 'nothing to skip')
      touchRoom(room)
      cb(ok(undefined))
      skipChainReveal(room, deps)
    } catch (err) {
      cb(fail(err))
    }
  })
}
