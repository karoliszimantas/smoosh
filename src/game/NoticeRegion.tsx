import { useEffect } from 'react'
import type { Toast } from './useGameConnection'
import { RECONNECTING_TEXT } from './roomMessages'

function ToastItem({ toast, onDone }: { toast: Toast; onDone: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDone(toast.id), toast.ms)
    return () => clearTimeout(timer)
  }, [toast, onDone])
  return (
    <li className="notice notice-toast" style={{ animationDuration: `${toast.ms}ms` }}>
      {toast.text}
    </li>
  )
}

// The one place system messages appear, in a fixed order of importance:
//   1. the connection — while it's down, nothing else is shown: whatever
//      else there is to say waits until it's back, rather than stacking up
//   2. an alert — news the player must not miss (their picture was
//      refused), kept until dismissed
//   3. passing news — someone left, the host changed — never asks for
//      anything, never in the way of a tap
// Each message is said once: a toast repeating the alert's words is dropped.
export default function NoticeRegion({
  reconnecting = false,
  alert = null,
  onDismissAlert,
  alertAction,
  toasts,
  onToastDone,
}: {
  reconnecting?: boolean
  alert?: string | null
  onDismissAlert?: () => void
  // in place of dismissing: the one thing that fixes it (Rejoin)
  alertAction?: { label: string; onClick: () => void }
  toasts: Toast[]
  onToastDone: (id: number) => void
}) {
  const said = new Set<string>()
  const shownToasts = reconnecting
    ? []
    : toasts.filter((t) => {
        if (t.text === alert || said.has(t.text)) return false
        said.add(t.text)
        return true
      })
  if (!reconnecting && !alert && shownToasts.length === 0) return null

  return (
    <ul className="notice-region" aria-live="polite">
      {reconnecting ? (
        <li className="notice notice-connection" role="status">
          {RECONNECTING_TEXT}
        </li>
      ) : (
        <>
          {alert && (
            <li className="notice notice-alert" role="alert">
              <span>{alert}</span>
              {alertAction ? (
                <button className="notice-action" onClick={alertAction.onClick}>
                  {alertAction.label}
                </button>
              ) : (
                <button aria-label="Dismiss" onClick={onDismissAlert}>
                  ✕
                </button>
              )}
            </li>
          )}
          {shownToasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDone={onToastDone} />
          ))}
        </>
      )}
    </ul>
  )
}
