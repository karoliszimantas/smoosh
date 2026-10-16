import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { LIE_TEXT_MAX_LEN, optionText } from '@smoosh/protocol'
import type { PhaseProps } from '../types'
import { useGameServices } from '../services'
import { actionErrorText } from '../roomMessages'
import RoomProgress from '../RoomProgress'
import Tape from '../../components/Tape'
import { lieCountNote, oneLine, showLieCount } from '../lieText'

// Write a lie (Lie.dc.html): the picture taped to the desk, a hint at what
// real prompts look like, and a paper box for a fake one. Then your lie on
// a card while the others finish; the picture's author only waits.
export default function LieView({ snapshot, emit }: PhaseProps) {
  const { Picture } = useGameServices()
  const phase = snapshot.phase

  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // what was sent from this screen; after a reload the server has it, but
  // the snapshot doesn't carry it back
  const [sent, setSent] = useState<string | null>(null)

  if (phase.phase !== 'lie') return null

  const isAuthor = phase.authorId === snapshot.you.playerId
  const submitted = sent !== null || snapshot.you.hasActedThisPhase

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true)
    const res = await emit('lie:submit', { pictureIndex: phase.pictureIndex, text: trimmed })
    setBusy(false)
    if (!res.ok) {
      setError(actionErrorText(res.code))
      return
    }
    setError(null)
    setSent(trimmed)
  }

  // Enter sends: a lie is one line, so there's nothing else for it to do
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    void handleSubmit()
  }

  return (
    <div className="lie-view">
      <div className="picture-frame">
        <Picture imagePath={phase.imagePath} />
        <Tape />
      </div>

      {isAuthor ? (
        <>
          <p className="round-note">This one’s yours. Keep a straight face.</p>
          <RoomProgress snapshot={snapshot} verb="written theirs" exclude={[phase.authorId]} dots />
        </>
      ) : submitted ? (
        <>
          <section className="paper-card lie-sent" aria-label="Your lie">
            {sent !== null ? (
              <>
                <p className="field-label on-paper">Your lie</p>
                <p className="lie-sent-text">{optionText(sent)}</p>
              </>
            ) : (
              <p className="lie-sent-text">Your lie is in.</p>
            )}
          </section>
          <RoomProgress snapshot={snapshot} verb="written theirs" exclude={[phase.authorId]} dots />
        </>
      ) : (
        <>
          <p className="lie-hint">
            Real prompts look like: <strong>someone, in something, doing something, somewhere</strong>
          </p>
          <form className="lie-form" onSubmit={(e) => void handleSubmit(e)}>
            <div className="lie-field-head">
              <label className="field-label" htmlFor="lie-text">
                Your fake prompt
              </label>
              {showLieCount(text.length) && (
                <span className="field-label lie-count" aria-hidden="true">
                  {text.length}/{LIE_TEXT_MAX_LEN}
                </span>
              )}
              <span className="visually-hidden" aria-live="polite">
                {lieCountNote(text.length)}
              </span>
            </div>
            <textarea
              id="lie-text"
              className="field lie-field"
              rows={3}
              maxLength={LIE_TEXT_MAX_LEN}
              enterKeyHint="send"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(oneLine(e.target.value))}
              onKeyDown={onKeyDown}
            />
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn btn-primary btn-block lie-send" disabled={!text.trim() || busy}>
              Send lie
            </button>
          </form>
        </>
      )}
    </div>
  )
}
