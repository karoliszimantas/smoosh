import { guessPointsFor, type Player, type RevealOption, type RoomSnapshot } from '@smoosh/protocol'

// "Mara", "Mara and Teo", "Mara, Teo and Bob"
export function nameList(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// a points figure as the artboards print it: 4,000
const POINTS = new Intl.NumberFormat('en-US')
export function formatPoints(points: number): string {
  return POINTS.format(points)
}

export type RevealLie = {
  option: RevealOption
  authorId: string
  // who fell for it, and what each of them earned its writer
  fooled: readonly string[]
  pointsEach: number
  // the lie that fooled the most people (every one of them, on a tie; none
  // if nobody fell for anything)
  bestFib: boolean
}

// what this picture did for you: the points, and the few words on the
// note stuck to the burst (or, with nothing won, on its own)
export type YourReveal = { points: number; note: string }

export type RevealSummary = {
  truth: RevealOption | null
  // what each finder of the truth got
  foundEach: number
  // fooled-most first; otherwise the order they were shown in
  lies: RevealLie[]
  you: YourReveal
}

// Everything the Reveal screen says, from the reveal phase alone: the
// options with who picked what, the points this picture handed out, and the
// table size it was scored at (pictureCount — one picture per player dealt
// in, the same `players` the server scored with).
export function revealSummary(snapshot: RoomSnapshot): RevealSummary | null {
  const { phase, you } = snapshot
  if (phase.phase !== 'reveal') return null
  const values = guessPointsFor(phase.pictureCount)
  const truth = phase.options.find((o) => o.isTruth) ?? null

  const shown = phase.options.filter((o): o is RevealOption & { authorId: string } => !o.isTruth && o.authorId !== null)
  const most = Math.max(0, ...shown.map((o) => o.pickedBy.length))
  const lies: RevealLie[] = shown
    .map((option) => ({
      option,
      authorId: option.authorId,
      fooled: option.pickedBy,
      pointsEach: values.lie,
      bestFib: most > 0 && option.pickedBy.length === most,
    }))
    // stable: equal lies keep the order everyone guessed them in
    .sort((a, b) => b.fooled.length - a.fooled.length)

  const points = phase.pointsThisPicture.find((p) => p.playerId === you.playerId)?.points ?? 0
  return { truth, foundEach: values.correctGuess, lies, you: { points, note: yourNote(snapshot, points, truth, lies) } }
}

function yourNote(snapshot: RoomSnapshot, points: number, truth: RevealOption | null, lies: RevealLie[]): string {
  const { phase, you, players } = snapshot
  if (phase.phase !== 'reveal') return ''
  const found = truth?.pickedBy ?? []
  if (phase.authorId === you.playerId) {
    return found.length === 0 ? 'nobody got yours' : `${found.length} found yours`
  }
  if (found.includes(you.playerId)) return 'you found it'
  // didn't find it, but your own lie paid
  const yours = lies.find((l) => l.authorId === you.playerId)
  if (points > 0 && yours && yours.fooled.length > 0) return `${yours.fooled.length} fell for it`
  const fell = lies.find((l) => l.fooled.includes(you.playerId))
  if (fell) {
    const liar = players.find((p: Player) => p.id === fell.authorId)?.name
    return liar ? `${liar} fooled you` : 'fooled you'
  }
  return 'no guess this time'
}
