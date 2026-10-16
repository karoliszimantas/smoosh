import { SubmitLieSchema, GameError } from '@smoosh/protocol'
import { touchRoom } from '../rooms/Room.ts'
import { dropPendingActor, recordLie, existingLieTexts, type PhaseMachineDeps } from '../game/phaseMachine.ts'
import { validateLie } from '../game/lieValidation.ts'
import { ok, fail, safeAck, requireRoom, requireSeat, type TypedServer, type TypedSocket } from './context.ts'

export function registerLieHandlers(_io: TypedServer, socket: TypedSocket, deps: PhaseMachineDeps): void {
  socket.on('lie:submit', (payload, cb) => {
    const ack = safeAck(cb)
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
      // the same reply whether it matched the truth or another lie, so a
      // refusal never tells the player they guessed the real prompt
      if (rejection !== null) throw new GameError('LIE_REJECTED', 'Someone already has that one — write another')

      recordLie(room, pictureIndex, seat.playerId, text)
      touchRoom(room)
      ack(ok(undefined))
      dropPendingActor(room, deps, seat.playerId)
      deps.onSnapshot(room)
    } catch (err) {
      ack(fail(err))
    }
  })
}
