// The same player opened the game in another tab or browser, and that one
// now holds the seat. Nothing is lost; this one can take it back.
export default function ReplacedView({ onPlayHere }: { onPlayHere: () => void }) {
  return (
    <div className="home-view">
      <h1>Playing somewhere else</h1>
      <p className="home-notice">This game is open in another tab or window, so it’s paused here.</p>
      <button onClick={onPlayHere}>Play here instead</button>
    </div>
  )
}
