export type UploadState =
  | { status: 'editing' }
  | { status: 'sending' }
  | { status: 'failed'; message: string; canRetry: boolean }
  | { status: 'submitted' }

import { Fragment } from 'react'

// someone BUILD is still waiting for — `away` if they're not here right now
export type WaitingFor = { id: string; name: string; away: boolean }

// "Bob", "Bob and Cara", "Bob, Cara and Dee" — each away one marked
function Names({ people }: { people: WaitingFor[] }) {
  return people.map((p, i) => (
    <Fragment key={p.id}>
      {i > 0 && (i === people.length - 1 ? ' and ' : ', ')}
      {p.name}
      {p.away && <span className="away-marker">away</span>}
    </Fragment>
  ))
}

// what BUILD shows over the canvas once the player has pressed Done (or the
// timer did it for them). Once submitted, it names who the round is still
// waiting for, so a build that runs to its timer is never a mystery.
export default function UploadStatus({
  state,
  onRetry,
  waitingFor = [],
}: {
  state: UploadState
  onRetry: () => void
  waitingFor?: WaitingFor[]
}) {
  switch (state.status) {
    case 'editing':
      return null
    case 'sending':
      return <div className="build-waiting-overlay">Sending your picture…</div>
    case 'submitted':
      return (
        <div className="build-waiting-overlay">
          {waitingFor.length === 0 ? (
            '✓ Submitted — waiting for others…'
          ) : (
            <span>
              ✓ Submitted — waiting for <Names people={waitingFor} />
            </span>
          )}
        </div>
      )
    case 'failed':
      return (
        <div className="build-waiting-overlay build-upload-failed" role="alert">
          <p>{state.message}</p>
          {state.canRetry && <button onClick={onRetry}>Try again</button>}
        </div>
      )
  }
}
