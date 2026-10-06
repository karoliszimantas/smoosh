import type { PhaseProps } from '../types'
import ChainExhibit from './ChainPicture'

// Best in Show goes to a chain, its points shared by every artist on it.
export default function ChainAwardsView({ snapshot }: PhaseProps) {
  const phase = snapshot.phase
  if (phase.phase !== 'chainAwards') return null
  const nameById = new Map(snapshot.players.map((p) => [p.id, p.name]))
  const names = (passes: readonly { authorId: string }[]) => [...new Set(passes.map((p) => nameById.get(p.authorId) ?? 'Unknown'))]
  const best = phase.chains.filter((c) => c.best)
  const rest = phase.chains.filter((c) => !c.best).sort((a, b) => b.votes - a.votes)

  return (
    <div className="exhibition-view">
      <header className="gallery-head">
        <p className="gallery-kicker">
          Round {phase.round} of {phase.totalRounds}
        </p>
        <h1 className="awards-title">{best.length > 0 ? 'Best in Show' : 'The Exhibition'}</h1>
        {best.length > 1 && <p className="awards-shared">Shared</p>}
      </header>
      <div className={`awards-winners count-${Math.min(Math.max(best.length, 1), 3)}`}>
        {best.map((c) => (
          <ChainExhibit
            key={c.id}
            passes={c.passes.map((p) => p.imagePath)}
            artists={names(c.passes)}
            prompt={c.prompt}
            award="best"
            winner
            large={best.length === 1}
            note={`+${c.pointsEach} to each artist`}
            votes={c.votes}
          />
        ))}
      </div>
      {rest.length > 0 && (
        <div className="exhibition-grid">
          {rest.map((c) => (
            <ChainExhibit key={c.id} passes={c.passes.map((p) => p.imagePath)} artists={names(c.passes)} prompt={c.prompt} votes={c.votes} />
          ))}
        </div>
      )}
    </div>
  )
}
