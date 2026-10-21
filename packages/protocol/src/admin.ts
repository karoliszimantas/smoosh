// The admin area (/admin): what the page and the server agree on.
//
// This is admin auth, not player auth. Players never sign in — a game is a
// room code and a typed name, and stays that way. Only the handful of people
// who write prompts, label assets and read the logs sign in, with Google.

export const ADMIN_SECTIONS = ['prompts', 'labels', 'logs'] as const
export type AdminSection = (typeof ADMIN_SECTIONS)[number]

export function isAdminSection(s: string): s is AdminSection {
  return (ADMIN_SECTIONS as readonly string[]).includes(s)
}

// GET /api/admin/me
export type AdminMe = {
  // the Google account, or "break-glass"
  email: string
  // what their edits are credited as — see attributionOf
  name: string
  // in nav order; a section that isn't here doesn't exist for them
  sections: AdminSection[]
  via: 'google' | 'break-glass'
  expiresAt: number
}

// Edits are credited to the signed-in account as "@" + the address's local
// part — "@karolis" for karolis@example.com. The domain is left out because
// the credit travels: the labels file is committed to a public repo, and the
// prompt export lands in source comments.
//
// Older edits carry a name someone typed (no "@": nobody types one any more,
// and a typed author on an import can't contain one), so the two never get
// confused, and the older ones are left exactly as they were written.
export function attributionOf(email: string): string {
  const at = email.indexOf('@')
  return `@${at > 0 ? email.slice(0, at) : email}`
}

export function isSignedInAttribution(author: string): boolean {
  return author.startsWith('@')
}

// attribution as the server writes it for a break-glass session
export const BREAK_GLASS_NAME = '@break-glass'

// in a log entry
export type AdminLogLine = { at: number; level: 'log' | 'warn' | 'error'; text: string }
// one room's story in the log, or the server's own lines (code null)
export type AdminLogRoom = { code: string | null; firstAt: number; lastAt: number; lines: number; problems: number }

// what someone skimming a log for trouble wants to find
export function isLogProblem(line: AdminLogLine): boolean {
  return line.level !== 'log' || /\bFAILED\b|\brefused\b|\bBREAK-GLASS\b/.test(line.text)
}
