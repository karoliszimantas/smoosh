import { useCountdown } from './useCountdown'

// applied to BUILD/LIE/GUESS; REVEAL has nothing to hurry toward so callers
// simply don't render it there
export default function DeadlineTimer({ deadline }: { deadline: number | null }) {
  const { remainingMs, urgency } = useCountdown(deadline)
  if (deadline === null) return null

  const seconds = Math.ceil(remainingMs / 1000)
  return (
    <div className={`deadline-timer deadline-timer-${urgency}`} aria-live="polite">
      {seconds}s
    </div>
  )
}
