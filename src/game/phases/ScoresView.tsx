import { breakdownTotal, type PointsBreakdown } from '@smoosh/protocol'
import type { PhaseProps } from '../types'
import Exhibit from '../gallery/Exhibit'

// where a player's points came from, in a line that adds up to the number
// beside it
function Breakdown({ b }: { b: PointsBreakdown }) {
  return (
    <span className="score-breakdown">
      <span className={b.picture ? '' : 'zero'}>
        <small>picture</small> {b.picture}
      </span>
      <span className={b.guessing ? '' : 'zero'}>
        <small>guessing</small> {b.guessing}
      </span>
      <span className={b.lies ? '' : 'zero'}>
        <small>lies</small> {b.lies}
      </span>
    </span>
  )
}

export default function ScoresView({ snapshot, emit }: PhaseProps) {
  const phase = snapshot.phase
  if (phase.phase !== 'scores') return null

  const nameById = new Map(snapshot.players.map((p) => [p.id, p.name]))
  const presenceById = new Map(snapshot.players.map((p) => [p.id, p.presence]))
  const ranked = [...phase.scoreboard].sort((a, b) => b.total - a.total)
  const winner = phase.isFinalRound ? ranked[0] : undefined

  const playAgain =
    phase.isFinalRound &&
    (snapshot.you.isHost ? (
      <button onClick={() => void emit('room:playAgain', {})}>Play again</button>
    ) : (
      <p className="phase-status">Waiting for the host to start a new game…</p>
    ))

  // Gallery's last word is an exhibition, not a leaderboard: every round's
  // Best in Show on the wall, labelled, then a quiet prize list
  if (phase.isFinalRound && snapshot.settings.mode === 'gallery' && phase.exhibition.length > 0) {
    const top = ranked[0]?.total
    return (
      <div className="exhibition-view">
        <header className="gallery-head">
          <p className="gallery-kicker">Closing exhibition</p>
          <h1 className="awards-title">Best in Show</h1>
          <p className="awards-subject">The winning works, round by round</p>
        </header>
        <div className="exhibition-grid">
          {phase.exhibition.map((e) => (
            <Exhibit
              key={`${e.round}-${e.authorId}`}
              imagePath={e.imagePath}
              artist={nameById.get(e.authorId) ?? 'Unknown'}
              prompt={e.prompt}
              award="best"
              winner
              rosette="small"
              note={`Best in Show, Round ${e.round}`}
            />
          ))}
        </div>
        <section className="prize-list" aria-label="Points">
          <h2>Prize list</h2>
          <ol>
            {ranked.map((entry) => (
              <li key={entry.playerId} className={entry.total === top ? 'grand' : ''}>
                <span className="prize-name">
                  {nameById.get(entry.playerId) ?? '?'}
                  {entry.total === top && <span className="prize-grand">Grand Prize</span>}
                </span>
                <span className="prize-points">{entry.total}</span>
              </li>
            ))}
          </ol>
        </section>
        {playAgain}
      </div>
    )
  }

  return (
    <div className="scores-view">
      <h1>{phase.isFinalRound ? 'Final scores' : `Round ${phase.round} of ${phase.totalRounds}`}</h1>

      {winner && <p className="scores-winner">{nameById.get(winner.playerId) ?? '?'} wins!</p>}

      <ol className="scoreboard">
        {ranked.map((entry) => {
          // the round's points mid-game, the whole game's at the end — each
          // adds up to the figure shown with it
          const b = phase.isFinalRound ? entry.game : entry.round
          return (
            <li key={entry.playerId} className={presenceById.get(entry.playerId) === 'away' ? 'away' : ''}>
              <span className="score-line">
                <span>
                  {nameById.get(entry.playerId) ?? '?'}
                  {presenceById.get(entry.playerId) === 'away' && <span className="away-marker">away</span>}
                  {presenceById.get(entry.playerId) === 'left' && <span className="away-marker">left</span>}
                </span>
                <span className="score-total">{entry.total}</span>
              </span>
              {b && (
                <>
                  {!phase.isFinalRound && <span className="score-round">+{breakdownTotal(b)} this round</span>}
                  <Breakdown b={b} />
                </>
              )}
            </li>
          )
        })}
      </ol>

      {playAgain}
    </div>
  )
}
