import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LeaveDialog from './LeaveDialog'
import PresenceStrip from './PresenceStrip'
import GameMenu from './GameMenu'
import { joinFailedText, leaveDialogText, leftText, rejoinFailedText, roomEventText } from './roomMessages'
import { clearActiveRoom, getActiveRoom, getSessionId, setActiveRoom } from './session'
import { fixtureSnapshot, FIXTURE_BASE, YOU_ID } from '../dev/fixtures'

// Comings and goings: the words players read, and the identity that brings
// them back. Today's wording is pinned — change a test along with the words.

const noop = () => {}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// a Map behind the Storage interface — node has no localStorage
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  }
}

describe('stored identity', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
  })

  it('the session id is made once and kept — in localStorage, so it outlives the tab', () => {
    const id = getSessionId()
    expect(getSessionId()).toBe(id)
    expect(localStorage.getItem('smoosh_session_id')).toBe(id)
  })

  it('a tab from before keeps the session it already had', () => {
    sessionStorage.setItem('smoosh_session_id', 'older-session')
    expect(getSessionId()).toBe('older-session')
  })

  it('remembers the room, player and name together, until cleared', () => {
    setActiveRoom({ roomCode: 'ABCD', playerId: 'p-1', name: 'Sam' })
    expect(getActiveRoom()).toEqual({ roomCode: 'ABCD', playerId: 'p-1', name: 'Sam' })
    clearActiveRoom()
    expect(getActiveRoom()).toBeNull()
  })

  it('ignores a stored room it cannot make sense of', () => {
    localStorage.setItem('smoosh_active_room', '{"roomCode":5}')
    expect(getActiveRoom()).toBeNull()
    localStorage.setItem('smoosh_active_room', 'not json')
    expect(getActiveRoom()).toBeNull()
  })
})

describe('what players read', () => {
  it('someone leaving, calmly, by name', () => {
    expect(roomEventText({ type: 'left', playerId: 'p2', name: 'Alice' }, 'p1')).toBe('Alice left the game.')
  })

  it('a new host, by name — or you', () => {
    expect(roomEventText({ type: 'hostChanged', playerId: 'p2', name: 'Alice' }, 'p1')).toBe('Alice is the host now.')
    expect(roomEventText({ type: 'hostChanged', playerId: 'p1', name: 'Sam' }, 'p1')).toBe('You’re the host now.')
  })

  it('what you missed while away', () => {
    const base = { type: 'caughtUp', picturesMissed: 0, pointsGained: 0, rank: 2, playerCount: 4 } as const
    expect(roomEventText({ ...base, roundsFinished: 1, pointsGained: 500 }, 'p1')).toBe(
      'While you were away, a round finished. You’re 2nd of 4 (+500).',
    )
    expect(roomEventText({ ...base, roundsFinished: 2, rank: 1 }, 'p1')).toBe(
      'While you were away, 2 rounds finished. You’re 1st of 4.',
    )
    expect(roomEventText({ ...base, roundsFinished: 0, picturesMissed: 3, rank: 3 }, 'p1')).toBe(
      'While you were away, 3 pictures went by. You’re 3rd of 4.',
    )
  })

  it('a game that can’t be picked back up — plain words, never an error code', () => {
    expect(rejoinFailedText('ABCD', 'ROOM_NOT_FOUND')).toBe('Game ABCD has finished. Start a new one, or join another.')
    for (const code of ['ROOM_NOT_FOUND', 'ALREADY_STARTED', 'INVALID_PAYLOAD'] as const) {
      expect(rejoinFailedText('ABCD', code)).not.toMatch(/[A-Z]{2,}_[A-Z]+/)
      expect(joinFailedText('ABCD', code)).not.toMatch(/[A-Z]{2,}_[A-Z]+/)
    }
    expect(joinFailedText('WXYZ', 'ROOM_NOT_FOUND')).toBe('There’s no game with the code WXYZ. Check the code?')
  })

  it('after leaving, how to come back', () => {
    expect(leftText('ABCD')).toBe('You left game ABCD. You can rejoin with the code.')
  })
})

describe('leaving', () => {
  it('the question says what happens to everyone else, and offers Stay and Leave', () => {
    const html = renderToStaticMarkup(
      <LeaveDialog roomCode="ABCD" isLobby={false} isHost={false} onLeave={noop} onStay={noop} />,
    )
    expect(html).toContain('role="dialog"')
    expect(textOf(html)).toContain(
      'Leave the game? The others will keep playing without you. You can rejoin with the room code ABCD.',
    )
    expect([...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])).toEqual(['Stay', 'Leave'])
  })

  it('the host is told someone else takes over', () => {
    expect(leaveDialogText({ roomCode: 'ABCD', isLobby: false, isHost: true }).body).toContain(
      'Someone else will become the host.',
    )
  })

  it('in the lobby, it’s a room not a game', () => {
    expect(leaveDialogText({ roomCode: 'ABCD', isLobby: true, isHost: false })).toEqual({
      title: 'Leave this room?',
      body: 'The others can still start without you. You can join again with the code ABCD.',
    })
  })

  it('sits behind a menu, not out in the open', () => {
    const html = renderToStaticMarkup(<GameMenu roomCode="ABCD" isLobby={false} onLeave={noop} />)
    expect(textOf(html)).toBe('⋯')
    expect(html).toContain('aria-label="Game menu"')
    expect(html).not.toContain('Leave')
  })
})

describe('the player strip', () => {
  it('marks someone away quietly, leaves out who left, and calls you You', () => {
    const snapshot = fixtureSnapshot('reveal')
    snapshot.players = FIXTURE_BASE.players.map((p) =>
      p.id === 'bob' ? { ...p, presence: 'away' } : p.id === 'cara' ? { ...p, presence: 'left' } : p,
    )
    const html = renderToStaticMarkup(<PresenceStrip snapshot={snapshot} />)
    expect(textOf(html)).toBe('You Alice Bob away')
    expect(html).toContain('<li class="away">Bob')
    expect(snapshot.you.playerId).toBe(YOU_ID)
  })
})
