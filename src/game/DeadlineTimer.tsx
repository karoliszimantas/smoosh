import { useCountdown } from './useCountdown'

// applied to BUILD/LIE/GUESS; REVEAL has nothing to hurry toward so callers
// simply don't render it there. `calm`: the count without the amber, red
// and pulse — for a screen where there's nothing to hurry, only to wait
export default function DeadlineTimer({ deadline, calm = false }: { deadline: number | null; calm?: boolean }) {
  const { remainingMs, urgency } = useCountdown(deadline)
  if (deadline === null) return null

  const seconds = Math.ceil(remainingMs / 1000)
  return (
    <div className={calm ? 'deadline-timer' : `deadline-timer deadline-timer-${urgency}`} aria-live="polite">
      {seconds}s
    </div>
  )
}
