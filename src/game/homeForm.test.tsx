import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import HomeView from './HomeView'
import {
  checkHome,
  cleanRoomCode,
  CODE_LENGTH_TEXT,
  homeButtonLabel,
  NAME_NEEDED_TEXT,
  rememberedName,
  rememberName,
} from './homeForm'

const emit = () => Promise.reject(new Error('not used'))
const noop = () => {}

function memoryStore() {
  const data = new Map<string, string>()
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

describe('the home button follows the code', () => {
  it('no code: a new game. Four letters: that game. Part of one: Join', () => {
    expect(homeButtonLabel('')).toBe('Create game')
    expect(homeButtonLabel('ABCD')).toBe('Join ABCD')
    expect(homeButtonLabel('AB')).toBe('Join')
  })

  it('waiting for the connection, says so', () => {
    expect(homeButtonLabel('ABCD', true)).toBe('Connecting…')
    expect(homeButtonLabel('', true)).toBe('Connecting…')
  })

  it('takes a code as letters, in capitals, four at most', () => {
    expect(cleanRoomCode('bcdf')).toBe('BCDF')
    expect(cleanRoomCode(' bc-df ')).toBe('BCDF')
    expect(cleanRoomCode('BCDFG')).toBe('BCDF')
  })
})

describe('what a tap does', () => {
  it('creates with no code, joins with a full one', () => {
    expect(checkHome(' Mara ', '')).toEqual({ ok: true, intent: { kind: 'create', name: 'Mara' } })
    expect(checkHome('Mara', 'BCDF')).toEqual({ ok: true, intent: { kind: 'join', name: 'Mara', code: 'BCDF' } })
  })

  it('without a name, asks for it calmly — whichever it was going to do', () => {
    expect(checkHome('  ', '')).toEqual({ ok: false, field: 'name', hint: NAME_NEEDED_TEXT })
    expect(checkHome('', 'BCDF')).toEqual({ ok: false, field: 'name', hint: NAME_NEEDED_TEXT })
    expect(NAME_NEEDED_TEXT).toBe('Your name, so the others know who’s who')
  })

  it('with part of a code, points at the code', () => {
    expect(checkHome('Mara', 'BC')).toEqual({ ok: false, field: 'code', hint: CODE_LENGTH_TEXT })
    expect(CODE_LENGTH_TEXT).toBe('Room codes are 4 letters')
  })
})

describe('the remembered name', () => {
  it('is kept for next time', () => {
    const store = memoryStore()
    expect(rememberedName(store)).toBe('')
    rememberName(' Mara ', store)
    expect(rememberedName(store)).toBe('Mara')
  })

  it('with storage refusing, is simply typed again', () => {
    const refusing = {
      getItem: (): string | null => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(() => rememberName('Mara', refusing)).not.toThrow()
    expect(rememberedName(refusing)).toBe('')
  })
})

describe('the home screen', () => {
  afterEach(() => vi.unstubAllGlobals())

  const render = (opts: { lastRoomCode?: string | null; connected?: boolean } = {}) =>
    renderToStaticMarkup(
      <HomeView
        emit={emit}
        connectionStatus={opts.connected === false ? 'connecting' : 'connected'}
        onSandbox={noop}
        notice={null}
        lastRoomCode={opts.lastRoomCode ?? null}
      />,
    )

  it('is one form, with no Create/Join tabs and the code always open', () => {
    const html = render()
    expect(html).toContain('<form class="home-form" noValidate="">')
    expect(html).not.toContain('role="tablist"')
    expect(html).not.toContain('role="tab"')
    expect(html).not.toMatch(/<input[^>]*id="home-code"[^>]*disabled/)
    expect(html).toContain('type="submit" class="btn btn-primary btn-block home-go">Create game</button>')
  })

  it('offers the last game back by its code', () => {
    expect(render({ lastRoomCode: 'BCDF' })).toContain('home-go">Join BCDF</button>')
  })

  it('never shuts the button while connecting', () => {
    const html = render({ connected: false })
    expect(html).toContain('home-go">Create game</button>')
    expect(html).not.toMatch(/home-go"[^>]*disabled/)
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*home-go/)
  })

  it('fills in the name it remembers', () => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'smoosh_name' ? 'Mara' : null), setItem: noop })
    expect(render()).toMatch(/<input[^>]*id="home-name"[^>]*value="Mara"/)
  })
})
