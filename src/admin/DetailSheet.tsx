import { useEffect, type ReactNode } from 'react'

// One thing from a list, taking the whole screen — on a phone there's no
// room beside the list, and the list isn't what you're looking at meanwhile.
// An asset being labelled; a room's log.
export default function DetailSheet({
  label,
  title,
  action,
  onClose,
  children,
}: {
  label: string
  title: ReactNode
  // on the bar's right, e.g. Skip
  action?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="admin-sheet" role="dialog" aria-modal="true" aria-label={label}>
      <div className="admin-sheet-bar">
        <button onClick={onClose}>Close</button>
        <span className="admin-sheet-title">{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}
