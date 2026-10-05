import type { PhaseProps } from '../types'
import { useGameServices } from '../services'

export default function RateResultView({ snapshot }: PhaseProps) {
  const { Picture } = useGameServices()
  const phase = snapshot.phase
  if (phase.phase !== 'rateResult') return null

  const author = snapshot.players.find((p) => p.id === phase.authorId)
  const isYou = phase.authorId === snapshot.you.playerId
  const most = Math.max(1, ...phase.counts)

  return (
    <div className="rate-view">
      <Picture imagePath={phase.imagePath} />
      <p className="rate-author">by {isYou ? 'you' : (author?.name ?? '?')}</p>

      {phase.average === null ? (
        <p className="phase-status">Nobody rated this one</p>
      ) : (
        <>
          <p className="rate-average">
            {phase.average.toFixed(1)} <span aria-hidden="true">★</span>
          </p>
          {/* 5 stars at the top, like every review breakdown */}
          <ul className="rate-breakdown" aria-label="How everyone rated it">
            {phase.counts
              .map((count, i) => ({ stars: i + 1, count }))
              .reverse()
              .map(({ stars, count }) => (
                <li key={stars}>
                  <span className="rate-breakdown-label">{stars}★</span>
                  <span className="rate-breakdown-bar">
                    <span style={{ width: `${(count / most) * 100}%` }} />
                  </span>
                  <span className="rate-breakdown-count">{count}</span>
                </li>
              ))}
          </ul>
        </>
      )}
      <p className="rate-points">+{phase.points}</p>
    </div>
  )
}
