import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react'
import type { GameConnection, ConnectionStatus } from './useGameConnection'
import { getActiveRoom } from './session'
import { joinFailedText } from './roomMessages'
import Wordmark from './Wordmark'
import { forgetInvite, invitedRoom } from './invite'
import HowToPlay from './HowToPlay'
import { checkHome, cleanRoomCode, homeButtonLabel, rememberedName, rememberName, type HomeIntent } from './homeForm'

// a pasted code with a space or a dash in it still fits before it's cleaned
const ROOM_CODE_INPUT_MAX = 8

// A name, a room code and one button that follows them: no code, a new
// game; a code, that game (homeForm.ts). The name is remembered for next
// time. What's missing is asked for calmly under its own field, and any
// line of news goes as soon as they type again.
export default function HomeView({
  emit,
  connectionStatus,
  onSandbox,
  notice,
  lastRoomCode,
}: {
  emit: GameConnection['emit']
  connectionStatus: ConnectionStatus
  onSandbox: () => void
  // why they're here, if it's not their first visit — calm, not an error
  notice: string | null
  // the game they were last in, ready to join again
  lastRoomCode: string | null
}) {
  // opened from an invite: the code filled in, and the name to type — or,
  // with a name remembered, just the button to press
  const [invited] = useState(invitedRoom)
  const [name, setName] = useState(rememberedName)
  const [roomCode, setRoomCode] = useState(() => cleanRoomCode(invited ?? lastRoomCode ?? ''))
  const nameRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const goRef = useRef<HTMLButtonElement>(null)
  const [howToPlay, setHowToPlay] = useState(false)
  useEffect(() => {
    if (!invited) return
    if (nameRef.current?.value.trim()) goRef.current?.focus()
    else nameRef.current?.focus()
  }, [invited])
  const [error, setError] = useState<string | null>(null)
  // what a field still needs, said under it
  const [hint, setHint] = useState<{ field: 'name' | 'code'; text: string } | null>(null)
  const [noticeGone, setNoticeGone] = useState(false)
  const [busy, setBusy] = useState(false)
  // a tap made before the connection was up: done the moment it is
  const [pending, setPending] = useState<HomeIntent | null>(null)
  // still seated in a live game, but heading for a different one
  const [stillIn, setStillIn] = useState<{ roomCode: string; proceed: () => void } | null>(null)

  // starting something new while a game is still holding a seat: ask once
  const guard = (target: string | null, proceed: () => void) => {
    const active = getActiveRoom()
    if (active && active.roomCode !== target) setStillIn({ roomCode: active.roomCode, proceed })
    else proceed()
  }

  const rejoin = async () => {
    const active = getActiveRoom()
    setStillIn(null)
    if (!active) return
    setBusy(true)
    const res = await emit('room:join', { roomCode: active.roomCode, name: active.name })
    setBusy(false)
    if (!res.ok) setError(joinFailedText(active.roomCode, res.code))
    // back to the game they had, by choice
    else forgetInvite()
  }

  const run = async (intent: HomeIntent) => {
    setPending(null)
    setBusy(true)
    setError(null)
    const res =
      intent.kind === 'create'
        ? await emit('room:create', { name: intent.name })
        : await emit('room:join', { roomCode: intent.code, name: intent.name })
    setBusy(false)
    if (!res.ok) {
      setError(intent.kind === 'create' ? 'Couldn’t start a game. Try again?' : joinFailedText(intent.code, res.code))
      return
    }
    rememberName(intent.name)
    // in a game now: the invitation is spent
    forgetInvite()
  }

  // not connected yet: hold the tap, and say so on the button
  const go = (intent: HomeIntent) => {
    if (connectionStatus === 'connected') void run(intent)
    else setPending(intent)
  }

  // connected: the held tap goes now (a tick later, out of the render)
  const onConnected = useEffectEvent(() => {
    if (pending) void run(pending)
  })
  useEffect(() => {
    if (connectionStatus !== 'connected') return
    const id = setTimeout(onConnected, 0)
    return () => clearTimeout(id)
  }, [connectionStatus])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy || pending) return
    const check = checkHome(name, roomCode)
    if (!check.ok) {
      setHint({ field: check.field, text: check.hint })
      ;(check.field === 'name' ? nameRef : codeRef).current?.focus()
      return
    }
    const { intent } = check
    guard(intent.kind === 'join' ? intent.code : null, () => go(intent))
  }

  // a keystroke in either field: whatever was said was about before, and a
  // tap still waiting for the connection is for the old words
  const typed = () => {
    setError(null)
    setHint(null)
    setNoticeGone(true)
    setPending(null)
  }

  const nameHint = hint?.field === 'name' ? hint.text : null
  const codeHint = hint?.field === 'code' ? hint.text : null

  return (
    <div className="home-view">
      <header className="home-head">
        <h1 className="home-title">
          <Wordmark />
        </h1>
        <p className="field-label home-tagline">Cut. Paste. Fool your friends.</p>
      </header>
      {notice && !noticeGone && <p className="home-notice">{notice}</p>}

      <form className="home-form" onSubmit={submit} noValidate>
        <div className="home-field">
          <label className="field-label" htmlFor="home-name">
            Your name
          </label>
          <input
            ref={nameRef}
            id="home-name"
            className="field"
            placeholder="Your name"
            maxLength={12}
            autoComplete="nickname"
            enterKeyHint="go"
            value={name}
            aria-describedby={nameHint ? 'home-name-hint' : undefined}
            onChange={(e) => {
              setName(e.target.value)
              typed()
            }}
          />
          {nameHint && (
            <p id="home-name-hint" className="home-hint" role="status">
              {nameHint}
            </p>
          )}
        </div>

        {/* empty: a new game. Letters in it: that game */}
        <div className="home-field">
          <label className="field-label" htmlFor="home-code">
            Room code
          </label>
          <input
            ref={codeRef}
            id="home-code"
            className="field"
            placeholder="To join a game"
            maxLength={ROOM_CODE_INPUT_MAX}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="go"
            value={roomCode}
            aria-describedby={codeHint ? 'home-code-hint' : undefined}
            onChange={(e) => {
              setRoomCode(cleanRoomCode(e.target.value))
              typed()
            }}
          />
          {codeHint && (
            <p id="home-code-hint" className="home-hint" role="status">
              {codeHint}
            </p>
          )}
        </div>

        {error && <p className="home-error">{error}</p>}

        {stillIn ? (
          <div className="home-still-in" role="alertdialog" aria-label="Still in a game">
            <p>You’re still in game {stillIn.roomCode}. Rejoin, or start fresh?</p>
            <div className="home-still-in-actions">
              <button type="button" className="btn btn-primary" onClick={() => void rejoin()}>
                Rejoin
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  const { proceed } = stillIn
                  setStillIn(null)
                  proceed()
                }}
              >
                Start fresh
              </button>
            </div>
          </div>
        ) : (
          <button ref={goRef} type="submit" className="btn btn-primary btn-block home-go" disabled={busy}>
            {homeButtonLabel(roomCode, pending !== null)}
          </button>
        )}
      </form>

      {/* the rules, and a utility: not the main path — and never gated on
          the connection, they have to work with the game server down */}
      <div className="home-links">
        <button className="btn-link on-desk" onClick={() => setHowToPlay(true)}>
          How to play
        </button>
        <button className="btn-link on-desk home-sandbox" onClick={onSandbox}>
          Just mess around
        </button>
      </div>
      {howToPlay && <HowToPlay onClose={() => setHowToPlay(false)} />}
    </div>
  )
}
