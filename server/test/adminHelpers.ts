import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { handleAdminRequest } from '../src/admin/routes.ts'
import { handleLabelsSyncRequest } from '../src/labels/routes.ts'
import { seal, SESSION_COOKIE, type Session } from '../src/admin/session.ts'

export const SESSION_SECRET = 's'.repeat(40)
export const SYNC_KEY = 'k'.repeat(40)
export const BREAK_GLASS = 'b'.repeat(40)

// ana is on both lists; ben and karolis only on the base list
export function adminEnv(): void {
  process.env.ADMIN_SESSION_SECRET = SESSION_SECRET
  process.env.ADMIN_EMAILS = 'ana@example.com, Ben@Example.com,karolis@example.com'
  process.env.ADMIN_LOGS_EMAILS = 'ana@example.com'
  process.env.LABELS_SYNC_KEY = SYNC_KEY
  process.env.ADMIN_BREAK_GLASS_TOKEN = BREAK_GLASS
  process.env.ADMIN_ORIGIN = 'http://localhost:5173'
  process.env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com'
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret'
}

// the Cookie header a browser signed in as `email` would send
export function sessionCookie(email: string, over: Partial<Session> = {}): string {
  const session: Session = { email, via: 'google', exp: Date.now() + 60 * 60_000, ...over }
  return `${SESSION_COOKIE}=${seal(session, SESSION_SECRET)}`
}

// the game server's request handler, admin and sync routes only
export async function startAdminServer(): Promise<{ server: http.Server; origin: string }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (handleAdminRequest(req, res, url) || handleLabelsSyncRequest(req, res, url)) return
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  return { server, origin: `http://localhost:${(server.address() as AddressInfo).port}` }
}
