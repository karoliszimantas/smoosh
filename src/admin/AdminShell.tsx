import { lazy, Suspense, useCallback, useEffect, useState, type MouseEvent } from 'react'
import type { AdminMe, AdminSection } from '@smoosh/protocol'
import ErrorBoundary from '../components/ErrorBoundary'
import PromptsView from '../prompts/PromptsView'
import { AdminApiError, adminCall, onSignedOut } from './api'
import { adminPageOf, sectionPath, type AdminPage } from './paths'
import BreakGlass from './BreakGlass'
import AdminNav from './AdminNav'

// /admin — prompts, labels and logs behind one sign-in, one nav, one check.
//
// This is admin auth, not player auth: players never sign in. The handful
// of people who look after the game sign in with Google, and the server
// checks the address against its list (server/src/admin).

const LabelsView = lazy(() => import('../labels/LabelsView'))
const LogsView = lazy(() => import('./LogsView'))

type State =
  | { kind: 'loading' }
  | { kind: 'signed-out'; failed: boolean }
  | { kind: 'no-access'; signedIn: boolean }
  | { kind: 'offline'; message: string }
  | { kind: 'ready'; me: AdminMe }

// what Google sign-in came back with (?signin=…), read once on arrival
function signInOutcome(): 'denied' | 'failed' | null {
  const outcome = new URLSearchParams(window.location.search).get('signin')
  return outcome === 'denied' || outcome === 'failed' ? outcome : null
}

const signInHref = () => `/api/admin/auth/start?next=${encodeURIComponent(window.location.pathname)}`

export default function AdminShell() {
  const [page, setPage] = useState<AdminPage>(() => adminPageOf())
  // read once, on arrival: Google turning someone away needs no request
  const [outcome] = useState(signInOutcome)
  const [state, setState] = useState<State>(() =>
    outcome === 'denied' ? { kind: 'no-access', signedIn: false } : { kind: 'loading' },
  )
  const [accountOpen, setAccountOpen] = useState(false)

  const load = useCallback(() => {
    adminCall<AdminMe>('GET', '/me').then(
      (me) => setState({ kind: 'ready', me }),
      (err: unknown) => {
        if (err instanceof AdminApiError && err.code === 'signed_out') setState({ kind: 'signed-out', failed: outcome === 'failed' })
        else if (err instanceof AdminApiError && err.code === 'no_access') setState({ kind: 'no-access', signedIn: true })
        else setState({ kind: 'offline', message: err instanceof Error ? err.message : 'Something went wrong.' })
      },
    )
  }, [outcome])

  useEffect(() => {
    if (page !== 'break-glass' && outcome !== 'denied') load()
  }, [page, outcome, load])

  // …and then out of the address bar
  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('signin')) return
    url.searchParams.delete('signin')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  // a session that runs out mid-use: back to the sign-in button
  useEffect(() => onSignedOut(() => setState({ kind: 'signed-out', failed: false })), [])

  useEffect(() => {
    const onPop = () => setPage(adminPageOf())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // /admin itself, or a section this account can't reach: the first one it
  // can. A section that isn't theirs doesn't exist for them.
  const me = state.kind === 'ready' ? state.me : null
  const asked = page !== 'break-glass' && page !== null && me?.sections.includes(page) ? page : null
  const section = asked ?? me?.sections[0] ?? null
  useEffect(() => {
    if (section && section !== page) window.history.replaceState(window.history.state, '', sectionPath(section))
  }, [section, page])

  const go = (e: MouseEvent<HTMLAnchorElement>, s: AdminSection) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    setAccountOpen(false)
    if (s === section) return
    window.history.pushState(null, '', sectionPath(s))
    setPage(s)
  }

  const signOut = () => {
    adminCall<void>('POST', '/auth/signout').then(
      () => setState({ kind: 'signed-out', failed: false }),
      () => setState({ kind: 'signed-out', failed: false }),
    )
    setAccountOpen(false)
  }

  if (page === 'break-glass') return <BreakGlass />

  if (state.kind !== 'ready' || !me) {
    return (
      <div className="prompts-view">
        <div className="prompts-gate admin-gate">
          <h1>Smoosh admin</h1>
          {state.kind === 'loading' && <p className="prompts-empty">Loading…</p>}
          {state.kind === 'offline' && (
            <>
              <p className="prompts-error">{state.message}</p>
              <button onClick={load}>Try again</button>
            </>
          )}
          {state.kind === 'signed-out' && (
            <>
              {state.failed && (
                <p className="prompts-error">
                  Sign-in didn’t work. Try again — if it keeps failing, the fallback is in ADMIN.md in the repo.
                </p>
              )}
              <a className="admin-google" href={signInHref()}>
                Sign in with Google
              </a>
            </>
          )}
          {state.kind === 'no-access' && (
            <>
              <p className="admin-refusal">You don’t have access.</p>
              <a className="admin-google" href={signInHref()}>
                Use another Google account
              </a>
              {state.signedIn && <button onClick={signOut}>Sign out</button>}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="admin-shell">
      {me.via === 'break-glass' && (
        <p className="admin-break-glass" role="alert">
          Break-glass session — Google sign-in bypassed, and logged. Ends{' '}
          {new Date(me.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
        </p>
      )}
      <header className="admin-bar">
        <AdminNav sections={me.sections} current={section} onGo={go} />
        <button className="admin-account" aria-expanded={accountOpen} onClick={() => setAccountOpen((o) => !o)}>
          {me.name}
        </button>
      </header>
      {accountOpen && (
        <div className="admin-account-panel">
          <span>Signed in as {me.email}</span>
          <button onClick={signOut}>Sign out</button>
        </div>
      )}
      <main className="admin-main">
        <ErrorBoundary>
          <Suspense fallback={<p className="prompts-empty">Loading…</p>}>
            {section === 'prompts' && <PromptsView me={me.name} />}
            {section === 'labels' && <LabelsView />}
            {section === 'logs' && <LogsView />}
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  )
}
