import { breakdownTotal } from '@smoosh/protocol'
import type { PhaseProps } from '../types'
import Exhibit from '../gallery/Exhibit'
import PlayerDot from '../PlayerDot'
import { initialsFor } from '../playerMark'
import Tape from '../../components/Tape'
import { useCountdown } from '../useCountdown'
import { rankLabel, rankName, rankWithTies } from '../ranking'
import { formatPoints, signedPoints } from '../points'
import { showsExhibition } from '../finalStandings'
import { roundPictureLines } from '../pictureLines'

export default function ScoresView({ snapshot, emit }: PhaseProps) {
  const phase = snapshot.phase
  const { remainingMs } = useCountdown(phase.phase === 'scores' ? phase.deadline : null)
  if (phase.phase !== 'scores') return null

  const nameById = new Map(snapshot.players.map((p) => [p.id, p.name]))
  const playerById = new Map(snapshot.players.map((p) => [p.id, p]))
  const initials = initialsFor(snapshot.players)
  // a player's dot, before their name
  const dot = (playerId: string) => {
    const player = playerById.get(playerId)
    return (
      player && (
        <PlayerDot player={player} initial={initials.get(player.id)} away={player.presence === 'away'} labelled />
      )
    )
  }
  const ranked = [...phase.scoreboard].sort((a, b) => b.total - a.total)

  // the end of the game reaches here only as Gallery's exhibition; every
  // other ending is FinalView's podium
  const playAgain =
    snapshot.you.isHost ? (
      <button className="btn btn-primary" onClick={() => void emit('room:playAgain', {})}>
        Play again
      </button>
    ) : (
      <p className="phase-status">Waiting for the host to start a new game…</p>
    )

  // Gallery's last word is an exhibition, not a leaderboard: every round's
  // Best in Show on the wall, labelled, then a quiet prize list
  if (showsExhibition(snapshot)) {
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
                <span className="prize-name dot-name">
                  {dot(entry.playerId)}
                  <span>
                    {nameById.get(entry.playerId) ?? '?'}
                    {entry.total === top && <span className="prize-grand">Grand Prize</span>}
                  </span>
                </span>
                <span className="prize-points">{formatPoints(entry.total)}</span>
              </li>
            ))}
          </ol>
        </section>
        {playAgain}
      </div>
    )
  }

  // After round n of m (Scores.dc.html): a cut paper scrap per player,
  // ranked with shared places, your own on tape-yellow, the leader taped
  // down; then when the next round starts
  const youId = snapshot.you.playerId
  const standings = rankWithTies(phase.scoreboard, (e) => e.total)
  const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000))
  // how each picture went this round, as far as this phone saw (Guess only)
  const lines = snapshot.settings.mode === 'guess' ? roundPictureLines(snapshot.roomCode, phase.round) : []

  return (
    <div className="scores-view">
      <h1 className="round-heading scores-title">{`After round ${phase.round} of ${phase.totalRounds}`}</h1>

      <ol className="standings" aria-label="Standings">
        {standings.map((r, i) => {
          const entry = r.item
          const player = playerById.get(entry.playerId)
          const presence = player?.presence
          const you = entry.playerId === youId
          // this round's points; gallery and chain don't say where points came from
          const delta = entry.round ? breakdownTotal(entry.round) : null
          return (
            <li key={entry.playerId} className={`standing${you ? ' you' : ''}${presence === 'away' || presence === 'left' ? ' gone' : ''}`}>
              <span className="standing-rank">
                <span aria-hidden="true">{rankLabel(r)}</span>
                <span className="visually-hidden">{rankName(r)}:</span>
              </span>
              {player && <PlayerDot player={player} initial={initials.get(player.id)} away={presence !== 'present'} labelled />}
              <span className="standing-name">
                <span className="standing-name-text">{nameById.get(entry.playerId) ?? '?'}</span>
                {you && <span className="standing-you">You</span>}
                {presence === 'away' && <span className="away-marker">away</span>}
                {presence === 'left' && <span className="away-marker">left</span>}
              </span>
              {delta !== null && (
                <span className={delta > 0 ? 'standing-delta' : 'standing-delta zero'}>
                  <span className="visually-hidden">, this round </span>
                  {signedPoints(delta)}
                </span>
              )}
              <span className="standing-total">
                <span className="visually-hidden">, total </span>
                {formatPoints(entry.total)}
              </span>
              {i === 0 && <Tape />}
            </li>
          )
        })}
      </ol>

      {lines.length > 0 && (
        <section className="round-lines" aria-labelledby="round-lines-title">
          <h2 id="round-lines-title" className="field-label">
            This round
          </h2>
          <ul>
            {lines.map((l) => (
              <li key={l.pictureIndex}>
                <span className="round-line-whose">{l.authorId === youId ? 'Your picture' : `${l.authorName}’s picture`}</span>{' '}
                <span className="round-line-text">{l.line}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="scores-next">
        Next: Round {phase.round + 1} in <strong>{secondsLeft}</strong>…
      </p>
    </div>
  )
}
