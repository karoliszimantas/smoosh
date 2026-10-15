import { useEffect, useId, useRef, useState } from 'react'
import { promptSegments } from '../assets/search'

// how long submit is held to fire: long enough that a thumb passing on its
// way to undo can't do it, short enough not to feel like waiting
const SUBMIT_HOLD_MS = 700

function UndoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </svg>
  )
}

function CheckIcon({ size, strokeWidth }: { size: number; strokeWidth: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

// Submit ends the round, so a single tap never fires it: it's pressed and
// held, with a fill sweeping across to show it's happening, and lifting
// early cancels. A plain tap says how. (`hold: false` — the sandbox's
// Export, where nothing is at stake — is an ordinary button.) A paper tag
// on an ink ledge, with "hold" typed under it.
function SubmitButton({ label, onSubmit, hold }: { label: string; onSubmit: () => void; hold: boolean }) {
  const [state, setState] = useState<'idle' | 'holding' | 'hint'>('idle')
  const timer = useRef<number | undefined>(undefined)
  const hintTimer = useRef<number | undefined>(undefined)
  const holdId = useId()
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      window.clearTimeout(hintTimer.current)
    },
    [],
  )

  if (!hold) {
    return (
      <button className="prompt-bar-submit" onClick={onSubmit}>
        <span className="prompt-bar-submit-label">
          <CheckIcon size={13} strokeWidth={3.5} />
          {label}
        </span>
      </button>
    )
  }

  const start = () => {
    window.clearTimeout(hintTimer.current)
    setState('holding')
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      setState('idle')
      onSubmit()
    }, SUBMIT_HOLD_MS)
  }
  // let go (or slid off) before it fired: nothing sent, and a word on how
  const stop = () => {
    if (timer.current === undefined) return
    window.clearTimeout(timer.current)
    timer.current = undefined
    setState('hint')
    hintTimer.current = window.setTimeout(() => setState('idle'), 1800)
  }

  return (
    <button
      className={`prompt-bar-submit hold${state === 'holding' ? ' holding' : ''}`}
      style={{ ['--hold-ms' as string]: `${SUBMIT_HOLD_MS}ms` }}
      aria-label={`${label} — press and hold`}
      aria-describedby={holdId}
      onPointerDown={(e) => {
        if (e.isPrimary) start()
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start()
      }}
      onKeyUp={stop}
    >
      <span className="hold-fill" aria-hidden="true" />
      <span className="prompt-bar-submit-label">
        <CheckIcon size={13} strokeWidth={3.5} />
        {state === 'hint' ? 'Hold' : label}
      </span>
      <span id={holdId} className="prompt-bar-hold">
        hold
      </span>
    </button>
  )
}

// The prompt's words as paper chips, each a way into its search tab — and
// marked used, with a green check, once a layer placed from that tab is on
// the canvas. The words between are typed small on the desk, for reading.
export function PromptWords({
  text,
  usedWords,
  onWord,
}: {
  text: string
  usedWords: ReadonlySet<string>
  onWord: (term: string) => void
}) {
  return (
    <div className="prompt-words" role="group" aria-label="Your prompt. Tap a word to search it">
      {promptSegments(text).map((segment, i) => {
        if (segment.kind === 'connector') {
          return (
            <span key={i} className="prompt-words-connector" aria-hidden="true">
              {segment.text}
            </span>
          )
        }
        const used = usedWords.has(segment.term)
        return (
          <button
            key={i}
            type="button"
            className={used ? 'prompt-word used' : 'prompt-word'}
            aria-label={`${segment.text}${used ? ', used' : ''}. Search it`}
            onClick={() => onWord(segment.term)}
          >
            {segment.text}
            {used && (
              <span className="prompt-word-check" aria-hidden="true">
                <CheckIcon size={11} strokeWidth={4} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// The top row, on the desk: the picture's own actions either side of the
// prompt they answer to — undo on the left, where a thumb reaches in a
// hurry; submit on the right, with the prompt it satisfies. With no prompt
// to search (freestyle, a blind chain pass) the line is just read.
export default function PromptBar({
  text,
  freestyle,
  usedWords,
  onWord,
  canUndo,
  onUndo,
  submitLabel,
  onSubmit,
  holdToSubmit,
}: {
  text: string
  freestyle: boolean
  usedWords: ReadonlySet<string>
  onWord: (term: string) => void
  canUndo: boolean
  onUndo: () => void
  submitLabel: string
  onSubmit: () => void
  holdToSubmit: boolean
}) {
  return (
    <div className="prompt-bar">
      <button
        className="icon-btn prompt-bar-undo"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label={canUndo ? 'Undo' : 'Nothing to undo'}
      >
        <UndoIcon />
      </button>
      {freestyle ? (
        <p className="prompt-bar-text">{text}</p>
      ) : (
        <PromptWords text={text} usedWords={usedWords} onWord={onWord} />
      )}
      <SubmitButton label={submitLabel} onSubmit={onSubmit} hold={holdToSubmit} />
    </div>
  )
}
