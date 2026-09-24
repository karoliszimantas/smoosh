import { SubmitGuessSchema, GameError } from '@smoosh/protocol'
import { touchRoom } from '../rooms/Room.ts'
import { dropPendingActor, recordGuess, optionsForPicture, type PhaseMachineDeps } from '../game/phaseMachine.ts'
import { ok, fail, requireRoom, requireSeat, type TypedServer, type TypedSocket } from './context.ts'

export function registerGuessHandlers(_io: TypedServer, socket: TypedSocket, deps: PhaseMachineDeps): void {
  socket.on('guess:submit', (payload, cb) => {
    try {
      const { pictureIndex, optionId } = SubmitGuessSchema.parse(payload)
      const room = requireRoom(socket)
      const seat = requireSeat(room, socket)

      if (room.phase.phase !== 'guess' || room.phase.pictureIndex !== pictureIndex) {
        throw new GameError('PHASE_MISMATCH', 'not currently accepting guesses for this picture')
      }
      if (room.phase.authorId === seat.playerId) {
        throw new GameError('CANNOT_PICK_OWN', 'the author cannot guess on their own picture')
      }
      if (!room.pendingActors.has(seat.playerId)) {
        throw new GameError('ALREADY_ACTED', 'you already guessed for this picture')
      }

      const option = optionsForPicture(room, pictureIndex).find((o) => o.id === optionId)
      if (!option) throw new GameError('INVALID_PAYLOAD', 'unknown option')
      if (option.authorId === seat.playerId) {
        throw new GameError('CANNOT_PICK_OWN', 'you cannot pick your own lie')
      }

      recordGuess(room, pictureIndex, seat.playerId, optionId)
      touchRoom(room)
      cb(ok(undefined))
      dropPendingActor(room, deps, seat.playerId)
      deps.onSnapshot(room)
    } catch (err) {
      cb(fail(err))
    }
  })
}
