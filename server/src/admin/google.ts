// Sign in with Google: the plain OAuth code flow, server side, with PKCE.
// No library: two redirects and one fetch.
//
//   /api/admin/auth/start     → Google's consent screen
//   /api/admin/auth/callback  ← Google, with a one-time code; swapped for an
//                               ID token, its email checked against the list
//
// The ID token's signature isn't checked: it comes straight from Google's
// token endpoint over TLS, in exchange for our client secret, which OpenID
// Connect (Core 1.0, 3.1.3.7) accepts in place of one. Its issuer, audience,
// expiry and email_verified are checked.
//
// Every step is a network wait or a microsecond of hashing — nothing here
// holds up the event loop the games run on.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { adminOrigin, google, sectionsFor, sessionSecret } from './config.ts'
import { clientIp, redirect, tokenTaker } from './http.ts'
import { cookie, cookieValue, seal, sessionCookie, SESSION_MS, unseal } from './session.ts'
import { attributionOf } from '@smoosh/protocol'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
const FLOW_COOKIE = 'smoosh_admin_oauth'
const FLOW_PATH = '/api/admin/auth'
// long enough to pick an account and type a password, no longer
const FLOW_MS = 10 * 60_000
const TOKEN_TIMEOUT_MS = 10_000

// a sign-in is two requests; a dozen a minute is someone stuck in a loop
const takeAuthToken = tokenTaker(12, 12 / 60_000)

// where the page shows what happened — always plain words, never a status
export type SignInOutcome = 'denied' | 'failed'
const back = (outcome: SignInOutcome) => `/admin?signin=${outcome}`

// only somewhere inside /admin — never an open redirect
function safeNext(next: string | null): string {
  return next && /^\/admin(\/[a-z-]+)?$/.test(next) ? next : '/admin'
}

const callbackUrl = (origin: string) => `${origin}/api/admin/auth/callback`

type Flow = { state: string; verifier: string; next: string; exp: number }

export function startSignIn(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const g = google()
  const origin = adminOrigin()
  const secret = sessionSecret()
  if (!g || !origin || !secret) {
    console.error('[admin] sign-in tried, but Google sign-in is not set up — see ADMIN.md')
    redirect(res, back('failed'))
    return
  }
  if (!takeAuthToken(clientIp(req))) {
    redirect(res, back('failed'))
    return
  }
  const flow: Flow = {
    state: randomBytes(24).toString('base64url'),
    verifier: randomBytes(48).toString('base64url'),
    next: safeNext(url.searchParams.get('next')),
    exp: Date.now() + FLOW_MS,
  }
  const params = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: callbackUrl(origin),
    response_type: 'code',
    scope: 'openid email',
    state: flow.state,
    code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
    code_challenge_method: 'S256',
    // three people share phones and laptops: always ask which account
    prompt: 'select_account',
  })
  redirect(res, `${AUTH_URL}?${params.toString()}`, [cookie(req, FLOW_COOKIE, seal(flow, secret), FLOW_PATH, FLOW_MS)])
}

// tests stand in for Google's token endpoint
type TokenFetch = (body: URLSearchParams) => Promise<unknown>
const realTokenFetch: TokenFetch = async (body) => {
  const res = await fetch(TOKEN_URL, { method: 'POST', body, signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS) })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`token endpoint ${res.status}: ${JSON.stringify(data)}`)
  return data
}
let tokenFetch = realTokenFetch
export function setGoogleTokenFetchForTests(f: TokenFetch | null): void {
  tokenFetch = f ?? realTokenFetch
}

function claimsOf(idToken: string): Record<string, unknown> | null {
  const payload = idToken.split('.')[1]
  if (!payload) return null
  try {
    const v: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// the verified email in Google's answer, or why there isn't one
function emailOf(data: unknown, clientId: string): { email: string } | { problem: string } {
  const idToken = typeof data === 'object' && data !== null ? (data as { id_token?: unknown }).id_token : undefined
  if (typeof idToken !== 'string') return { problem: 'no id_token in the answer' }
  const c = claimsOf(idToken)
  if (!c) return { problem: 'id_token does not read' }
  if (typeof c.iss !== 'string' || !ISSUERS.has(c.iss)) return { problem: `issuer ${String(c.iss)}` }
  const aud = c.aud
  if (aud !== clientId && !(Array.isArray(aud) && aud.includes(clientId))) return { problem: 'audience is not this client' }
  if (typeof c.exp !== 'number' || c.exp * 1000 < Date.now()) return { problem: 'id_token expired' }
  if (typeof c.email !== 'string' || c.email_verified !== true) return { problem: 'no verified email' }
  return { email: c.email.toLowerCase() }
}

export async function finishSignIn(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const g = google()
  const origin = adminOrigin()
  const secret = sessionSecret()
  const clearFlow = cookie(req, FLOW_COOKIE, '', FLOW_PATH, 0)
  if (!g || !origin || !secret) {
    redirect(res, back('failed'), [clearFlow])
    return
  }
  if (!takeAuthToken(clientIp(req))) {
    redirect(res, back('failed'), [clearFlow])
    return
  }
  const raw = cookieValue(req, FLOW_COOKIE)
  const v = raw ? unseal(raw, secret) : null
  const flow = typeof v === 'object' && v !== null ? (v as Partial<Flow>) : null
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  // cancelled at Google's screen: back to the sign-in button, nothing to say
  if (url.searchParams.get('error') === 'access_denied') {
    redirect(res, '/admin', [clearFlow])
    return
  }
  if (
    !flow ||
    typeof flow.state !== 'string' ||
    typeof flow.verifier !== 'string' ||
    typeof flow.exp !== 'number' ||
    flow.exp < Date.now() ||
    flow.state !== state ||
    !code
  ) {
    console.warn('[admin] sign-in callback without a matching sign-in in progress (expired, or another browser)')
    redirect(res, back('failed'), [clearFlow])
    return
  }

  let data: unknown
  try {
    data = await tokenFetch(
      new URLSearchParams({
        code,
        client_id: g.clientId,
        client_secret: g.clientSecret,
        redirect_uri: callbackUrl(origin),
        grant_type: 'authorization_code',
        code_verifier: flow.verifier,
      }),
    )
  } catch (err) {
    console.error('[admin] Google token exchange failed:', err instanceof Error ? err.message : err)
    redirect(res, back('failed'), [clearFlow])
    return
  }
  const who = emailOf(data, g.clientId)
  if ('problem' in who) {
    console.error(`[admin] Google sign-in refused: ${who.problem}`)
    redirect(res, back('failed'), [clearFlow])
    return
  }
  if (!sectionsFor(who.email)) {
    // the address is worth having here: "why can't I get in" is usually
    // "signed in with the other account"
    console.warn(`[admin] sign-in refused: ${who.email} is not on ADMIN_EMAILS`)
    redirect(res, back('denied'), [clearFlow])
    return
  }
  console.log(`[admin] signed in: ${attributionOf(who.email)}`)
  redirect(res, safeNext(flow.next ?? null), [
    clearFlow,
    sessionCookie(req, { email: who.email, via: 'google', exp: Date.now() + SESSION_MS }),
  ])
}
