// The timer tag's words: the clock in digits, the same in words, and what
// its polite live region says as the clock runs down.

// "0:47", "1:40"
export function clockText(seconds: number): string {
  const s = Math.max(0, seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`

// what the clock says, in words: "47 seconds left", "1 minute 40 seconds left"
export function timeLeftText(seconds: number): string {
  if (seconds <= 0) return 'Time’s up'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  const parts = [m > 0 ? plural(m, 'minute') : '', s > 0 ? plural(s, 'second') : ''].filter(Boolean)
  return `${parts.join(' ')} left`
}

// the moments worth saying out loud, and only as the clock passes them
const MARKS = [60, 30, 10, 0] as const

// The polite announcer's memory: the clock it last saw, and what it last
// said. Nothing is said for the first look at a clock (a reload with 8
// seconds left doesn't announce anything), nor for a new deadline — only
// for a mark the clock has just run past. Past several at once (the tab
// was asleep), only the latest is said.
export type Announcer = { deadline: number | null; seconds: number; said: string }

export function announce(prev: Announcer | null, deadline: number | null, seconds: number): Announcer {
  if (!prev || deadline === null || prev.deadline !== deadline) return { deadline, seconds, said: '' }
  const passed = MARKS.filter((mark) => prev.seconds > mark && seconds <= mark)
  const mark = passed.at(-1)
  return { deadline, seconds, said: mark === undefined ? prev.said : timeLeftText(mark) }
}
