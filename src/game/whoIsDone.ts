import type { Player, PhaseState, RoomSnapshot } from '@smoosh/protocol'

// done: has answered this phase. pending: the room is still waiting on
// them. away: not here (whether or not the room still waits). here: a
// phase nobody answers (Reveal, Scores) — just who's playing.
export type DotState = 'done' | 'pending' | 'away' | 'here'
export type DoneDot = { player: Player; state: DotState }

// [one person, several, you alone] — "Mara is done", "Mara and Teo are
// done", "You are done"
type Verb = readonly [string, string, string]
const verb = (one: string, many: string, you = many): Verb => [one, many, you]

const ACTING: Partial<Record<PhaseState['phase'], { done: Verb; pending: Verb }>> = {
  build: { done: verb('is done', 'are done'), pending: verb('is still building', 'are still building') },
  pass: { done: verb('is done', 'are done'), pending: verb('is still building', 'are still building') },
  lie: {
    done: verb('has sent a lie', 'have sent lies', 'have sent a lie'),
    pending: verb('is still writing', 'are still writing'),
  },
  guess: { done: verb('has locked in', 'have locked in'), pending: verb('is still choosing', 'are still choosing') },
  vote: { done: verb('has voted', 'have voted'), pending: verb('is still voting', 'are still voting') },
  chainVote: { done: verb('has voted', 'have voted'), pending: verb('is still voting', 'are still voting') },
}
const AWAY = verb('is away', 'are away')

// "Mara", "Mara and Teo", "Mara, Teo and you" — you last, in lower case
function names(people: readonly Player[], youId: string): string {
  const others = people.filter((p) => p.id !== youId).map((p) => p.name)
  const all = people.some((p) => p.id === youId) ? [...others, 'you'] : others
  if (all.length <= 1) return all.join('')
  return `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`
}

function clause(people: readonly Player[], youId: string, [one, many, you]: Verb): string {
  if (people.length === 0) return ''
  const who = names(people, youId)
  const said = people.length > 1 ? many : people[0]?.id === youId ? you : one
  return `${who.charAt(0).toUpperCase()}${who.slice(1)} ${said}.`
}

// Everyone this phase is for, in seat order, and where each of them is
// with it — from the server's own waitingOn and presence, as RoomProgress
// reads them. Who left is gone from it; the picture's author isn't asked
// to lie about or guess their own picture, so they're left out too.
export function whoIsDone(snapshot: RoomSnapshot): { dots: DoneDot[]; label: string } {
  const { phase, waitingOn, you } = snapshot
  const author = phase.phase === 'lie' || phase.phase === 'guess' ? phase.authorId : null
  const waiting = new Set(waitingOn)
  const acting = ACTING[phase.phase]
  const players = snapshot.players.filter((p) => p.presence !== 'left' && p.id !== author)

  const dots: DoneDot[] = players.map((player) => ({
    player,
    state: player.presence === 'away' ? 'away' : !acting ? 'here' : waiting.has(player.id) ? 'pending' : 'done',
  }))
  const inState = (state: DotState) => dots.filter((d) => d.state === state).map((d) => d.player)

  const parts = acting
    ? [clause(inState('done'), you.playerId, acting.done), clause(inState('pending'), you.playerId, acting.pending)]
    : [inState('here').length > 0 ? `Playing: ${names(inState('here'), you.playerId)}.` : '']
  parts.push(clause(inState('away'), you.playerId, AWAY))
  return { dots, label: parts.filter(Boolean).join(' ') }
}
