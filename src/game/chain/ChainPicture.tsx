import type { Award } from '@smoosh/protocol'
import { SERVER_URL } from '../serverUrl'
import Rosette from '../gallery/Rosette'
import { Placard } from '../gallery/Exhibit'
import { chainArtists } from './chainText'

// a pass's image: from the game server, or (dev fixtures) a local asset
function src(path: string): string {
  return path.startsWith('/submissions/') ? `${SERVER_URL}${path}` : path
}

// A chain's picture: its passes stacked in order on the canvas colour.
// The first `resolved` show as they are; the rest as flat grey ghosts —
// what every player but the first saw while adding to it.
export function ChainPicture({ passes, resolved = passes.length }: { passes: readonly string[]; resolved?: number }) {
  return (
    <div className="chain-picture">
      {passes.map((p, i) => (
        <img key={p} src={src(p)} alt="" className={i < resolved ? 'real' : 'ghost'} />
      ))}
    </div>
  )
}

// a finished chain hung like a Gallery picture: frame, rosette, and a
// placard naming every artist
export default function ChainExhibit({
  passes,
  artists,
  prompt,
  award,
  winner = false,
  large = winner,
  note,
  votes,
}: {
  passes: readonly string[]
  artists: readonly string[]
  prompt: string
  award?: Award | null
  winner?: boolean
  // the big rosette: for a winner shown on its own
  large?: boolean
  note?: string
  votes?: number
}) {
  return (
    <figure className={`exhibit${winner ? ' winner' : ''}`}>
      <div className="exhibit-frame">
        <ChainPicture passes={passes} />
        {award && <Rosette award={award} size={large ? 'large' : 'small'} />}
      </div>
      <Placard
        artist={chainArtists(artists)}
        prompt={prompt}
        {...(note ? { note } : {})}
        {...(votes !== undefined ? { votes: { favourites: votes, runnerUps: 0 } } : {})}
      />
    </figure>
  )
}
