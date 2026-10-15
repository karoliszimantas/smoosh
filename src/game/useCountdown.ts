import { useEffect, useState } from 'react'
import { TIMER_AMBER_THRESHOLD_SEC, TIMER_RED_THRESHOLD_SEC, TIMER_PULSE_THRESHOLD_SEC } from '@smoosh/protocol'
import { serverNow } from './serverClock'

export type TimerUrgency = 'normal' | 'amber' | 'red' | 'pulse'

// always recomputes from the server's deadline timestamp rather than
// decrementing a local counter, so it can never drift — and against the
// server's clock, not the phone's, which may be off by seconds
export function useCountdown(deadline: number | null): { remainingMs: number; urgency: TimerUrgency } {
  const [now, setNow] = useState(() => serverNow())

  useEffect(() => {
    if (deadline === null) return
    const id = setInterval(() => setNow(serverNow()), 200)
    return () => clearInterval(id)
  }, [deadline])

  if (deadline === null) return { remainingMs: 0, urgency: 'normal' }

  const remainingMs = Math.max(0, deadline - now)
  const remainingSec = remainingMs / 1000

  let urgency: TimerUrgency = 'normal'
  if (remainingSec <= TIMER_PULSE_THRESHOLD_SEC) urgency = 'pulse'
  else if (remainingSec <= TIMER_RED_THRESHOLD_SEC) urgency = 'red'
  else if (remainingSec <= TIMER_AMBER_THRESHOLD_SEC) urgency = 'amber'

  return { remainingMs, urgency }
}
