import { SubmitVoteSchema, SkipAwardsSchema, GameError } from '@smoosh/protocol'
import { touchRoom } from '../rooms/Room.ts'
import { dropPendingActor, recordVote, skipAwards, voteProblem, type PhaseMachineDeps } from '../game/phaseMachine.ts'
import { ok, fail, requireRoom, requireSeat, type TypedServer, type TypedSocket } from './context.ts'

export function registerVoteHandlers(_io: TypedServer, socket: TypedSocket, deps: PhaseMachineDeps): void {
  socket.on('vote:submit', (payload, cb) => {
    try {
      const { round, favourite, runnerUp } = SubmitVoteSchema.parse(payload)
      const room = requireRoom(socket)
      const seat = requireSeat(room, socket)

      if (room.phase.phase !== 'vote' || room.phase.round !== round) {
        throw new GameError('PHASE_MISMATCH', 'not currently taking votes')
      }
      if (favourite === seat.playerId || runnerUp === seat.playerId) {
        throw new GameError('CANNOT_PICK_OWN', 'you cannot vote for your own picture')
      }
      if (!room.pendingActors.has(seat.playerId)) {
        throw new GameError('ALREADY_ACTED', 'you already voted')
      }
      const problem = voteProblem(room, seat.playerId, favourite, runnerUp)
      if (problem) throw new GameError('INVALID_PAYLOAD', problem)

      recordVote(room, seat.playerId, favourite, runnerUp)
      touchRoom(room)
      cb(ok(undefined))
      dropPendingActor(room, deps, seat.playerId)
      deps.onSnapshot(room)
    } catch (err) {
      cb(fail(err))
    }
  })

  socket.on('awards:skip', (payload, cb) => {
    try {
      const { round } = SkipAwardsSchema.parse(payload)
      const room = requireRoom(socket)
      const seat = requireSeat(room, socket)
      if (!seat.isHost) throw new GameError('NOT_HOST', 'only the host can skip')
      if (room.phase.phase !== 'awards' || room.phase.round !== round) {
        throw new GameError('PHASE_MISMATCH', 'nothing to skip')
      }
      touchRoom(room)
      cb(ok(undefined))
      skipAwards(room, deps)
    } catch (err) {
      cb(fail(err))
    }
  })
}
