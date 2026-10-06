import { useState } from 'react'
import { runnerUpRequired } from '@smoosh/protocol'
import type { PhaseProps } from '../types'
import { useGameServices } from '../services'
import DeadlineTimer from '../DeadlineTimer'
import { titleFor } from '../gallery/galleryText'

// Gallery judging: the whole round hangs at once. Tap your favourite, then
// your runner-up (tap again to take a pick back). Nobody's name is on the
// pictures while you choose, and nobody will ever see what you chose.
export default function VoteView({ snapshot, emit }: PhaseProps) {
  const { Picture } = useGameServices()
  const phase = snapshot.phase
  const own = snapshot.you.ownVote
  const [picks, setPicks] = useState<string[]>(() => (own ? [own.favourite, ...(own.runnerUp ? [own.runnerUp] : [])] : []))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (phase.phase !== 'vote') return null

  const me = snapshot.you.playerId
  const nameById = new Map(snapshot.players.map((p) => [p.id, p.name]))
  const eligible = phase.pictures.filter((p) => p.imagePath !== null && p.authorId !== me)
  // with one other picture there's only a favourite to give
  const maxPicks = Math.min(2, eligible.length)
  const required = runnerUpRequired(eligible.length)
  const done = snapshot.you.hasActedThisPhase
  const ready = picks.length >= (required ? 2 : 1)

  const toggle = (authorId: string) => {
    if (done || sending) return
    setError(null)
    setPicks((prev) => {
      if (prev.includes(authorId)) return prev.filter((id) => id !== authorId)
      if (prev.length < maxPicks) return [...prev, authorId]
      // both chosen already: the newest tap becomes the runner-up
      return [prev[0] ?? authorId, authorId]
    })
  }

  const submit = async () => {
    const [favourite, runnerUp] = picks
    if (!favourite || !ready || done) return
    setSending(true)
    const res = await emit('vote:submit', { round: phase.round, favourite, runnerUp: runnerUp ?? null })
    setSending(false)
    if (!res.ok) setError(res.message)
  }

  const instruction =
    eligible.length === 0
      ? 'Nothing here for you to judge — the others are voting.'
      : maxPicks === 1
        ? 'Choose your favourite.'
        : required
          ? 'Choose your favourite, then a runner-up.'
          : 'Choose your favourite. A runner-up is optional.'

  return (
    <div className="vote-view">
      <DeadlineTimer deadline={phase.deadline} />
      <header className="gallery-head">
        <p className="gallery-kicker">
          Round {phase.round} of {phase.totalRounds} · Judging
        </p>
        <h2 className="gallery-brief">{phase.prompt ? titleFor(phase.prompt) : 'Freestyle'}</h2>
        <p className="gallery-instructions">{done ? 'Votes cast. Waiting for the rest of the jury…' : instruction}</p>
      </header>

      <ul className="vote-grid">
        {phase.pictures.map((p) => {
          const rank = picks.indexOf(p.authorId)
          const isYours = p.authorId === me
          if (p.imagePath === null) {
            return (
              <li key={p.authorId} className="vote-tile missing">
                <div className="vote-missing">
                  <span>{nameById.get(p.authorId) ?? 'Someone'}’s picture didn’t arrive</span>
                </div>
              </li>
            )
          }
          return (
            <li key={p.authorId}>
              <button
                className={`vote-tile${rank >= 0 ? ` picked rank-${rank + 1}` : ''}${isYours ? ' yours' : ''}`}
                onClick={() => toggle(p.authorId)}
                disabled={isYours || done}
                aria-pressed={rank >= 0}
                aria-label={isYours ? 'Your picture' : rank === 0 ? 'Favourite' : rank === 1 ? 'Runner-up' : 'Picture'}
              >
                <span className="exhibit-frame">
                  <Picture imagePath={p.imagePath} />
                </span>
                {isYours && <span className="vote-tag">Yours</span>}
                {rank === 0 && <span className="vote-tag pick">Favourite</span>}
                {rank === 1 && <span className="vote-tag pick">Runner-up</span>}
              </button>
            </li>
          )
        })}
      </ul>

      {eligible.length > 0 && !done && (
        <div className="vote-bar">
          {error && <p className="form-error">{error}</p>}
          <button className="vote-submit" onClick={() => void submit()} disabled={!ready || sending}>
            {sending ? 'Casting…' : picks.length === 0 ? 'Pick a favourite' : !ready ? 'Now a runner-up' : 'Cast votes'}
          </button>
        </div>
      )}
    </div>
  )
}
