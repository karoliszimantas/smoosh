import { Fragment } from 'react'
import type { RoomSnapshot } from '@smoosh/protocol'
import { roomProgress, type WaitingFor } from './waitingProgress'
import PlayerDot from './PlayerDot'

// "Bob", "Bob and Cara", "Bob, Cara and Dee" — each away one marked
export function Names({ people }: { people: WaitingFor[] }) {
  return people.map((p, i) => (
    <Fragment key={p.id}>
      {i > 0 && (i === people.length - 1 ? ' and ' : ', ')}
      {p.name}
      {p.away && <span className="away-marker">away</span>}
    </Fragment>
  ))
}

// What a player with nothing to do sees under the reason they have nothing
// to do: how far the room has got, and who it's waiting for.
// `verb`: "guessed", "voted" — as in "2 of 3 have guessed". `dots`: the
// people still to answer as dashed ghosts too, as the status strip draws
// them, over their names (the names say it for a screen reader; the dots
// are for the eye)
export default function RoomProgress({
  snapshot,
  verb,
  exclude = [],
  dots = false,
}: {
  snapshot: RoomSnapshot
  verb: string
  exclude?: readonly string[]
  dots?: boolean
}) {
  const { done, total, waiting } = roomProgress(snapshot, exclude)
  if (total === 0) return null
  const playerById = new Map(snapshot.players.map((p) => [p.id, p]))
  return (
    <div className="room-progress" aria-live="polite">
      <p className="room-progress-count">
        {done} of {total} {total === 1 ? 'has' : 'have'} {verb}
      </p>
      {dots && waiting.length > 0 && (
        <ul className="dot-row room-progress-dots" aria-hidden="true">
          {waiting.map((w) => {
            const player = playerById.get(w.id)
            return (
              player && (
                <li key={w.id}>
                  <PlayerDot player={player} pending={!w.away} away={w.away} labelled />
                </li>
              )
            )
          })}
        </ul>
      )}
      {waiting.length > 0 && (
        <p className="room-progress-names">
          Waiting for <Names people={waiting} />
        </p>
      )}
    </div>
  )
}
