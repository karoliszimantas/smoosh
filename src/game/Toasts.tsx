import { useEffect } from 'react'
import type { Toast } from './useGameConnection'

function ToastItem({ toast, onDone }: { toast: Toast; onDone: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDone(toast.id), toast.ms)
    return () => clearTimeout(timer)
  }, [toast, onDone])
  return (
    <li className="toast" style={{ animationDuration: `${toast.ms}ms` }}>
      {toast.text}
    </li>
  )
}

// calm, passing news — someone left, the host changed, you're back. Never
// asks for anything, never in the way of a tap.
export default function Toasts({ toasts, onDone }: { toasts: Toast[]; onDone: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <ul className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDone={onDone} />
      ))}
    </ul>
  )
}
