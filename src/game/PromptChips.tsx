import type { CSSProperties } from 'react'
import { promptSegments } from '../assets/search'

// The secret prompt, cut out of coloured paper: each word that gets a search
// tab is a torn chip (yellow, blue, pink in turn, each tipped a little), the
// words between them are typed small. The words are cut exactly as the asset
// sheet cuts its tabs, so a chip here is a tab there.
//
// The chips are decoration over the plain sentence: a screen reader gets the
// prompt as written, once.
export default function PromptChips({ prompt, className }: { prompt: string; className?: string }) {
  const segments = promptSegments(prompt)
  const chipIndex = segments.map((_, i) => segments.slice(0, i).filter((s) => s.kind === 'word').length)
  return (
    <p className={className ? `prompt-chips ${className}` : 'prompt-chips'} aria-label={prompt}>
      <span className="visually-hidden">{prompt}</span>
      {segments.map((segment, i) =>
        segment.kind === 'word' ? (
          <span
            key={i}
            aria-hidden="true"
            className={`prompt-chip prompt-chip-${(chipIndex[i] ?? 0) % 3}`}
            // long words shrink to fit the card rather than overflow it
            style={{ '--chars': segment.text.length } as CSSProperties}
          >
            {segment.text}
          </span>
        ) : (
          <span key={i} aria-hidden="true" className="prompt-connector">
            {segment.text}
          </span>
        ),
      )}
    </p>
  )
}
