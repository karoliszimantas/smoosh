import { Fragment } from 'react'
import type { RoomSnapshot } from '@smoosh/protocol'
import { roomProgress, type WaitingFor } from './waitingProgress'

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
// `verb`: "guessed", "voted" — as in "2 of 3 have guessed".
export default function RoomProgress({
  snapshot,
  verb,
  exclude = [],
}: {
  snapshot: RoomSnapshot
  verb: string
  exclude?: readonly string[]
}) {
  const { done, total, waiting } = roomProgress(snapshot, exclude)
  if (total === 0) return null
  return (
    <div className="room-progress" aria-live="polite">
      <p className="room-progress-count">
        {done} of {total} {total === 1 ? 'has' : 'have'} {verb}
      </p>
      {waiting.length > 0 && (
        <p className="room-progress-names">
          Waiting for <Names people={waiting} />
        </p>
      )}
    </div>
  )
}
