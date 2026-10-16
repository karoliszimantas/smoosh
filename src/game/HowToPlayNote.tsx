import { HOW_TO_PLAY_STEPS } from './howToPlayText'

// A player's first Lobby: the rules on a quiet paper note between the
// players and the settings, to read while they wait — never over the room
// code or the invite buttons, and never in the way. Got it puts it away
// for good (howToPlaySeen.ts).
export default function HowToPlayNote({ onDone }: { onDone: () => void }) {
  return (
    <section className="paper-card lobby-howto" aria-labelledby="lobby-howto-title">
      <h2 id="lobby-howto-title" className="field-label on-paper">
        How to play
      </h2>
      <ol className="lobby-howto-steps">
        {HOW_TO_PLAY_STEPS.map((step) => (
          <li key={step.title}>
            <strong>{step.title}</strong> {step.text}
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-secondary btn-inset btn-sm lobby-howto-done" onClick={onDone}>
        Got it
      </button>
    </section>
  )
}
