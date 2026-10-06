import { useEffect, useState } from 'react'
import { CHAIN_INTRO_MS, CHAIN_PASS_MS, CHAIN_PROMPT_MS, chainRevealTimeline } from '@smoosh/protocol'
import type { PhaseProps } from '../types'
import { ChainPicture } from './ChainPicture'
import { Placard } from '../gallery/Exhibit'
import { titleFor } from '../gallery/galleryText'
import { chainArtists } from './chainText'

// Each chain in turn: all of it as ghosts — as its later players saw it —
// then its passes resolve one at a time, in order, with a beat between;
// then the prompt it started from; then the placard with every artist.
// Every phone plays the same timeline from the server's `startsAt`; the host
// can tap past it to the vote.

type Stage = { chain: number; resolved: number; showPrompt: boolean; showPlacard: boolean } | null

function stageAt(elapsed: number, starts: readonly number[], passes: readonly number[]): Stage {
  for (let i = starts.length - 1; i >= 0; i--) {
    const start = starts[i]
    const n = passes[i]
    if (start === undefined || n === undefined || elapsed < start) continue
    const t = elapsed - start - CHAIN_INTRO_MS
    const resolved = t < 0 ? 0 : Math.min(n, Math.floor(t / CHAIN_PASS_MS) + 1)
    const afterPasses = t - n * CHAIN_PASS_MS
    return { chain: i, resolved, showPrompt: afterPasses >= 0, showPlacard: afterPasses >= CHAIN_PROMPT_MS }
  }
  return null
}

export default function ChainRevealView({ snapshot, emit }: PhaseProps) {
  const phase = snapshot.phase
  const reveal = phase.phase === 'chainReveal' ? phase : null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 150)
    return () => clearInterval(id)
  }, [])
  if (!reveal) return null

  const passes = reveal.chains.map((c) => c.passes.length)
  const { starts } = chainRevealTimeline(passes)
  const stage = stageAt(now - reveal.startsAt, starts, passes) ?? { chain: 0, resolved: 0, showPrompt: false, showPlacard: false }
  const chain = reveal.chains[stage.chain]
  if (!chain) return null
  const nameById = new Map(snapshot.players.map((p) => [p.id, p.name]))
  const artists = chain.passes.map((p) => nameById.get(p.authorId) ?? 'Unknown')
  const canSkip = snapshot.you.isHost

  return (
    <div
      className="chain-reveal"
      onClick={() => canSkip && void emit('chainReveal:skip', { round: reveal.round })}
      role={canSkip ? 'button' : undefined}
      aria-label={canSkip ? 'Skip to the vote' : undefined}
    >
      <p className="gallery-kicker">
        Chain {stage.chain + 1} of {reveal.chains.length}
      </p>
      <div className="chain-reveal-picture exhibit-frame" key={chain.id}>
        <ChainPicture passes={chain.passes.map((p) => p.imagePath)} resolved={stage.resolved} />
      </div>
      <p className="chain-reveal-step" aria-live="polite">
        {stage.resolved === 0 ? 'What each of them could see…' : !stage.showPrompt ? `Pass ${stage.resolved} of ${chain.passes.length}` : ''}
      </p>
      {stage.showPrompt && (
        <p className="chain-reveal-prompt">
          It started as <strong>{titleFor(chain.prompt)}</strong>
        </p>
      )}
      {stage.showPlacard && (
        <div className="chain-reveal-placard">
          <Placard artist={chainArtists(artists)} prompt={chain.prompt} />
        </div>
      )}
      {canSkip && <p className="awards-skip">Tap to skip to the vote</p>}
    </div>
  )
}
