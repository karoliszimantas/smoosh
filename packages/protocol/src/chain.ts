import { z } from 'zod'

// Chain mode: exquisite corpse. A picture passes between players, each
// adding at most two layers while seeing earlier passes only as ghosts —
// apart from a strip along the bottom, shown as it is. Pure, so the server,
// the client and the tests all agree.

// How the room is split into chains — the host picks:
//   rotate: one picture per player, passed round the whole room. Every pass
//           everyone works on a different picture, so nobody ever waits.
//   groups: the same, inside groups of 3–4 (6 → 3+3, 7 → 4+3, 8 → 4+4).
//   single: one picture per group, passed member to member — the paper
//           game exactly, which means everyone else in the group waits.
export const CHAIN_STRUCTURES = ['rotate', 'groups', 'single'] as const
export const ChainStructureSchema = z.enum(CHAIN_STRUCTURES)
export type ChainStructure = z.infer<typeof ChainStructureSchema>

// at most this many layers a pass, at every time setting — any more and
// each player just builds their own picture over the last one
export const PASS_LAYER_CAP = 2
// the first pass composes from nothing, with a prompt to satisfy
export const FIRST_PASS_BONUS_SEC = 30
// the part of the canvas, from the bottom, that later passes see as it is
export const VISIBLE_STRIP = 0.2
// the most passes a chain takes when rotating
const ROTATION_PASSES = 3

export function passSeconds(pass: number, buildTimeSec: number): number {
  return buildTimeSec + (pass === 0 ? FIRST_PASS_BONUS_SEC : 0)
}

// Group sizes for a room of n. Rotation needs nobody left over, so groups
// are 3 or 4; five is one group (3+2 would leave a pair either idle for a
// pass or with two-pass pictures). One-picture chains take the brief's
// split as written, 5 → 3+2 included.
export function groupSizes(n: number, structure: ChainStructure): number[] {
  if (structure === 'rotate' || (structure === 'groups' && n < 6)) return [n]
  if (n <= 4) return [n]
  const k = Math.ceil(n / 4)
  const base = Math.floor(n / k)
  return Array.from({ length: k }, (_, i) => base + (i < n % k ? 1 : 0))
}

export type ChainPlan = {
  passCount: number
  // per chain: who adds to it on each pass — null where the chain is done
  chains: { authors: (string | null)[] }[]
}

// Which player adds to which chain on which pass.
//
// Rotating, a group of g makes g pictures; on pass k picture i goes to the
// member k places on from the one who started it, so every pass is a
// shuffle of the same players — everybody busy, every picture a different
// hand each pass. Chains are 3 passes, one shorter when the room is a
// single group: otherwise in a room of 3 everyone touches every picture
// and has none left to vote for.
export function planChains(players: readonly string[], structure: ChainStructure): ChainPlan {
  const sizes = groupSizes(players.length, structure)
  const groups: string[][] = []
  let at = 0
  for (const size of sizes) {
    groups.push(players.slice(at, at + size))
    at += size
  }

  if (structure === 'single') {
    const passCount = Math.max(...sizes)
    return {
      passCount,
      chains: groups.map((g) => ({ authors: Array.from({ length: passCount }, (_, k) => g[k] ?? null) })),
    }
  }

  const single = groups.length === 1
  const length = Math.max(1, Math.min(...sizes.map((g) => (single ? Math.min(ROTATION_PASSES, g - 1) : Math.min(ROTATION_PASSES, g)))))
  const chains = groups.flatMap((g) =>
    g.map((_, i) => ({ authors: Array.from({ length }, (_, k) => g[(i + k) % g.length] ?? null) })),
  )
  return { passCount: length, chains }
}

export function chainCount(players: number, structure: ChainStructure): number {
  return structure === 'single' ? groupSizes(players, structure).length : players
}

// ---------- the vote

// Best in Show's prize: the same 4200 a round is worth in Guess, shared
// between the winning chains (a tie shares it), then equally between each
// chain's artists — three artists, 1400 each. Rounded down to whole points.
export const CHAIN_PRIZE = 4200

export type ChainResult = { chainId: string; votes: number; best: boolean; pointsEach: number }

// `contributors`: who actually added to each chain (a skipped pass isn't
// a contribution). A vote for your own chain counts for nothing.
export function chainResults(
  contributors: ReadonlyMap<string, readonly string[]>,
  votes: ReadonlyMap<string, string>,
): ChainResult[] {
  const tally = new Map<string, number>([...contributors.keys()].map((id) => [id, 0]))
  for (const [voter, chainId] of votes) {
    const authors = contributors.get(chainId)
    if (!authors || authors.includes(voter)) continue
    tally.set(chainId, (tally.get(chainId) ?? 0) + 1)
  }
  const top = Math.max(0, ...tally.values())
  const winners = [...tally].filter(([, v]) => top > 0 && v === top).length
  return [...tally].map(([chainId, v]) => {
    const best = top > 0 && v === top
    const artists = contributors.get(chainId)?.length ?? 1
    return { chainId, votes: v, best, pointsEach: best ? Math.floor(CHAIN_PRIZE / winners / artists) : 0 }
  })
}

// ---------- the reveal's pacing

// Each chain in turn: all of it as ghosts, then its passes resolve one at a
// time, then the prompt it started from, then its placard.
export const CHAIN_INTRO_MS = 1200
export const CHAIN_PASS_MS = 2200
export const CHAIN_PROMPT_MS = 2400
export const CHAIN_PLACARD_MS = 2600

export function chainRevealTimeline(passesPerChain: readonly number[]): { starts: number[]; totalMs: number } {
  const starts: number[] = []
  let t = 0
  for (const passes of passesPerChain) {
    starts.push(t)
    t += CHAIN_INTRO_MS + passes * CHAIN_PASS_MS + CHAIN_PROMPT_MS + CHAIN_PLACARD_MS
  }
  return { starts, totalMs: t }
}

export const CHAIN_AWARDS_SEC = 8
