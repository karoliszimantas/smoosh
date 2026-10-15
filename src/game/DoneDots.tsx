import type { RoomSnapshot } from '@smoosh/protocol'
import PlayerDot from './PlayerDot'
import { whoIsDone } from './whoIsDone'

// Who's done, at a glance: a dot per player in seat order — filled with a
// check once they've answered, a dashed ghost while the room waits on them,
// grey while they're away. Between pictures (nobody answers) just who's
// playing. One image for a screen reader, named in a sentence: "Mara is
// done. Teo and Bob are still building."
//
// Squeezed for room: past what fits, the dots overlap, each later one over
// the one before (see .done-dots).
export default function DoneDots({ snapshot }: { snapshot: RoomSnapshot }) {
  const { dots, label } = whoIsDone(snapshot)
  if (dots.length === 0) return null
  return (
    <div className="done-dots" role="img" aria-label={label}>
      {dots.map(({ player, state }) => (
        <span key={player.id} className="done-dot">
          <PlayerDot
            player={player}
            labelled
            done={state === 'done'}
            pending={state === 'pending'}
            away={state === 'away'}
          />
        </span>
      ))}
    </div>
  )
}
