import { useState } from 'react'
import { TIMER_RED_THRESHOLD_SEC } from '@smoosh/protocol'
import { useCountdown } from './useCountdown'
import { fuseFraction } from './phaseDuration'
import { announce, clockText, timeLeftText, type Announcer } from './timerText'

// The phase clock as a paper tag hung on a string: the time in big digits
// over a fuse that burns down to the deadline. In the last 10 seconds the
// tag turns hot — orange, tilted the other way, the fuse in hazard stripes.
// With a `word` (Reveal, Scores: nothing to hurry) the tag names the phase
// instead, and the fuse just shows when it moves on.
//
// The digits are a timer that never speaks on its own (aria-live off — a
// countdown read every second is noise); a separate polite region says
// "1 minute left", "30 seconds left", "10 seconds left" and "Time’s up" as
// the clock passes them.
export default function TimerTag({
  deadline,
  durationSec,
  word = null,
}: {
  deadline: number | null
  // the phase's full length — the fuse is what's left of it
  durationSec: number | null
  word?: string | null
}) {
  const { remainingMs } = useCountdown(deadline)
  const seconds = Math.ceil(remainingMs / 1000)
  const [announcer, setAnnouncer] = useState<Announcer>(() => announce(null, deadline, seconds))
  if (announcer.deadline !== deadline || announcer.seconds !== seconds) {
    setAnnouncer(announce(announcer, deadline, seconds))
  }

  const counting = word === null && deadline !== null
  const hot = counting && seconds <= TIMER_RED_THRESHOLD_SEC
  const fuse = fuseFraction(remainingMs, durationSec)

  return (
    <div className={`timer-tag${hot ? ' hot' : ''}`}>
      <svg className="timer-tag-string" aria-hidden="true" width="26" height="56" viewBox="0 0 26 56" fill="none">
        <path d="M13 53 C 5 40, 21 22, 9 0" />
      </svg>
      <span className="timer-tag-hole" aria-hidden="true" />
      {counting ? (
        <span className="timer-tag-digits" role="timer" aria-live="off" aria-label={timeLeftText(seconds)}>
          {clockText(seconds)}
        </span>
      ) : (
        <span className="timer-tag-word">{word}</span>
      )}
      {deadline !== null && (
        <span className="timer-tag-fuse" aria-hidden="true">
          <span className="timer-tag-fill" style={{ width: `${(fuse * 100).toFixed(2)}%` }} />
        </span>
      )}
      {counting && (
        <span className="visually-hidden" role="status" aria-live="polite">
          {announcer.said}
        </span>
      )}
    </div>
  )
}
