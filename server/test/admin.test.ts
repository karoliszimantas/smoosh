import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type http from 'node:http'
import type { AdminMe } from '@smoosh/protocol'
import { PromptStore, type PoolBackend } from '../src/prompts/store.ts'
import { setPromptStoreForTests } from '../src/prompts/routes.ts'
import { setGoogleTokenFetchForTests } from '../src/admin/google.ts'
import { logTail } from '../src/ops/logTail.ts'
import { adminEnv, BREAK_GLASS, sessionCookie, startAdminServer } from './adminHelpers.ts'

let server: http.Server
let origin = ''
beforeAll(async () => {
  adminEnv()
  ;({ server, origin } = await startAdminServer())
})
afterAll(() => server.close())

function memoryPool(initial: unknown) {
  const state = { json: JSON.stringify(initial) as string | null }
  const backend: PoolBackend = { name: 'memory', load: async () => state.json, save: async (json) => void (state.json = json) }
  return { state, backend }
}

const as = (email: string | null, path: string, init: RequestInit = {}) =>
  fetch(`${origin}/api/admin${path}`, {
    ...init,
    redirect: 'manual',
    headers: {
      ...(email ? { cookie: sessionCookie(email) } : {}),
      ...(init.method && init.method !== 'GET' ? { origin, 'Content-Type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  })

const me = async (email: string) => (await (await as(email, '/me')).json()) as AdminMe

describe('who reaches what', () => {
  it('an address on the base list gets prompts and labels, credited as @local-part', async () => {
    expect(await me('karolis@example.com')).toMatchObject({ name: '@karolis', sections: ['prompts', 'labels'], via: 'google' })
    expect((await as('karolis@example.com', '/prompts')).status).toBe(200)
  })

  it('logs only for the logs list — absent from the sections, and refused when asked for anyway', async () => {
    expect((await me('ana@example.com')).sections).toEqual(['prompts', 'labels', 'logs'])
    expect((await as('ana@example.com', '/logs')).status).toBe(200)
    const refused = await as('karolis@example.com', '/logs')
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: 'no_access', message: 'You don’t have access to that.' })
  })

  it('the list is case-blind', async () => {
    expect((await me('ben@example.com')).sections).toEqual(['prompts', 'labels'])
  })

  it('an address on neither list gets a plain refusal, nothing else', async () => {
    const res = await as('mallory@example.com', '/me')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'no_access', message: 'You don’t have access.' })
  })

  it('taking someone off the list shuts them out, whatever their cookie says', async () => {
    const before = process.env.ADMIN_EMAILS
    process.env.ADMIN_EMAILS = 'ana@example.com'
    try {
      expect((await as('karolis@example.com', '/me')).status).toBe(403)
    } finally {
      process.env.ADMIN_EMAILS = before
    }
  })

  it('no cookie, a forged cookie, an expired cookie: signed out', async () => {
    expect((await as(null, '/me')).status).toBe(401)
    const forged = sessionCookie('mallory@example.com').replace(/\.[^.]+$/, '.AAAA')
    expect((await as(null, '/me', { headers: { cookie: forged } })).status).toBe(401)
    const expired = sessionCookie('ana@example.com', { exp: Date.now() - 1 })
    expect((await as(null, '/me', { headers: { cookie: expired } })).status).toBe(401)
    // the shared code of old opens nothing
    expect((await as(null, '/prompts', { headers: { 'x-prompt-code': 'letmein', 'x-prompt-author': 'Ana' } })).status).toBe(401)
  })

  it('a write from another site is refused, session or not', async () => {
    const res = await as('ana@example.com', '/prompts', {
      method: 'POST',
      body: JSON.stringify({ text: 'Sneaky', mode: 'guess' }),
      headers: { origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
  })
})

describe('credit for edits', () => {
  let pool: ReturnType<typeof memoryPool>['state']
  // written by a typed name, before sign-in existed
  const old = {
    id: 'p1',
    text: 'A Typed Name Wrote This',
    mode: 'guess',
    author: 'Karolis',
    createdAt: '2026-09-01T10:00:00.000Z',
    archived: false,
    votes: { karolis: 1, ana: -1 },
    buildCount: 3,
  }
  beforeEach(() => {
    const memory = memoryPool({ version: 1, prompts: [old] })
    pool = memory.state
    setPromptStoreForTests(new PromptStore(memory.backend))
  })

  it('a new prompt and a vote go to the signed-in account; the typed-name prompt is left exactly as it was', async () => {
    const added = await as('ana@example.com', '/prompts', { method: 'POST', body: JSON.stringify({ text: 'Signed In Wrote This', mode: 'guess' }) })
    expect(added.status).toBe(200)
    await as('ben@example.com', '/prompts/p1/vote', { method: 'POST', body: JSON.stringify({ vote: 1 }) })
    const stored = JSON.parse(pool.json ?? '') as { prompts: (typeof old)[] }
    expect(stored.prompts.find((p) => p.text === 'Signed In Wrote This')?.author).toBe('@ana')
    const p1 = stored.prompts.find((p) => p.id === 'p1')
    expect(p1).toEqual({ ...old, votes: { karolis: 1, ana: -1, '@ben': 1 } })
  })
})

describe('Google sign-in', () => {
  afterEach(() => setGoogleTokenFetchForTests(null))

  const idToken = (claims: Record<string, unknown>) =>
    ['x', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.')
  const goodClaims = (email: string) => ({
    iss: 'https://accounts.google.com',
    aud: 'client-id.apps.googleusercontent.com',
    exp: Math.floor(Date.now() / 1000) + 600,
    email,
    email_verified: true,
  })

  // start → (Google) → callback, with Google's answer stood in for
  async function signIn(claims: Record<string, unknown>, next = '/admin/labels') {
    const start = await as(null, `/auth/start?next=${encodeURIComponent(next)}`)
    expect(start.status).toBe(302)
    const google = new URL(start.headers.get('location') ?? '')
    expect(google.origin).toBe('https://accounts.google.com')
    expect(google.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/admin/auth/callback')
    expect(google.searchParams.get('code_challenge_method')).toBe('S256')
    const flowCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    let sent: URLSearchParams | null = null
    setGoogleTokenFetchForTests(async (body) => {
      sent = body
      return { id_token: idToken(claims) }
    })
    const back = await as(null, `/auth/callback?code=abc&state=${google.searchParams.get('state') ?? ''}`, { headers: { cookie: flowCookie } })
    return { back, sent: sent as URLSearchParams | null }
  }

  it('an allowlisted account comes back signed in, to where it was going', async () => {
    const { back, sent } = await signIn(goodClaims('ana@example.com'))
    expect(back.status).toBe(302)
    expect(back.headers.get('location')).toBe('/admin/labels')
    expect(sent?.get('code_verifier')).toBeTruthy()
    const cookies = back.headers.getSetCookie()
    const session = cookies.find((c) => c.startsWith('smoosh_admin='))
    expect(session).toMatch(/HttpOnly/)
    expect(session).toMatch(/SameSite=Lax/)
    expect(session).toMatch(/Path=\/api\/admin/)
    expect(session).toMatch(/Max-Age=2592000/)
    const meRes = await as(null, '/me', { headers: { cookie: session?.split(';')[0] ?? '' } })
    expect(((await meRes.json()) as AdminMe).name).toBe('@ana')
  })

  it('an account on neither list is turned away in plain words, with no session', async () => {
    const { back } = await signIn(goodClaims('mallory@example.com'))
    expect(back.headers.get('location')).toBe('/admin?signin=denied')
    expect(back.headers.getSetCookie().some((c) => c.startsWith('smoosh_admin=') && !c.startsWith('smoosh_admin=;'))).toBe(false)
  })

  it('an unverified email, or a token for another app, is not a sign-in', async () => {
    expect((await signIn({ ...goodClaims('ana@example.com'), email_verified: false })).back.headers.get('location')).toBe('/admin?signin=failed')
    expect((await signIn({ ...goodClaims('ana@example.com'), aud: 'someone-else' })).back.headers.get('location')).toBe('/admin?signin=failed')
  })

  it('a callback without the sign-in that started it fails', async () => {
    const res = await as(null, '/auth/callback?code=abc&state=made-up')
    expect(res.headers.get('location')).toBe('/admin?signin=failed')
  })

  it('never sends anyone outside /admin afterwards', async () => {
    const { back } = await signIn(goodClaims('ana@example.com'), 'https://evil.example')
    expect(back.headers.get('location')).toBe('/admin')
  })
})

describe('signing out', () => {
  it('clears the cookie', async () => {
    const res = await as('ana@example.com', '/auth/signout', { method: 'POST' })
    expect(res.status).toBe(204)
    expect(res.headers.get('set-cookie')).toMatch(/^smoosh_admin=; Path=\/api\/admin; Max-Age=0/)
  })
})

describe('break-glass', () => {
  it('opens every section for an hour, and says so loudly — every request too', async () => {
    const shouted = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await as(null, '/auth/break-glass', { method: 'POST', body: JSON.stringify({ token: BREAK_GLASS }) })
      expect(res.status).toBe(200)
      const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
      expect(res.headers.get('set-cookie')).toMatch(/Max-Age=3600/)
      const meRes = await as(null, '/me', { headers: { cookie } })
      expect(await meRes.json()).toMatchObject({ name: '@break-glass', via: 'break-glass', sections: ['prompts', 'labels', 'logs'] })
      const said = shouted.mock.calls.map((c) => String(c[0])).join('\n')
      expect(said).toMatch(/BREAK-GLASS SIGN-IN/)
      expect(said).toMatch(/BREAK-GLASS request: GET \/api\/admin\/me/)
    } finally {
      shouted.mockRestore()
    }
  })

  it('a wrong token is refused and logged; a few in a row are throttled', async () => {
    const shouted = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const statuses: number[] = []
      for (let i = 0; i < 6; i++) {
        const res = await as(null, '/auth/break-glass', {
          method: 'POST',
          body: JSON.stringify({ token: 'nope' }),
          headers: { 'x-forwarded-for': '10.66.0.1' },
        })
        statuses.push(res.status)
      }
      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
      expect(statuses[5]).toBe(429)
      expect(shouted.mock.calls.some((c) => /BREAK-GLASS attempt REFUSED/.test(String(c[0])))).toBe(true)
    } finally {
      shouted.mockRestore()
    }
  })

  it('without a token on the server there is no break-glass at all', async () => {
    const before = process.env.ADMIN_BREAK_GLASS_TOKEN
    process.env.ADMIN_BREAK_GLASS_TOKEN = 'short'
    try {
      const res = await as(null, '/auth/break-glass', { method: 'POST', body: JSON.stringify({ token: 'short' }), headers: { 'x-forwarded-for': '10.66.0.2' } })
      expect(res.status).toBe(404)
    } finally {
      process.env.ADMIN_BREAK_GLASS_TOKEN = before
    }
  })
})

describe('logs', () => {
  it('rooms latest first, the server last; one room without its prefix', async () => {
    logTail.add('log', '[room BCDF] Mara joined', 1000)
    logTail.add('log', '[ops] lag fine', 1500)
    logTail.add('log', '[room GHJK] → build, round 1', 2000)
    logTail.add('warn', '[room BCDF] upload FAILED', 3000)
    const { rooms } = (await (await as('ana@example.com', '/logs')).json()) as { rooms: { code: string | null; problems: number }[] }
    const ours = rooms.filter((r) => r.code === 'BCDF' || r.code === 'GHJK' || r.code === null)
    expect(ours.map((r) => r.code)).toEqual(['BCDF', 'GHJK', null])
    expect(ours[0]?.problems).toBe(1)
    const { lines } = (await (await as('ana@example.com', '/logs?room=BCDF')).json()) as { lines: { text: string }[] }
    expect(lines.map((l) => l.text)).toEqual(['Mara joined', 'upload FAILED'])
    expect((await as('ana@example.com', '/logs?room=../etc')).status).toBe(400)
  })
})
