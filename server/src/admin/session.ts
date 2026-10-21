// The admin session: one signed, httpOnly cookie, nothing stored on the
// server. It says who signed in and until when; what they may reach is
// looked up from the allowlist on every request (config.ts), so taking
// someone off ADMIN_EMAILS shuts them out at the next restart, whatever
// their cookie says.

import type { IncomingMessage } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { sessionSecret } from './config.ts'
import { header } from './http.ts'

export const SESSION_COOKIE = 'smoosh_admin'

// 30 days. Admin is a phone picked up after a game, a few times a month; a
// shorter session mostly means signing in again on the sofa. A long one
// costs little here: the cookie only names the account — access is checked
// against the list on every request — and rotating ADMIN_SESSION_SECRET
// ends every session at once.
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000
// break-glass is for getting through one evening, not for staying signed in
export const BREAK_GLASS_SESSION_MS = 60 * 60 * 1000

export type Session = { email: string; via: 'google' | 'break-glass'; exp: number }

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

// a JSON value, signed — readable by anyone holding it, changeable by nobody
export function seal(value: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${body}.${sign(body, secret)}`
}

export function unseal(token: string, secret: string): unknown {
  const [body, mac, extra] = token.split('.')
  if (!body || !mac || extra !== undefined) return null
  const want = Buffer.from(sign(body, secret))
  const got = Buffer.from(mac)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown
  } catch {
    return null
  }
}

export function cookieValue(req: IncomingMessage, name: string): string | null {
  for (const part of header(req, 'cookie').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

// the host the browser asked for: the Worker and Vite's proxy pass it on
export function pageHost(req: IncomingMessage): string {
  return header(req, 'x-forwarded-host') || header(req, 'host')
}

// Lax: sent when Google sends the browser back here, never on another
// site's POST. Secure everywhere but plain-http localhost in dev — worked
// out from the request, not from ADMIN_ORIGIN, so break-glass still gets a
// working cookie when that setting is the thing that's wrong.
export function cookie(req: IncomingMessage, name: string, value: string, path: string, maxAgeMs: number): string {
  const secure = /^(localhost|127\.0\.0\.1)(:|$)/.test(pageHost(req)) ? '' : '; Secure'
  return `${name}=${value}; Path=${path}; Max-Age=${Math.max(0, Math.round(maxAgeMs / 1000))}; HttpOnly; SameSite=Lax${secure}`
}

export function sessionCookie(req: IncomingMessage, session: Session): string {
  const secret = sessionSecret()
  if (!secret) throw new Error('no session secret')
  return cookie(req, SESSION_COOKIE, seal(session, secret), '/api/admin', session.exp - Date.now())
}

export const clearSessionCookie = (req: IncomingMessage) => cookie(req, SESSION_COOKIE, '', '/api/admin', 0)

export function readSession(req: IncomingMessage, now = Date.now()): Session | null {
  const secret = sessionSecret()
  const raw = cookieValue(req, SESSION_COOKIE)
  if (!secret || !raw) return null
  const v = unseal(raw, secret)
  if (typeof v !== 'object' || v === null) return null
  const s = v as Partial<Session>
  if (typeof s.email !== 'string' || typeof s.exp !== 'number' || (s.via !== 'google' && s.via !== 'break-glass')) return null
  if (s.exp <= now) return null
  return { email: s.email, via: s.via, exp: s.exp }
}
