// Every call the admin area makes: /api/admin on the page's own origin (the
// Worker passes it to the game server in production, Vite's proxy in dev),
// so the session cookie goes along and nothing else can read the answers.

// `message` is always plain language, safe to show as-is
export class AdminApiError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status = 0) {
    super(message)
    this.name = 'AdminApiError'
    this.code = code
    this.status = status
  }
}

// the shell listens: a session that ran out mid-use goes back to sign-in
const signedOut = new Set<() => void>()
export function onSignedOut(listener: () => void): () => void {
  signedOut.add(listener)
  return () => void signedOut.delete(listener)
}

export async function adminCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/admin${path}`, {
      method,
      credentials: 'same-origin',
      ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new AdminApiError('offline', "Can't connect. Check your connection and try again.")
  }
  if (res.status === 204) return undefined as T
  const data: unknown = await res.json().catch(() => null)
  const fields = typeof data === 'object' && data !== null ? (data as { error?: unknown; message?: unknown }) : {}
  if (!res.ok || data === null) {
    const code = typeof fields.error === 'string' ? fields.error : 'error'
    if (code === 'signed_out') signedOut.forEach((l) => l())
    throw new AdminApiError(code, typeof fields.message === 'string' ? fields.message : 'Something went wrong. Try again.', res.status)
  }
  return data as T
}
