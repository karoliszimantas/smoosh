import { DEFAULT_SETTINGS, type GameSettings, type PhaseState, type Player, type RoomSnapshot } from '@smoosh/protocol'

// Fake game data, for the dev panel's "jump to phase", the solo walkthrough
// and component tests. Pictures use `solo/<playerId>` paths, which only the
// dev tools' picture component knows how to show.

export type FixturePhase = PhaseState['phase']

export const FIXTURE_PHASES: readonly FixturePhase[] = [
  'lobby',
  'build',
  'lie',
  'guess',
  'reveal',
  'missing',
  'rate',
  'rateResult',
  'scores',
]

export const YOU_ID = 'you'

export const FIXTURE_PLAYERS: Player[] = [
  { id: YOU_ID, name: 'Sam', isHost: true, presence: 'present', score: 1500 },
  { id: 'alice', name: 'Alice', isHost: false, presence: 'present', score: 2000 },
  { id: 'bob', name: 'Bob', isHost: false, presence: 'present', score: 500 },
  { id: 'cara', name: 'Cara', isHost: false, presence: 'present', score: 1000 },
]

const SAMPLE_PICTURES = ['/assets/test.jpg', '/assets/test2.jpg', '/assets/test3.jpg']

export function soloPicturePath(playerId: string): string {
  return `solo/${playerId}`
}

// a stand-in picture per player, the same one every time
export function samplePicture(playerId: string): string {
  let hash = 0
  for (const ch of playerId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return SAMPLE_PICTURES[hash % SAMPLE_PICTURES.length] ?? '/assets/test.jpg'
}

export type FixtureBase = {
  roomCode: string
  settings: GameSettings
  players: Player[]
  youId: string
}

export const FIXTURE_BASE: FixtureBase = {
  roomCode: 'TEST',
  settings: { ...DEFAULT_SETTINGS, rounds: 3 },
  players: FIXTURE_PLAYERS,
  youId: YOU_ID,
}

// a plausible snapshot for any phase, for the player `base.youId`. The
// picture on show is by someone else, so the "you're the author" variants
// need `authorId` set to you.
export function fixtureSnapshot(
  phase: FixturePhase,
  base: FixtureBase = FIXTURE_BASE,
  opts: { authorId?: string } = {},
): RoomSnapshot {
  const others = base.players.filter((p) => p.id !== base.youId)
  const authorId = opts.authorId ?? others[0]?.id ?? base.youId
  const liar = others.find((p) => p.id !== authorId)?.id ?? base.youId
  const now = Date.now()
  const round = 1
  const totalRounds = base.settings.rounds
  const picture = {
    round,
    totalRounds,
    pictureIndex: 1,
    pictureCount: base.players.length,
    authorId,
    imagePath: soloPicturePath(authorId),
  }
  const truth = { id: 'opt-truth', text: 'a cat riding a bicycle' }
  const yourLie = { id: 'opt-yours', text: 'a dog in a bathtub' }
  const theirLie = { id: 'opt-theirs', text: 'grandma at the beach' }
  const youWrite = authorId !== base.youId

  let state: PhaseState
  switch (phase) {
    case 'lobby':
      state = { phase: 'lobby' }
      break
    case 'build':
      state = { phase: 'build', round, totalRounds, deadline: now + 90_000, collecting: false }
      break
    case 'lie':
      state = { ...picture, phase: 'lie', deadline: now + 120_000 }
      break
    case 'guess':
      state = { ...picture, phase: 'guess', options: [theirLie, truth, yourLie], deadline: now + 120_000 }
      break
    case 'reveal':
      state = {
        ...picture,
        phase: 'reveal',
        options: [
          { ...theirLie, isTruth: false, authorId: liar, pickedBy: youWrite ? [base.youId] : [] },
          { ...truth, isTruth: true, authorId: null, pickedBy: [] },
          { ...yourLie, isTruth: false, authorId: base.youId, pickedBy: [liar] },
        ],
        realOptionId: truth.id,
        pointsThisPicture: [
          { playerId: base.youId, points: 500 },
          { playerId: liar, points: 500 },
        ],
        deadline: now + 8_000,
      }
      break
    case 'missing':
      state = {
        phase: 'missing',
        round,
        totalRounds,
        pictureIndex: picture.pictureIndex,
        pictureCount: picture.pictureCount,
        authorId,
        deadline: now + 4_000,
      }
      break
    case 'rate':
      state = { ...picture, phase: 'rate', prompt: 'a cat riding a bicycle', deadline: now + 120_000 }
      break
    case 'rateResult':
      state = {
        ...picture,
        phase: 'rateResult',
        prompt: 'a cat riding a bicycle',
        average: 3.7,
        counts: [0, 1, 0, 1, 1],
        points: 740,
        deadline: now + 6_000,
      }
      break
    case 'scores':
      state = {
        phase: 'scores',
        round,
        totalRounds,
        isFinalRound: false,
        scoreboard: base.players.map((p) => ({ playerId: p.id, total: p.score })),
        deadline: now + 6_000,
      }
      break
  }

  return {
    roomCode: base.roomCode,
    settings: base.settings,
    players: base.players,
    phase: state,
    waitingOn: phase === 'build' ? others.map((p) => p.id) : [],
    you: {
      playerId: base.youId,
      isHost: base.players.find((p) => p.id === base.youId)?.isHost ?? false,
      secretPrompt: phase === 'build' ? 'a cat riding a bicycle' : null,
      hasActedThisPhase: false,
      ownOptionId: phase === 'guess' ? yourLie.id : null,
      ownRating: null,
    },
  }
}
