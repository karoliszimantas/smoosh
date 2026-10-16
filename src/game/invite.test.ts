import { describe, it, expect, vi } from 'vitest'
import { copyText, invitesOpen, inviteLink, parseJoinCode, shareInvite } from './invite'
import { joinFailedText } from './roomMessages'
import { fixtureSnapshot } from '../dev/fixtures'

const site = { origin: 'https://smoosh.example', base: '/' }

describe('the invite link', () => {
  it('is the home screen, carrying the room code', () => {
    expect(inviteLink('KRPT', site)).toBe('https://smoosh.example/?join=KRPT')
    expect(inviteLink('krpt', site)).toBe('https://smoosh.example/?join=KRPT')
  })

  it('keeps to the app’s base path', () => {
    expect(inviteLink('KRPT', { origin: 'http://192.168.1.20:5173', base: '/play/' })).toBe(
      'http://192.168.1.20:5173/play/?join=KRPT',
    )
    expect(inviteLink('KRPT', { origin: 'https://x.dev', base: '/play' })).toBe('https://x.dev/play/?join=KRPT')
  })

  it('reads back as the same code', () => {
    expect(parseJoinCode(new URL(inviteLink('BCDF', site)).search)).toBe('BCDF')
  })
})

describe('reading ?join=', () => {
  it('takes a code in any case', () => {
    expect(parseJoinCode('?join=krpt')).toBe('KRPT')
    expect(parseJoinCode('?join=KrPt&x=1')).toBe('KRPT')
    expect(parseJoinCode('join= krpt ')).toBe('KRPT')
  })

  it('ignores anything a room code can’t be', () => {
    expect(parseJoinCode('')).toBeNull()
    expect(parseJoinCode('?code=KRPT')).toBeNull()
    expect(parseJoinCode('?join=')).toBeNull()
    expect(parseJoinCode('?join=KRP')).toBeNull()
    expect(parseJoinCode('?join=KRPTS')).toBeNull()
    // no vowels in a room code
    expect(parseJoinCode('?join=ABCD')).toBeNull()
    expect(parseJoinCode('?join=12AB')).toBeNull()
    expect(parseJoinCode('?join=%3Cscript%3E')).toBeNull()
  })
})

const abort = () => Object.assign(new Error('Share canceled'), { name: 'AbortError' })

describe('sharing an invite', () => {
  it('opens the share sheet where there is one', async () => {
    const share = vi.fn(async () => {})
    const writeText = vi.fn(async () => {})
    expect(await shareInvite('KRPT', { share, clipboard: { writeText } } as never, site)).toBe('shared')
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://smoosh.example/?join=KRPT' }))
    expect(writeText).not.toHaveBeenCalled()
  })

  it('does nothing more when the sheet is closed', async () => {
    const writeText = vi.fn(async () => {})
    const nav = { share: async () => Promise.reject(abort()), clipboard: { writeText } }
    expect(await shareInvite('KRPT', nav as never, site)).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies the link instead, without a share sheet or when it fails', async () => {
    const writeText = vi.fn(async () => {})
    expect(await shareInvite('KRPT', { clipboard: { writeText } } as never, site)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('https://smoosh.example/?join=KRPT')
    const refused = { share: async () => Promise.reject(new Error('NotAllowedError')), clipboard: { writeText } }
    expect(await shareInvite('KRPT', refused as never, site)).toBe('copied')
  })

  it('says so when it can’t even copy', async () => {
    const nav = { clipboard: { writeText: async () => Promise.reject(new Error('denied')) } }
    expect(await shareInvite('KRPT', nav as never, site)).toBe('failed')
    expect(await copyText('x', nav as never)).toBe(false)
    expect(await copyText('x', {} as never)).toBe(false)
  })
})

describe('inviting, only while someone could get in', () => {
  it('in the lobby and on the final scores, not while a game runs', () => {
    expect(invitesOpen(fixtureSnapshot('lobby'))).toBe(true)
    expect(invitesOpen(fixtureSnapshot('scores', undefined, { final: true }))).toBe(true)
    for (const phase of ['build', 'lie', 'guess', 'reveal', 'missing', 'scores', 'vote', 'awards'] as const) {
      expect(invitesOpen(fixtureSnapshot(phase))).toBe(false)
    }
  })

  it('a latecomer is told what to do next', () => {
    expect(joinFailedText('ABCD', 'ALREADY_STARTED')).toBe(
      'Game ABCD has already started. Ask the host to invite you after this game.',
    )
  })
})
