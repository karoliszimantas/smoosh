import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RoomSnapshot } from '@smoosh/protocol'
import GuessView from './phases/GuessView'
import { fixtureSnapshot, YOU_ID } from '../dev/fixtures'
import VoteView from './phases/VoteView'
import NoticeRegion from './NoticeRegion'
import { isStuck } from './stuckWatchdog'
import { STUCK_TEXT } from './roomMessages'

// Screens a player can land on with nothing they can press. Each must say
// why — a dead screen with no words reads as a frozen game.

const emit = () => Promise.reject(new Error('not used'))

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

// the guess screen as a reload into it finds it: the server has their guess
function guessedAlready(): RoomSnapshot {
  const snap = fixtureSnapshot('guess')
  const phase = snap.phase
  if (phase.phase !== 'guess') throw new Error('fixture')
  const theirs = phase.options.find((o) => o.id !== snap.you.ownOptionId)
  return { ...snap, you: { ...snap.you, hasActedThisPhase: true, ownGuessId: theirs?.id ?? null } }
}

describe('a reload into GUESS after guessing', () => {
  it('says the guess is in, rather than showing every option dead', () => {
    const text = textOf(renderToStaticMarkup(<GuessView snapshot={guessedAlready()} emit={emit} />))
    expect(text).toContain('Guess locked in — waiting for the others…')
  })

  it('still shows which option they picked', () => {
    const snap = guessedAlready()
    const html = renderToStaticMarkup(<GuessView snapshot={snap} emit={emit} />)
    const picked = [...html.matchAll(/<button[^>]*class="guess-option picked"[^>]*>([^<]*)</g)].map((m) => m[1])
    const phase = snap.phase
    if (phase.phase !== 'guess') throw new Error('fixture')
    expect(picked).toEqual([phase.options.find((o) => o.id === snap.you.ownGuessId)?.text])
  })
})

describe('the stuck-screen watchdog', () => {
  const guessing = () => {
    const snap = fixtureSnapshot('guess')
    return { ...snap, waitingOn: [snap.you.playerId] }
  }

  it('fires on a broken snapshot: waited on, nothing to press', () => {
    // the server waits on this player, but the screen offers no control
    expect(isStuck(guessing(), 0)).toBe(true)
  })

  it('stays quiet when there is something to press', () => {
    expect(isStuck(guessing(), 3)).toBe(false)
  })

  it('stays quiet when the room is not waiting on them (the author, or already acted)', () => {
    const snap = fixtureSnapshot('guess')
    expect(isStuck({ ...snap, waitingOn: [] }, 0)).toBe(false)
    expect(isStuck({ ...guessing(), you: { ...snap.you, hasActedThisPhase: true } }, 0)).toBe(false)
  })

  it('stays quiet in phases that ask nothing of anyone', () => {
    const snap = fixtureSnapshot('reveal')
    expect(isStuck({ ...snap, waitingOn: [snap.you.playerId] }, 0)).toBe(false)
  })

  it('says so with a way out, not a dismiss', () => {
    const html = renderToStaticMarkup(
      <NoticeRegion alert={STUCK_TEXT} alertAction={{ label: 'Rejoin', onClick: () => {} }} toasts={[]} onToastDone={() => {}} />,
    )
    expect(textOf(html)).toBe('Your screen has stopped responding. Rejoin')
    expect(html).not.toContain('Dismiss')
  })
})

describe('waiting looks like waiting', () => {
  it('the author, during guessing on their own picture: why, a count, and who', () => {
    const snap = fixtureSnapshot('guess', undefined, { authorId: YOU_ID })
    const html = renderToStaticMarkup(
      <GuessView snapshot={{ ...snap, waitingOn: ['bob', 'cara'] }} emit={emit} />,
    )
    const text = textOf(html)
    expect(text).toContain('This one’s yours — waiting for everyone else to guess.')
    // Alice has guessed; Bob and Cara haven't (Sam is the author)
    expect(text).toContain('1 of 3 have guessed')
    expect(text).toContain('Waiting for Bob and Cara')
    expect(html).toContain('picture-display')
  })

  it('away players are marked apart from slow ones; one the room stopped waiting on is not counted as done', () => {
    const snap = fixtureSnapshot('vote')
    const players = snap.players.map((p) =>
      p.id === 'bob' ? { ...p, presence: 'away' as const } : p.id === 'cara' ? { ...p, presence: 'away' as const } : p,
    )
    // Bob is away but still waited on (inside the grace); Cara is away and dropped
    const voted = { ...snap, players, waitingOn: ['bob'], you: { ...snap.you, hasActedThisPhase: true } }
    const html = renderToStaticMarkup(<VoteView snapshot={voted} emit={emit} />)
    expect(textOf(html)).toContain('2 of 3 have voted')
    expect(html).toContain('Bob<span class="away-marker">away</span>')
    expect(textOf(html)).not.toContain('Cara')
  })

  it('an own lie says why it cannot be picked', () => {
    expect(textOf(renderToStaticMarkup(<GuessView snapshot={fixtureSnapshot('guess')} emit={emit} />))).toContain('your lie')
  })
})
