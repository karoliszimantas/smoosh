// The home screen's one form: a name, a room code, one button. What the
// button does follows what's typed — no code, a new game; a code, that
// game — so there's nothing to switch first.

export const ROOM_CODE_LENGTH = 4

// what's missing, asked for calmly under its own field — not an error
export const NAME_NEEDED_TEXT = 'Your name, so the others know who’s who'
export const CODE_LENGTH_TEXT = 'Room codes are 4 letters'

export type HomeIntent = { kind: 'create'; name: string } | { kind: 'join'; name: string; code: string }

export type HomeCheck = { ok: true; intent: HomeIntent } | { ok: false; field: 'name' | 'code'; hint: string }

// a room code as typed: letters only, in capitals
export function cleanRoomCode(raw: string): string {
  return raw
    .replace(/[^a-z]/gi, '')
    .toUpperCase()
    .slice(0, ROOM_CODE_LENGTH)
}

// "Create game", "Join ABCD" — or, with part of a code, just "Join".
// While the tap waits for the connection, it says so.
export function homeButtonLabel(code: string, connecting = false): string {
  if (connecting) return 'Connecting…'
  if (code === '') return 'Create game'
  return code.length === ROOM_CODE_LENGTH ? `Join ${code}` : 'Join'
}

// what a tap would do, or which field still needs something: a part code
// first (the button already says Join), then the name
export function checkHome(name: string, code: string): HomeCheck {
  const trimmed = name.trim()
  if (code !== '' && code.length !== ROOM_CODE_LENGTH) return { ok: false, field: 'code', hint: CODE_LENGTH_TEXT }
  if (!trimmed) return { ok: false, field: 'name', hint: NAME_NEEDED_TEXT }
  return { ok: true, intent: code === '' ? { kind: 'create', name: trimmed } : { kind: 'join', name: trimmed, code } }
}

// The name, remembered on this phone for next time. Storage can be missing
// or refuse: then it's typed again, nothing worse.
const NAME_KEY = 'smoosh_name'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function local(): Store | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

export function rememberedName(store: Store | null = local()): string {
  try {
    return store?.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberName(name: string, store: Store | null = local()): void {
  try {
    store?.setItem(NAME_KEY, name.trim())
  } catch {
    // typed again next time
  }
}
