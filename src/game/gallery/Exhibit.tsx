import type { Award } from '@smoosh/protocol'
import { useGameServices } from '../services'
import Rosette from './Rosette'
import { countLine, titleFor } from './galleryText'

// Gallery pictures hang as exhibits: framed, with a museum wall label
// beneath. The label is set dead straight — artist, title, medium, as a
// museum would — and never winks. Whatever is funny is in the picture.

const YEAR = new Date().getFullYear()

export function Placard({
  artist,
  prompt,
  note,
  votes,
}: {
  artist: string
  prompt: string
  // a line of provenance, e.g. "Best in Show, Round 2"
  note?: string
  // counts only — never who
  votes?: { favourites: number; runnerUps: number }
}) {
  const counts = votes ? countLine(votes.favourites, votes.runnerUps) : null
  return (
    <figcaption className="placard">
      <span className="placard-artist">{artist}</span>
      <span className="placard-title">{titleFor(prompt)}</span>
      <span className="placard-medium">Digital collage, {YEAR}</span>
      {note && <span className="placard-note">{note}</span>}
      {counts && <span className="placard-votes">{counts}</span>}
    </figcaption>
  )
}

export default function Exhibit({
  imagePath,
  artist,
  prompt,
  award,
  winner = false,
  rosette = 'normal',
  note,
  votes,
}: {
  imagePath: string
  artist: string
  prompt: string
  award?: Award | null
  // the heavier frame, for Best in Show's moment
  winner?: boolean
  rosette?: 'large' | 'normal' | 'small'
  note?: string
  votes?: { favourites: number; runnerUps: number }
}) {
  const { Picture } = useGameServices()
  return (
    <figure className={`exhibit${winner ? ' winner' : ''}`}>
      <div className="exhibit-frame">
        <Picture imagePath={imagePath} />
        {award && <Rosette award={award} size={rosette} />}
      </div>
      <Placard artist={artist} prompt={prompt} {...(note ? { note } : {})} {...(votes ? { votes } : {})} />
    </figure>
  )
}
