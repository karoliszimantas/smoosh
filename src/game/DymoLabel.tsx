// The room code punched into a strip of black embossing tape (Lobby.dc.html,
// Style.dc.html): white typewriter capitals, the strip stuck on at −1°.
// One image to a screen reader, its name spaced out — "Room code K R P T" —
// so the code is spelled, not read as a word.
//
// `lg` is the Lobby card's (48px letters), `sm` the menu's (26px).
export default function DymoLabel({ code, size = 'lg' }: { code: string; size?: 'lg' | 'sm' }) {
  const letters = [...code.toUpperCase()]
  return (
    <span className={`dymo dymo-${size}`} role="img" aria-label={`Room code ${letters.join(' ')}`}>
      {letters.map((letter, i) => (
        <span key={i} aria-hidden="true">
          {letter}
        </span>
      ))}
    </span>
  )
}
