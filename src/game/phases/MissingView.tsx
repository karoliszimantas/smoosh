import type { PhaseProps } from '../types'
import DeadlineTimer from '../DeadlineTimer'

// a player's turn in the picture order whose picture never reached the
// server — shown to everyone so a missing picture is noticed, not skipped
export default function MissingView({ snapshot }: PhaseProps) {
  const phase = snapshot.phase
  if (phase.phase !== 'missing') return null

  const author = snapshot.players.find((p) => p.id === phase.authorId)
  const isYou = phase.authorId === snapshot.you.playerId

  return (
    <div className="missing-view">
      <DeadlineTimer deadline={phase.deadline} />
      <div className="missing-card">
        <p className="missing-title">
          {isYou ? 'Your picture didn’t arrive' : `${author?.name ?? 'Someone'}’s picture didn’t arrive`}
        </p>
        <p className="phase-status">
          {isYou
            ? 'It never reached the server in time, so there’s nothing to show this round.'
            : 'It never reached the server in time, so there’s nothing to show for this one.'}
        </p>
      </div>
    </div>
  )
}
