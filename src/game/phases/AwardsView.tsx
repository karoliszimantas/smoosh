import { useEffect, useState } from 'react'
import { AWARD_TITLES, AWARDS, awardsTimeline, type Award } from '@smoosh/protocol'
import type { PhaseProps } from '../types'
import Exhibit from '../gallery/Exhibit'
import { titleFor } from '../gallery/galleryText'

// The awards, announced one at a time, lowest first, building to Best in
// Show — then the whole wall. Every phone plays the same timeline from the
// server's `startsAt`, so the room hears one announcement at a time; the
// host can tap to cut straight to the wall.

type Step = { kind: 'intro' } | { kind: 'award'; index: number } | { kind: 'wall' }

function stepAt(elapsed: number, starts: readonly number[], wallAt: number): Step {
  if (elapsed >= wallAt) return { kind: 'wall' }
  for (let i = starts.length - 1; i >= 0; i--) {
    const start = starts[i]
    if (start !== undefined && elapsed >= start) return { kind: 'award', index: i }
  }
  return { kind: 'intro' }
}

// the step the timeline is on now, re-rendering exactly at each change
function useStep(startsAt: number, order: readonly Award[], skipped: boolean): Step {
  const { starts, wallAt } = awardsTimeline(order)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (skipped) return
    const elapsed = now - startsAt
    const next = [...starts, wallAt].find((t) => t > elapsed)
    if (next === undefined) return
    const timer = setTimeout(() => setNow(Date.now()), next - elapsed + 20)
    return () => clearTimeout(timer)
  }, [now, startsAt, starts, wallAt, skipped])
  return skipped ? { kind: 'wall' } : stepAt(now - startsAt, starts, wallAt)
}

const rank = (a: Award | null) => (a === null ? -1 : AWARDS.indexOf(a))

export default function AwardsView({ snapshot, emit }: PhaseProps) {
  const phase = snapshot.phase
  const awards = phase.phase === 'awards' ? phase : null
  const step = useStep(awards?.startsAt ?? 0, awards?.announcements ?? [], awards?.skipped ?? true)
  if (!awards) return null

  const nameById = new Map(snapshot.players.map((p) => [p.id, p.name]))
  const artist = (id: string) => nameById.get(id) ?? 'Unknown'
  const canSkip = snapshot.you.isHost && step.kind !== 'wall'
  const skip = () => {
    if (canSkip) void emit('awards:skip', { round: awards.round })
  }

  let body
  if (step.kind === 'intro') {
    body = (
      <div className="awards-card" key="intro">
        <p className="gallery-kicker">
          Round {awards.round} of {awards.totalRounds}
        </p>
        <h1 className="awards-title">The Awards</h1>
        <p className="awards-subject">
          {awards.prompt ? (
            <>
              Works on the theme <em>{titleFor(awards.prompt)}</em>
            </>
          ) : (
            'Open submission'
          )}
        </p>
      </div>
    )
  } else if (step.kind === 'award') {
    const award = awards.announcements[step.index] ?? 'best'
    const winners = awards.pictures.filter((p) => p.award === award)
    const best = award === 'best'
    body = (
      <div className={`awards-card award-${award}`} key={`award-${award}`}>
        <h1 className="awards-title">{AWARD_TITLES[award]}</h1>
        {winners.length > 1 && <p className="awards-shared">Shared</p>}
        <div className={`awards-winners count-${Math.min(winners.length, 3)}`}>
          {winners.map((p) => (
            <Exhibit
              key={p.authorId}
              imagePath={p.imagePath}
              artist={artist(p.authorId)}
              prompt={awards.prompt}
              award={award}
              winner={best}
              rosette={best ? 'large' : 'normal'}
            />
          ))}
        </div>
      </div>
    )
  } else {
    // the wall: prize-winners first, highest prize first
    const hung = [...awards.pictures].sort((a, b) => rank(b.award) - rank(a.award) || b.points - a.points)
    body = (
      <div className="awards-wall" key="wall">
        <p className="gallery-kicker">
          Round {awards.round} of {awards.totalRounds}
        </p>
        <h2 className="awards-wall-title">The Exhibition</h2>
        {awards.announcements.length === 0 && <p className="awards-subject">No votes were cast.</p>}
        <div className="exhibition-grid">
          {hung.map((p) => (
            <Exhibit
              key={p.authorId}
              imagePath={p.imagePath}
              artist={artist(p.authorId)}
              prompt={awards.prompt}
              award={p.award}
              winner={p.award === 'best'}
              rosette="small"
              {...(p.award ? { note: AWARD_TITLES[p.award] } : {})}
              votes={{ favourites: p.favourites, runnerUps: p.runnerUps }}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    // the host's tap anywhere skips; for everyone else the screen is still
    <div
      className={`awards-view${step.kind === 'wall' ? ' on-wall' : ''}`}
      onClick={skip}
      role={canSkip ? 'button' : undefined}
      aria-label={canSkip ? 'Skip to the full results' : undefined}
      aria-live="polite"
    >
      {body}
      {canSkip && <p className="awards-skip">Tap to skip</p>}
    </div>
  )
}
