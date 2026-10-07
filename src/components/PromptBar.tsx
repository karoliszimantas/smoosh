import { useEffect, useRef, useState } from 'react'

// how long submit is held to fire: long enough that a thumb passing on its
// way to undo can't do it, short enough not to feel like waiting
const SUBMIT_HOLD_MS = 700

const UNDO_ICON = 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4'
const DONE_ICON = 'M5 12l5 5 9-10'

function Icon({ d }: { d: string }) {
  return (
    <svg className="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

// Submit ends the round, so a single tap never fires it: it's pressed and
// held, with a fill sweeping across to show it's happening, and lifting
// early cancels. A plain tap says how. (`hold: false` — the sandbox's
// Export, where nothing is at stake — is an ordinary button.)
function SubmitButton({ label, onSubmit, hold }: { label: string; onSubmit: () => void; hold: boolean }) {
  const [state, setState] = useState<'idle' | 'holding' | 'hint'>('idle')
  const timer = useRef<number | undefined>(undefined)
  const hintTimer = useRef<number | undefined>(undefined)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      window.clearTimeout(hintTimer.current)
    },
    [],
  )

  if (!hold) {
    return (
      <button className="prompt-bar-btn prompt-bar-submit" onClick={onSubmit}>
        <Icon d={DONE_ICON} />
        <span>{label}</span>
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
      className={`prompt-bar-btn prompt-bar-submit hold${state === 'holding' ? ' holding' : ''}`}
      style={{ ['--hold-ms' as string]: `${SUBMIT_HOLD_MS}ms` }}
      aria-label={`${label} — press and hold`}
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
      <Icon d={DONE_ICON} />
      <span>{state === 'hint' ? 'Hold' : label}</span>
    </button>
  )
}

// The top row: the picture's own actions either side of the prompt they
// answer to — undo on the left, where a thumb reaches in a hurry; submit on
// the right, with the prompt it satisfies.
export default function PromptBar({
  text,
  canUndo,
  onUndo,
  submitLabel,
  onSubmit,
  holdToSubmit,
}: {
  text: string
  canUndo: boolean
  onUndo: () => void
  submitLabel: string
  onSubmit: () => void
  holdToSubmit: boolean
}) {
  return (
    <div className="prompt-bar">
      <button
        className="prompt-bar-btn prompt-bar-undo"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label={canUndo ? 'Undo' : 'Nothing to undo'}
      >
        <Icon d={UNDO_ICON} />
        <span>Undo</span>
      </button>
      <span className="prompt-bar-text">{text}</span>
      <SubmitButton label={submitLabel} onSubmit={onSubmit} hold={holdToSubmit} />
    </div>
  )
}
