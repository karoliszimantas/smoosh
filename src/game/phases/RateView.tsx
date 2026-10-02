import { useState } from 'react'
import { MIN_RATING, MAX_RATING } from '@smoosh/protocol'
import type { PhaseProps } from '../types'
import DeadlineTimer from '../DeadlineTimer'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

const STARS = Array.from({ length: MAX_RATING - MIN_RATING + 1 }, (_, i) => MIN_RATING + i)

// gallery: everyone but the author rates the picture 1-5. Who made it stays
// hidden until the result, so a rating is about the picture, not the player.
export default function RateView({ snapshot, emit }: PhaseProps) {
  const phase = snapshot.phase

  const [picked, setPicked] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (phase.phase !== 'rate') return null

  const isAuthor = phase.authorId === snapshot.you.playerId
  const rating = picked ?? snapshot.you.ownRating
  const done = snapshot.you.hasActedThisPhase || picked !== null

  const rate = async (stars: number) => {
    if (done) return
    setPicked(stars)
    setError(null)
    const res = await emit('rating:submit', { pictureIndex: phase.pictureIndex, stars })
    if (!res.ok) {
      setError(res.message)
      setPicked(null)
    }
  }

  return (
    <div className="rate-view">
      <DeadlineTimer deadline={phase.deadline} />
      <p className="rate-context">
        Picture {phase.pictureIndex + 1} of {phase.pictureCount}
        {phase.prompt ? <> &middot; “{phase.prompt}”</> : <> &middot; Freestyle</>}
      </p>
      <img className="picture-display" src={`${SERVER_URL}${phase.imagePath}`} alt="" />

      {isAuthor ? (
        <p className="phase-status">This one’s yours — everyone is rating it…</p>
      ) : (
        <>
          <div className="rate-stars" role="radiogroup" aria-label="Your rating">
            {STARS.map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} star${n === 1 ? '' : 's'}`}
                className={`rate-star${rating !== null && n <= rating ? ' filled' : ''}`}
                disabled={done}
                onClick={() => void rate(n)}
              >
                ★
              </button>
            ))}
          </div>
          <p className="phase-status">{done ? 'Rated — waiting for the others…' : 'How good is it?'}</p>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
