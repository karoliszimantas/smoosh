import { z } from 'zod'

// Gallery judging: every player picks a FAVOURITE and a RUNNER-UP from the
// round's pictures (never their own). Awards are read off those same votes —
// no extra phase, no extra tapping. Pure, so the server, the solo walkthrough
// and the tests all get exactly the same answer.

export const FAVOURITE_POINTS = 2
export const RUNNER_UP_POINTS = 1

// Ranking two of two isn't a judgement: with fewer eligible pictures than
// this, the runner-up is optional
export const RUNNER_UP_REQUIRED_FROM = 3
export function runnerUpRequired(eligiblePictures: number): boolean {
  return eligiblePictures >= RUNNER_UP_REQUIRED_FROM
}

// announcement order — lowest first, building to Best in Show
export const AWARDS = ['honourable', 'everybodysSecond', 'divisive', 'second', 'best'] as const
export const AwardSchema = z.enum(AWARDS)
export type Award = z.infer<typeof AwardSchema>

export const AWARD_TITLES: Record<Award, string> = {
  best: 'Best in Show',
  second: 'Second Prize',
  divisive: 'Most Divisive',
  everybodysSecond: 'Everybody’s Second',
  honourable: 'Honourable Mention',
}

// Most Divisive: loved by some, passed over entirely by at least this many
export const DIVISIVE_MIN_ABSTAINERS = 2

export type GalleryVote = { voterId: string; favourite: string; runnerUp: string | null }

export type PictureResult = {
  authorId: string
  favourites: number
  runnerUps: number
  points: number
  award: Award | null
}

// `authors`: whose pictures were up for judging. Votes for anything else, for
// your own picture, or the same picture twice are ignored — the server never
// records one, but this mustn't trust that.
export function galleryResults(authors: readonly string[], votes: readonly GalleryVote[]): PictureResult[] {
  const results = authors.map((authorId) => ({ authorId, favourites: 0, runnerUps: 0, abstainers: 0 }))
  const byAuthor = new Map(results.map((r) => [r.authorId, r]))
  const valid = votes.filter(
    (v) =>
      byAuthor.has(v.favourite) &&
      v.favourite !== v.voterId &&
      (v.runnerUp === null || (byAuthor.has(v.runnerUp) && v.runnerUp !== v.voterId && v.runnerUp !== v.favourite)),
  )
  for (const v of valid) {
    const fav = byAuthor.get(v.favourite)
    if (fav) fav.favourites += 1
    const ru = v.runnerUp === null ? undefined : byAuthor.get(v.runnerUp)
    if (ru) ru.runnerUps += 1
  }
  // who judged and gave this picture nothing at all — someone who never
  // voted didn't pass it over, they just didn't judge
  for (const r of results) {
    r.abstainers = valid.filter((v) => v.voterId !== r.authorId && v.favourite !== r.authorId && v.runnerUp !== r.authorId).length
  }

  const out: (PictureResult & { abstainers: number })[] = results.map((r) => ({
    ...r,
    points: r.favourites * FAVOURITE_POINTS + r.runnerUps * RUNNER_UP_POINTS,
    award: null,
  }))
  // the award goes to every eligible, not-yet-awarded picture with the top
  // measure — a tie shares it rather than being broken arbitrarily. One
  // award per picture, highest first.
  const give = (award: Award, eligible: (r: (typeof out)[number]) => boolean, measure: (r: (typeof out)[number]) => number) => {
    const candidates = out.filter((r) => r.award === null && eligible(r))
    if (candidates.length === 0) return
    const top = Math.max(...candidates.map(measure))
    for (const r of candidates) if (measure(r) === top) r.award = award
  }
  give('best', (r) => r.favourites >= 1, (r) => r.favourites)
  give('second', (r) => r.points >= 1, (r) => r.points)
  // the picture that split the room: some made it their favourite, several
  // gave it nothing — the more evenly split, the more divisive
  give(
    'divisive',
    (r) => r.favourites >= 1 && r.abstainers >= DIVISIVE_MIN_ABSTAINERS,
    (r) => Math.min(r.favourites, r.abstainers),
  )
  give('everybodysSecond', (r) => r.favourites === 0 && r.runnerUps >= 1, (r) => r.runnerUps)
  // any vote at all is recognised. No votes: nothing — no consolation label
  for (const r of out) if (r.award === null && r.favourites + r.runnerUps > 0) r.award = 'honourable'

  return out.map((r) => ({
    authorId: r.authorId,
    favourites: r.favourites,
    runnerUps: r.runnerUps,
    points: r.points,
    award: r.award,
  }))
}

// the awards that were actually given, in announcement order
export function announcements(results: readonly PictureResult[]): Award[] {
  return AWARDS.filter((a) => results.some((r) => r.award === a))
}

// ---------- the reveal's pacing: grand type, short holds

// a title card first, then each award long enough to be read aloud, Best in
// Show a little longer, then the whole wall. At most five announcements
// (ties share one), so eight players take barely longer than three.
export const AWARDS_INTRO_MS = 1500
export const AWARD_STEP_MS = 2800
export const BEST_IN_SHOW_MS = 3500
export const AWARDS_HOLD_MS = 3000

export function awardsTimeline(order: readonly Award[]): { starts: number[]; wallAt: number; totalMs: number } {
  const starts: number[] = []
  let t = AWARDS_INTRO_MS
  for (const a of order) {
    starts.push(t)
    t += a === 'best' ? BEST_IN_SHOW_MS : AWARD_STEP_MS
  }
  return { starts, wallAt: t, totalMs: t + AWARDS_HOLD_MS }
}

// the longest a reveal can run — every award given
export const AWARDS_MAX_SEC = Math.ceil(awardsTimeline(AWARDS).totalMs / 1000)
