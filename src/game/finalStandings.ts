import type { RoomSnapshot } from '@smoosh/protocol'
import { rankWithTies, type Ranked } from './ranking'

type Entry = Extract<RoomSnapshot['phase'], { phase: 'scores' }>['scoreboard'][number]

// Gallery's last word is an exhibition of every round's Best in Show; every
// other game ends on the podium
export function showsExhibition(snapshot: RoomSnapshot): boolean {
  const { phase, settings } = snapshot
  return phase.phase === 'scores' && phase.isFinalRound && settings.mode === 'gallery' && phase.exhibition.length > 0
}

// one place on the podium: everyone who finished on it (more than one on a tie)
export type Place = { rank: number; tied: boolean; total: number; entries: Entry[] }

// The final standings as places, best first: the first three stand on the
// podium, the rest are listed under it
export function finalPlaces(scoreboard: readonly Entry[]): Place[] {
  const places: Place[] = []
  for (const r of rankWithTies(scoreboard, (e) => e.total) as Ranked<Entry>[]) {
    const last = places.at(-1)
    if (last && last.rank === r.rank) last.entries.push(r.item)
    else places.push({ rank: r.rank, tied: r.tied, total: r.item.total, entries: [r.item] })
  }
  return places
}

// "Mara", "Mara & Teo", "Mara, Teo & Bob" — the banner and the podium's
// joint captions
export function ampersandList(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}
