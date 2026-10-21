import { isAdminSection, type AdminSection } from '@smoosh/protocol'

// /admin, /admin/prompts, /admin/labels, /admin/logs — and
// /admin/break-glass, which nothing links to (see ADMIN.md)

const trimmed = (path: string) => path.replace(/\/+$/, '') || '/'

export function isAdminPath(path = window.location.pathname): boolean {
  const p = trimmed(path)
  return p === '/admin' || p.startsWith('/admin/')
}

export type AdminPage = AdminSection | 'break-glass' | null

// null: /admin itself, or somewhere in it that doesn't exist
export function adminPageOf(path = window.location.pathname): AdminPage {
  const rest = trimmed(path).slice('/admin/'.length)
  if (rest === 'break-glass') return 'break-glass'
  return isAdminSection(rest) ? rest : null
}

export const sectionPath = (s: AdminSection) => `/admin/${s}`

// /prompts and /labels from before the admin area: the same tool at its new
// address, before anything renders. A ?code=… on an old link is dropped — it
// opens nothing now — and so is a code an old visit left on this phone.
export function redirectOldAdminPaths(): void {
  const p = trimmed(window.location.pathname)
  if (p !== '/prompts' && p !== '/labels') return
  window.history.replaceState(window.history.state, '', `/admin${p}${window.location.hash}`)
  try {
    localStorage.removeItem('smoosh_prompt_code')
    localStorage.removeItem('smoosh_prompt_name')
  } catch {
    // private browsing: nothing was stored
  }
}
