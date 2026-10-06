import { useState } from 'react'
import type { PhaseProps } from '../types'
import DeadlineTimer from '../DeadlineTimer'
import { ChainPicture } from './ChainPicture'
import { actionErrorText } from '../roomMessages'

// One favourite chain each — never one you added to. No names, no prompts.
export default function ChainVoteView({ snapshot, emit }: PhaseProps) {
  const phase = snapshot.phase
  const mine = snapshot.you.chainVote
  const [pick, setPick] = useState<string | null>(mine?.own ?? null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (phase.phase !== 'chainVote') return null

  const votable = new Set(mine?.votable ?? [])
  const done = snapshot.you.hasActedThisPhase
  const cast = async () => {
    if (!pick || done) return
    setSending(true)
    const res = await emit('chainVote:submit', { round: phase.round, chainId: pick })
    setSending(false)
    if (!res.ok) setError(actionErrorText(res.code))
  }

  return (
    <div className="vote-view">
      <DeadlineTimer deadline={phase.deadline} />
      <header className="gallery-head">
        <p className="gallery-kicker">
          Round {phase.round} of {phase.totalRounds} · Judging
        </p>
        <h2 className="gallery-brief">Your favourite chain</h2>
        <p className="gallery-instructions">
          {done
            ? 'Vote cast. Waiting for the rest of the jury…'
            : votable.size === 0
              ? 'You had a hand in every one — the others are voting.'
              : 'Pick one. You can’t vote for a chain you added to.'}
        </p>
      </header>
      <ul className="vote-grid">
        {phase.chains.map((c) => {
          const yours = !votable.has(c.id)
          return (
            <li key={c.id}>
              <button
                className={`vote-tile${pick === c.id ? ' picked rank-1' : ''}${yours ? ' yours' : ''}`}
                onClick={() => !done && !yours && setPick(c.id)}
                disabled={yours || done}
                aria-pressed={pick === c.id}
                aria-label={yours ? 'A chain you added to' : 'Chain'}
              >
                <span className="exhibit-frame">
                  <ChainPicture passes={c.passes} />
                </span>
                {yours && <span className="vote-tag">Yours</span>}
                {pick === c.id && <span className="vote-tag pick">Favourite</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {votable.size > 0 && !done && (
        <div className="vote-bar">
          {error && <p className="form-error">{error}</p>}
          <button className="vote-submit" onClick={() => void cast()} disabled={!pick || sending}>
            {sending ? 'Casting…' : pick ? 'Cast vote' : 'Pick a favourite'}
          </button>
        </div>
      )}
    </div>
  )
}
