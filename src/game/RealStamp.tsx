// A red rubber stamp, struck at a slant across the real prompt's card:
// REAL to the eye, a sentence to a screen reader. `.real-stamp` is the hook
// for the stepped thump it gets on arrival.
export default function RealStamp() {
  return (
    <span className="real-stamp">
      <span aria-hidden="true">Real</span>
      <span className="visually-hidden">This is the real prompt</span>
    </span>
  )
}
