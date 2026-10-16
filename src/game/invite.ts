import { RoomCodeSchema, type RoomSnapshot } from '@smoosh/protocol'

// An invitation to a room is a link to the home screen carrying its code —
// /?join=KRPT — sent from the Lobby's Copy link and Share (or the menu's
// Copy invite link), or scanned off the Lobby's QR code. Opening one fills
// in the code and picks Join; the player only has to type their name.

type Where = { origin: string; base: string }

const here = (): Where => ({ origin: location.origin, base: import.meta.env.BASE_URL })

export function inviteLink(roomCode: string, { origin, base }: Where = here()): string {
  const path = base.endsWith('/') ? base : `${base}/`
  return `${origin}${path}?join=${encodeURIComponent(roomCode.toUpperCase())}`
}

// the code from a ?join= query, if it is one a room could have
export function parseJoinCode(search: string): string | null {
  const raw = new URLSearchParams(search).get('join')
  if (raw === null) return null
  const parsed = RoomCodeSchema.safeParse(raw.trim())
  return parsed.success ? parsed.data : null
}

// Read once, as the page loads, and taken out of the address bar straight
// away: a reload, or the link copied from the bar later, mustn't carry a
// stale invitation. It waits here until the home screen has used it (or the
// player is in that room).
let invited: string | null = null

export function captureJoinFromUrl(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('join')) return
  invited = parseJoinCode(url.search)
  url.searchParams.delete('join')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

export function invitedRoom(): string | null {
  return invited
}

export function forgetInvite(): void {
  invited = null
}

// Whether an invitation leads anywhere now: in the lobby, and once the game
// is over (Play again brings everyone back to one). While a game runs the
// server lets nobody in, so the menu doesn't offer a link that can't work.
export function invitesOpen(snapshot: RoomSnapshot): boolean {
  const { phase } = snapshot
  return phase.phase === 'lobby' || (phase.phase === 'scores' && phase.isFinalRound)
}

// reopened into a different game than the one the link was for: the seat
// they still hold wins, but say why
export function stillInGameText(roomCode: string, invitedTo: string): string {
  return `You’re still in game ${roomCode}. Leave it to join ${invitedTo}.`
}

type Nav = Pick<Navigator, 'clipboard'> & { share?: Navigator['share'] }

export async function copyText(text: string, nav: Nav = navigator): Promise<boolean> {
  try {
    await nav.clipboard.writeText(text)
    return true
  } catch {
    // no clipboard (an insecure origin, a refused permission, an old browser)
    return false
  }
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

// the phone's share sheet where there is one; otherwise, or if it fails,
// the link copied instead. Closing the sheet is not a failure
export async function shareInvite(roomCode: string, nav: Nav = navigator, where: Where = here()): Promise<ShareResult> {
  const url = inviteLink(roomCode, where)
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: 'smoosh', text: `Come play smoosh — room ${roomCode.toUpperCase()}`, url })
      return 'shared'
    } catch (err) {
      if ((err as { name?: unknown } | null)?.name === 'AbortError') return 'cancelled'
    }
  }
  return (await copyText(url, nav)) ? 'copied' : 'failed'
}
