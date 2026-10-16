// The points you won on a picture, in a tape-yellow starburst with a paper
// note stuck to its corner (Reveal.dc.html). One image to a screen reader:
// "Plus 1400 points: you found it". The star, the figure and the note keep
// their own class names (.burst-star, .burst-points, .burst-note) so the
// stepped arrival can jolt each of them.
const STAR =
  '50,0 56.5,17.3 69.1,3.8 70.9,18.8 85.4,14.6 80.4,29.7 96.2,30.9 84.1,43.2 100,50 82.5,56.5 96.2,69.1 81.8,71.2 85.4,85.4 69.9,79.8 69.1,96.2 57.3,86.6 50,100 42.5,87.5 30.9,96.2 29.3,81 14.6,85.4 18,71.4 3.8,69.1 15.3,56.9 0,50 12.9,42.6 3.8,30.9 20.3,30.2 14.6,14.6 28.5,17.9 30.9,3.8 42.5,12.5'

export default function Burst({ points, note }: { points: number; note: string }) {
  return (
    <div className="burst" role="img" aria-label={`Plus ${points} points: ${note}`}>
      <svg className="burst-star" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <polygon points={STAR} />
      </svg>
      <span className="burst-points" aria-hidden="true">
        +{points}
      </span>
      <span className="burst-note" aria-hidden="true">
        {note}
      </span>
    </div>
  )
}
