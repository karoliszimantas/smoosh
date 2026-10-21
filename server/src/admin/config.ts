// Who may use /admin, and how sign-in is wired. All of it from the
// environment — there is no user table. Read on every use rather than once,
// so a test can change it; in production it only changes with a restart.
//
// Admin auth, not player auth: players never sign in (see
// packages/protocol/src/admin.ts).

import type { AdminSection } from '@smoosh/protocol'

// short enough to guess is short enough to refuse
const MIN_SECRET_LENGTH = 32

function list(name: string): Set<string> {
  return new Set(
    (process.env[name] ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@')),
  )
}

function secret(name: string): string | null {
  const v = process.env[name] ?? ''
  return v.length >= MIN_SECRET_LENGTH ? v : null
}

// ADMIN_EMAILS grants prompts and labels. ADMIN_LOGS_EMAILS is a subset of
// it and adds logs: the logs carry device models, room codes, player names
// and timings, a different blast radius from writing prompts. An address on
// the logs list alone gets nothing — the base list is the door.
// Null: not on the list.
export function sectionsFor(email: string): AdminSection[] | null {
  const e = email.toLowerCase()
  if (!list('ADMIN_EMAILS').has(e)) return null
  return list('ADMIN_LOGS_EMAILS').has(e) ? ['prompts', 'labels', 'logs'] : ['prompts', 'labels']
}

// Signs the session cookie. Changing it signs everyone out.
export const sessionSecret = () => secret('ADMIN_SESSION_SECRET')

// The admin page's origin, e.g. https://smoosh.example.com — Google sends
// people back here, and writes must come from here
export function adminOrigin(): string | null {
  const v = (process.env.ADMIN_ORIGIN ?? '').replace(/\/+$/, '')
  return /^https?:\/\/[^/]+$/.test(v) ? v : null
}

export function google(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? ''
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

// The last resort when Google sign-in is broken — see ADMIN.md
export const breakGlassToken = () => secret('ADMIN_BREAK_GLASS_TOKEN')

// For tools/labelsSync.ts on the laptop, and nothing a browser ever holds
export const labelsSyncKey = () => secret('LABELS_SYNC_KEY')

// one line at boot: what's set up, never what it's set to
export function describeAdminConfig(): string {
  const base = list('ADMIN_EMAILS')
  const logs = list('ADMIN_LOGS_EMAILS')
  const orphans = [...logs].filter((e) => !base.has(e)).length
  const parts = [
    `${base.size} admin(s), ${logs.size - orphans} with logs`,
    google() && adminOrigin() && sessionSecret() ? 'Google sign-in on' : 'Google sign-in OFF (needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ADMIN_ORIGIN, ADMIN_SESSION_SECRET)',
    breakGlassToken() ? 'break-glass armed' : 'no break-glass token',
    labelsSyncKey() ? 'labels sync on' : 'labels sync off',
  ]
  if (orphans > 0) parts.push(`${orphans} logs address(es) not on ADMIN_EMAILS — ignored`)
  return `[admin] ${parts.join('; ')}`
}
