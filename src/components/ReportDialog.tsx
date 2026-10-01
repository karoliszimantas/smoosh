import { useEffect, useRef, useState } from 'react'
import { pixabaySource } from '../assets'

const REASONS = ['Offensive or inappropriate', 'Shows a real person', 'Broken or bad cut', 'Something else'] as const

// Reports go to a file an admin reviews (tools/moderate.ts) — nothing is
// removed automatically, so the copy says "thanks", not "removed".
export default function ReportDialog({
  pixabayId,
  onReported,
  onClose,
}: {
  pixabayId: number
  onReported: (pixabayId: number) => void
  onClose: () => void
}) {
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'sending' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  })
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const send = (reason: string) => {
    setState({ kind: 'sending' })
    pixabaySource.report(pixabayId, reason).then(
      () => onReported(pixabayId),
      (err: unknown) => setState({ kind: 'error', message: err instanceof Error ? err.message : 'Report failed.' }),
    )
  }

  return (
    <div className="report-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <h2 id="report-title">Report this image</h2>
        <p>It will be hidden for you, and reviewed for removal for everyone.</p>
        {REASONS.map((reason) => (
          <button key={reason} disabled={state.kind === 'sending'} onClick={() => send(reason)}>
            {reason}
          </button>
        ))}
        {state.kind === 'error' && <p className="report-error">{state.message}</p>}
        <button className="report-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
