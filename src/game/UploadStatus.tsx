export type UploadState =
  | { status: 'editing' }
  | { status: 'sending' }
  | { status: 'failed'; message: string }
  // refused for good: the words are in the notice region, the canvas stays
  // covered
  | { status: 'refused' }
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
// waiting for, so a build that runs to its timer is never a mystery. The
// scrim takes every tap — nothing reaches the canvas underneath — but is
// light enough that the picture shows through.
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
      return (
        <div className="build-waiting-overlay">
          <div className="sys-card">Sending your picture…</div>
        </div>
      )
    case 'submitted':
      return (
        <div className="build-waiting-overlay">
          <div className="sys-card">
            {waitingFor.length === 0 ? (
              '✓ Submitted — waiting for others…'
            ) : (
              <span>
                ✓ Submitted — waiting for <Names people={waitingFor} />
              </span>
            )}
          </div>
        </div>
      )
    case 'refused':
      return <div className="build-waiting-overlay" />
    case 'failed':
      return (
        <div className="build-waiting-overlay">
          <div className="sys-card" role="alert">
            <p>{state.message}</p>
            <button className="sys-button" onClick={onRetry}>
              Try again
            </button>
          </div>
        </div>
      )
  }
}
