import { SubmitRatingSchema, GameError } from '@smoosh/protocol'
import { touchRoom } from '../rooms/Room.ts'
import { dropPendingActor, recordRating, type PhaseMachineDeps } from '../game/phaseMachine.ts'
import { ok, fail, requireRoom, requireSeat, type TypedServer, type TypedSocket } from './context.ts'

export function registerRatingHandlers(_io: TypedServer, socket: TypedSocket, deps: PhaseMachineDeps): void {
  socket.on('rating:submit', (payload, cb) => {
    try {
      const { pictureIndex, stars } = SubmitRatingSchema.parse(payload)
      const room = requireRoom(socket)
      const seat = requireSeat(room, socket)

      if (room.phase.phase !== 'rate' || room.phase.pictureIndex !== pictureIndex) {
        throw new GameError('PHASE_MISMATCH', 'not currently accepting ratings for this picture')
      }
      if (room.phase.authorId === seat.playerId) {
        throw new GameError('CANNOT_PICK_OWN', 'you cannot rate your own picture')
      }
      if (!room.pendingActors.has(seat.playerId)) {
        throw new GameError('ALREADY_ACTED', 'you already rated this picture')
      }

      recordRating(room, pictureIndex, seat.playerId, stars)
      touchRoom(room)
      cb(ok(undefined))
      dropPendingActor(room, deps, seat.playerId)
      deps.onSnapshot(room)
    } catch (err) {
      cb(fail(err))
    }
  })
}
