import { SubmitLieSchema, GameError } from '@smoosh/protocol'
import { touchRoom } from '../rooms/Room.ts'
import { dropPendingActor, recordLie, existingLieTexts, type PhaseMachineDeps } from '../game/phaseMachine.ts'
import { validateLie } from '../game/lieValidation.ts'
import { ok, fail, requireRoom, requireSeat, type TypedServer, type TypedSocket } from './context.ts'

export function registerLieHandlers(_io: TypedServer, socket: TypedSocket, deps: PhaseMachineDeps): void {
  socket.on('lie:submit', (payload, cb) => {
    try {
      const { pictureIndex, text } = SubmitLieSchema.parse(payload)
      const room = requireRoom(socket)
      const seat = requireSeat(room, socket)

      if (room.phase.phase !== 'lie' || room.phase.pictureIndex !== pictureIndex) {
        throw new GameError('PHASE_MISMATCH', 'not currently accepting lies for this picture')
      }
      if (room.phase.authorId === seat.playerId) {
        throw new GameError('CANNOT_PICK_OWN', 'the author cannot lie about their own picture')
      }
      if (!room.pendingActors.has(seat.playerId)) {
        throw new GameError('ALREADY_ACTED', 'you already submitted a lie for this picture')
      }

      const truth = room.promptByPlayer.get(room.phase.authorId) ?? ''
      const rejection = validateLie(text, truth, existingLieTexts(room, pictureIndex))
      if (rejection === 'matches_truth') {
        throw new GameError('LIE_MATCHES_TRUTH', 'that matches the real prompt — try again')
      }
      if (rejection === 'duplicate_lie') {
        throw new GameError('LIE_DUPLICATE', 'someone already submitted that — try again')
      }

      recordLie(room, pictureIndex, seat.playerId, text)
      touchRoom(room)
      cb(ok(undefined))
      dropPendingActor(room, deps, seat.playerId)
      deps.onSnapshot(room)
    } catch (err) {
      cb(fail(err))
    }
  })
}
