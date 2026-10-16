import { optionText } from '@smoosh/protocol'
import { useState } from 'react'
import type { PhaseProps } from '../types'
import { useGameServices } from '../services'
import PlayerDot from '../PlayerDot'
import PlayerChip from '../PlayerChip'
import Burst from '../Burst'
import RealStamp from '../RealStamp'
import Tape from '../../components/Tape'
import { nameList, revealSummary } from '../revealSummary'
import { formatPoints, signedPoints } from '../points'
import { NO_FAKES_TEXT } from '../roomMessages'
import { nextPictureLabel, nextPictureSender } from '../nextPicture'

// The truth is… (Reveal.dc.html): the picture small, what you won in a
// burst, the real prompt stamped REAL with who found it, each lie with who
// fell for it, then everyone's score so far along the foot. The host can
// move on before the time's up, once everyone has had their laugh.
export default function RevealView({ snapshot, emit }: PhaseProps) {
  const { Picture } = useGameServices()
  const phase = snapshot.phase
  const summary = revealSummary(snapshot)
  const [sendNext] = useState(() => nextPictureSender((pictureIndex) => emit('reveal:next', { pictureIndex })))
  const [going, setGoing] = useState(false)
  if (phase.phase !== 'reveal' || !summary) return null

  const goNext = async () => {
    setGoing(true)
    if ((await sendNext(phase.pictureIndex)) === 'refused') setGoing(false)
  }

  const youId = snapshot.you.playerId
  const playerById = new Map(snapshot.players.map((p) => [p.id, p]))
  const nameOf = (id: string) => (id === youId ? 'you' : (playerById.get(id)?.name ?? '?'))
  const pointsOf = new Map(phase.pointsThisPicture.map((p) => [p.playerId, p.points]))
  const { truth, lies, you } = summary
  const finders = truth?.pickedBy ?? []
  // nobody wrote a fake: there was nothing to guess, only the real one to see
  const noFakes = lies.length === 0
  const table = snapshot.players.filter((p) => p.presence !== 'left')

  return (
    <div className="reveal-view">
      <header className="reveal-head">
        <div className="picture-frame reveal-thumb">
          <Picture imagePath={phase.imagePath} />
        </div>
        <h1 className="round-heading reveal-title">The truth is…</h1>
        {you.points > 0 ? (
          <Burst points={you.points} note={you.note} />
        ) : (
          you.note && <p className="reveal-note">{you.note}</p>
        )}
      </header>

      {truth && (
        <div className="reveal-truth">
          <section className="torn torn-c reveal-truth-card" aria-label="The real prompt">
            <p className="field-label on-paper">The real prompt</p>
            <p className="reveal-truth-text">{optionText(truth.text)}</p>
            {noFakes ? null : finders.length > 0 ? (
              <>
                <p className="reveal-found">Found it · {signedPoints(summary.foundEach)} each</p>
                <ul className="reveal-finders" aria-label={`Found by ${nameList(finders.map(nameOf))}`}>
                  {finders.map((id) => {
                    const player = playerById.get(id)
                    return (
                      player && (
                        <li key={id}>
                          <PlayerChip player={player} youId={youId} onPaper hostTag={false} />
                        </li>
                      )
                    )
                  })}
                </ul>
              </>
            ) : (
              <p className="reveal-found nobody">Nobody found it</p>
            )}
            <RealStamp />
          </section>
          <Tape y={-8} />
        </div>
      )}

      {noFakes ? (
        <p className="round-note reveal-no-fakes">{NO_FAKES_TEXT}</p>
      ) : (
        <section className="reveal-lies" aria-labelledby="reveal-lies-title">
          <h2 id="reveal-lies-title" className="field-label">
            The lies
          </h2>
          <ul className="reveal-lie-list">
            {lies.map((lie, i) => (
              <li key={lie.option.id} className="reveal-lie-slot">
                <div className={`torn${i % 2 === 1 ? ' torn-b' : ''} reveal-lie`}>
                  <div className="reveal-lie-words">
                    <p className="reveal-lie-text">{optionText(lie.option.text)}</p>
                    <p className="reveal-lie-meta">
                      Fake · by {nameOf(lie.authorId)} ·{' '}
                      {lie.fooled.length > 0 ? (
                        <span className="reveal-lie-points">
                          {signedPoints(lie.pointsEach)} ×{lie.fooled.length}
                        </span>
                      ) : (
                        'no takers'
                      )}
                    </p>
                  </div>
                  {lie.fooled.length > 0 && (
                    <ul className="dot-row" aria-label={`Picked by ${nameList(lie.fooled.map(nameOf))}`}>
                      {lie.fooled.map((id) => {
                        const player = playerById.get(id)
                        return (
                          player && (
                            <li key={id}>
                              <PlayerDot player={player} youId={youId} />
                            </li>
                          )
                        )
                      })}
                    </ul>
                  )}
                </div>
                {lie.bestFib && <span className="best-fib">Best fib</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="paper-card score-ribbon" aria-label="Scores so far">
        <ul>
          {table.map((player) => {
            const delta = pointsOf.get(player.id) ?? 0
            return (
              <li key={player.id}>
                <span className="visually-hidden">
                  {player.name}: {formatPoints(player.score)}
                  {delta > 0 && `, up ${formatPoints(delta)}`}
                </span>
                <span className="score-ribbon-delta" aria-hidden="true">
                  {delta > 0 && signedPoints(delta)}
                </span>
                <span className="dot-name score-ribbon-name" aria-hidden="true">
                  <PlayerDot player={player} away={player.presence === 'away'} labelled />
                  <span>{player.name}</span>
                </span>
                <span className="score-ribbon-total" aria-hidden="true">
                  {formatPoints(player.score)}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      {snapshot.you.isHost && (
        <button className="btn btn-primary btn-block reveal-next" disabled={going} onClick={() => void goNext()}>
          {nextPictureLabel(phase.pictureIndex, phase.pictureCount)}
        </button>
      )}
    </div>
  )
}
