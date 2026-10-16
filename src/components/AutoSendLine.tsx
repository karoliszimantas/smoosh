import { useState } from 'react'
import { autoSendText } from './autoSend'
import './canvas.css'

// From ten seconds out, a line just under the status strip counting down
// to the send — no sound, nothing in the way: it never takes a touch, so a
// drag in progress carries on. A screen reader hears it once, when it
// appears, not every second.
export default function AutoSendLine({ seconds }: { seconds: number | null }) {
  // the words said aloud: the first count seen, then left alone
  const [said, setSaid] = useState<number | null>(null)
  if (seconds !== null && said === null) setSaid(seconds)
  return (
    <>
      {/* there from the start, so the words are announced when they come */}
      <p className="visually-hidden" role="status">
        {said !== null ? autoSendText(said) : ''}
      </p>
      {seconds !== null && (
        <p className="notice auto-send-line" aria-hidden="true">
          {autoSendText(seconds)}
        </p>
      )}
    </>
  )
}
