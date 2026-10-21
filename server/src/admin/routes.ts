// /api/admin — everything behind the admin area's sign-in. One check, here,
// in front of every section: a valid session, an account still on the list,
// and the section among the ones it may reach.
//
// Admin auth, not player auth: players never sign in, and nothing here is
// on a game's path. Every request is a cookie check and a little JSON; the
// slow parts (Google, R2) are network waits that never block the event loop.
//
//   GET  /api/admin/auth/start         → Google (google.ts)
//   GET  /api/admin/auth/callback      ← Google
//   POST /api/admin/auth/break-glass   the last resort — ADMIN.md
//   POST /api/admin/auth/signout
//   GET  /api/admin/me                 who's signed in, and their sections
//   *    /api/admin/prompts/…          prompts/routes.ts
//   *    /api/admin/labels/…           labels/routes.ts
//   GET  /api/admin/logs[?room=ABCD|server]

import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { ADMIN_SECTIONS, attributionOf, BREAK_GLASS_NAME, type AdminMe, type AdminSection } from '@smoosh/protocol'
import { handlePrompts } from '../prompts/routes.ts'
import { handleLabels } from '../labels/routes.ts'
import { logTail } from '../ops/logTail.ts'
import type { Actor } from './actor.ts'
import { breakGlassToken, sectionsFor, sessionSecret } from './config.ts'
import { finishSignIn, startSignIn } from './google.ts'
import { answer, clientIp, header, parse, readJson, secretMatches, sendError, sendJson, tokenTaker } from './http.ts'
import { BREAK_GLASS_SESSION_MS, clearSessionCookie, pageHost, readSession, sessionCookie, type Session } from './session.ts'

// A wrong token is worth one more try, not a hundred. Per address, and for
// everyone at once — a request straight to the game server can claim any
// address, and the global limit holds regardless.
const takeBreakGlassTry = tokenTaker(5, 5 / (15 * 60_000))
const takeBreakGlassTryAnyone = tokenTaker(20, 20 / (60 * 60_000))

const BreakGlassSchema = z.object({ token: z.string().max(500) })

// A write must come from the admin page itself: its Origin the host the
// browser asked for. With the SameSite=Lax cookie this is belt and braces
// against another site posting with someone's session.
function fromAdminPage(req: IncomingMessage): boolean {
  try {
    return new URL(header(req, 'origin')).host === pageHost(req)
  } catch {
    return false
  }
}

function actorOf(session: Session): Actor | null {
  if (session.via === 'break-glass') {
    return { email: 'break-glass', name: BREAK_GLASS_NAME, sections: ADMIN_SECTIONS, via: 'break-glass' }
  }
  const sections = sectionsFor(session.email)
  return sections ? { email: session.email, name: attributionOf(session.email), sections, via: 'google' } : null
}

const shout = (lines: string[]) => {
  const bar = '#'.repeat(72)
  for (const line of [bar, ...lines, bar]) console.error(`[admin] ${line}`)
}

async function breakGlass(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token = breakGlassToken()
  if (!token || !sessionSecret()) {
    sendError(res, 404, 'not_set_up', 'There’s no break-glass token on this server. See ADMIN.md.')
    return
  }
  const ip = clientIp(req)
  if (!takeBreakGlassTry(ip) || !takeBreakGlassTryAnyone('all')) {
    console.error(`[admin] BREAK-GLASS attempt throttled from ${ip}`)
    sendError(res, 429, 'slow_down', 'Too many tries. Wait a quarter of an hour.')
    return
  }
  const body = parse(BreakGlassSchema, await readJson(req))
  if (!secretMatches(body.token, token)) {
    console.error(`[admin] BREAK-GLASS attempt REFUSED (wrong token) from ${ip}`)
    sendError(res, 401, 'wrong_token', 'That token isn’t right.')
    return
  }
  const exp = Date.now() + BREAK_GLASS_SESSION_MS
  shout([
    `BREAK-GLASS SIGN-IN from ${ip} — Google sign-in bypassed, every section open.`,
    `Session ends ${new Date(exp).toISOString()}. Every request under it is logged.`,
    'If this wasn’t you: change ADMIN_BREAK_GLASS_TOKEN and ADMIN_SESSION_SECRET in server/.env and restart.',
  ])
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, { email: 'break-glass', via: 'break-glass', exp }) })
}

function logs(res: ServerResponse, url: URL): void {
  const room = url.searchParams.get('room')
  if (room === null) {
    sendJson(res, 200, { rooms: logTail.rooms(), now: Date.now() })
    return
  }
  if (room !== 'server' && !/^[A-Z]{4}$/.test(room)) {
    sendError(res, 400, 'invalid', 'That isn’t a room code.')
    return
  }
  sendJson(res, 200, { lines: logTail.room(room === 'server' ? null : room) })
}

async function handle(req: IncomingMessage, res: ServerResponse, url: URL, parts: string[]): Promise<void> {
  const method = req.method ?? 'GET'
  const [first, second, ...rest] = parts

  if (method !== 'GET' && method !== 'HEAD' && !fromAdminPage(req)) {
    sendError(res, 403, 'wrong_origin', 'That has to come from the admin page.')
    return
  }

  if (first === 'auth') {
    if (method === 'GET' && second === 'start') return startSignIn(req, res, url)
    if (method === 'GET' && second === 'callback') return finishSignIn(req, res, url)
    if (method === 'POST' && second === 'break-glass') return breakGlass(req, res)
    if (method === 'POST' && second === 'signout') {
      res.writeHead(204, { 'Set-Cookie': clearSessionCookie(req), 'Cache-Control': 'no-store' })
      res.end()
      return
    }
    sendError(res, 404, 'not_found', 'not found')
    return
  }

  const session = readSession(req)
  if (!session) {
    sendError(res, 401, 'signed_out', 'Sign in to carry on.')
    return
  }
  const actor = actorOf(session)
  if (!actor) {
    sendError(res, 403, 'no_access', 'You don’t have access.')
    return
  }
  if (actor.via === 'break-glass') console.error(`[admin] BREAK-GLASS request: ${method} ${url.pathname}${url.search}`)

  if (first === 'me' && second === undefined && method === 'GET') {
    const me: AdminMe = { email: actor.email, name: actor.name, sections: [...actor.sections], via: actor.via, expiresAt: session.exp }
    sendJson(res, 200, me)
    return
  }

  const section = ADMIN_SECTIONS.find((s) => s === first)
  if (!section) {
    sendError(res, 404, 'not_found', 'not found')
    return
  }
  if (!actor.sections.includes(section)) {
    sendError(res, 403, 'no_access', 'You don’t have access to that.')
    return
  }
  const sub = second === undefined ? [] : [second, ...rest]
  const handlers: Record<AdminSection, () => Promise<void> | void> = {
    prompts: () => handlePrompts(req, res, sub, actor),
    labels: () => handleLabels(req, res, sub, actor),
    logs: () => (method === 'GET' && sub.length === 0 ? logs(res, url) : sendError(res, 404, 'not_found', 'not found')),
  }
  await handlers[section]()
}

// true when the path was ours (answered, one way or another)
export function handleAdminRequest(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'api' || parts[1] !== 'admin') return false
  answer(res, 'admin', handle(req, res, url, parts.slice(2)))
  return true
}
