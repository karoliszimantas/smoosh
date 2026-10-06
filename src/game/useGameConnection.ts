import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientToServerEvents, RoomSnapshot } from '@smoosh/protocol'
import { useGameServices, type AckArg, type EmitPayload, type GameTransport } from './services'
import { clearActiveRoom, getActiveRoom, getSessionId, setActiveRoom, type ActiveRoom } from './session'
import { pruneGameCanvases } from './canvasStorage'
import { leftText, rejoinFailedText, roomEventText } from './roomMessages'

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting'

// a dropped connection shorter than this shows nothing — a wifi-to-mobile
// handover, a moment in a lift
const RECONNECTING_BANNER_DELAY_MS = 1500
// a page back from the background after longer than this may be holding a
// socket that died while it was frozen (iOS does this) — reconnect rather
// than wait for it to notice
const STALE_AFTER_HIDDEN_MS = 5000
// how long a leave waits for the server before going home anyway
const LEAVE_TIMEOUT_MS = 3000

export type Toast = { id: number; text: string; ms: number }

export type GameConnection = {
  snapshot: RoomSnapshot | null
  connectionStatus: ConnectionStatus
  // the connection has been down long enough to say so
  showReconnecting: boolean
  emit: <E extends keyof ClientToServerEvents>(event: E, payload: EmitPayload<E>) => Promise<AckArg<E>>
  // why the player is on the home screen, if there's something to say
  homeNotice: string | null
  // the game they were last in, to offer joining again
  lastRoomCode: string | null
  toasts: Toast[]
  dismissToast: (id: number) => void
  // the same player opened the game somewhere else, which took the seat
  replaced: boolean
  playHere: () => void
  leave: () => Promise<void>
}

const noop = () => {}

// The one socket module. A player is a session (session.ts), not a socket:
// on every connect — first load, reload, reopened tab, reconnect — it
// silently rejoins the stored room. Going to the background tells the room
// "away" straight away; coming back rejoins. Only `leave` ever gives the
// seat up.
export function useGameConnection(): GameConnection {
  const { connect } = useGameServices()
  const socketRef = useRef<GameTransport | null>(null)
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [showReconnecting, setShowReconnecting] = useState(false)
  const [homeNotice, setHomeNotice] = useState<string | null>(null)
  const [lastRoomCode, setLastRoomCode] = useState<string | null>(() => getActiveRoom()?.roomCode ?? null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [replaced, setReplaced] = useState(false)
  const replacedRef = useRef(false)
  const youRef = useRef<string | null>(null)
  const toastId = useRef(0)
  // the game whose end has already been cleared up after
  const endedRef = useRef<string | null>(null)

  const pushToast = useCallback((text: string, ms: number) => {
    toastId.current += 1
    const id = toastId.current
    setToasts((list) => [...list, { id, text, ms }])
  }, [])
  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  // back on the home screen, with a word about why
  const goHome = useCallback((notice: string | null, roomCode: string | null) => {
    clearActiveRoom()
    pruneGameCanvases(null)
    youRef.current = null
    setSnapshot(null)
    setHomeNotice(notice)
    setLastRoomCode(roomCode)
  }, [])

  useEffect(() => {
    const socket = connect(getSessionId())
    socketRef.current = socket
    // say "Reconnected" after the next successful rejoin: true on a load that
    // picks a game back up, and after a drop long enough to have been shown
    let announce = getActiveRoom() !== null
    let bannerTimer: ReturnType<typeof setTimeout> | null = null
    let hiddenAt: number | null = null

    const rejoin = (active: ActiveRoom) => {
      const announceThis = announce
      announce = false
      socket.emit('room:join', { roomCode: active.roomCode, name: active.name }, (res) => {
        if (res.ok) {
          if (announceThis) pushToast('Reconnected', 2000)
          return
        }
        // only if this is still the game we meant — a leave may have raced it
        if (getActiveRoom()?.roomCode === active.roomCode) goHome(rejoinFailedText(active.roomCode, res.code), null)
      })
    }

    socket.on('connect', () => {
      if (bannerTimer) clearTimeout(bannerTimer)
      bannerTimer = null
      setShowReconnecting(false)
      setConnectionStatus('connected')
      const active = getActiveRoom()
      if (active && !replacedRef.current) rejoin(active)
    })
    const onDrop = () => {
      setConnectionStatus('reconnecting')
      if (bannerTimer) return
      bannerTimer = setTimeout(() => {
        setShowReconnecting(true)
        announce = true
      }, RECONNECTING_BANNER_DELAY_MS)
    }
    socket.on('disconnect', onDrop)
    socket.on('reconnect_attempt', onDrop)

    socket.onSnapshot((snap) => {
      if (replacedRef.current) return
      const me = snap.players.find((p) => p.id === snap.you.playerId)
      if (getActiveRoom()?.roomCode !== snap.roomCode) pruneGameCanvases(snap.roomCode)
      if (me) setActiveRoom({ roomCode: snap.roomCode, playerId: snap.you.playerId, name: me.name })
      youRef.current = snap.you.playerId
      // the game is over: its canvases, and any photos in them, go now
      if (snap.phase.phase === 'scores' && snap.phase.isFinalRound) {
        const ended = `${snap.roomCode}:${snap.phase.round}`
        if (endedRef.current !== ended) {
          endedRef.current = ended
          pruneGameCanvases(null)
        }
      } else endedRef.current = null
      setSnapshot(snap)
      setHomeNotice(null)
    })

    socket.onRoomEvent((event) => {
      if (event.type === 'replaced') {
        replacedRef.current = true
        setReplaced(true)
        return
      }
      const text = roomEventText(event, youRef.current)
      if (text) pushToast(text, event.type === 'caughtUp' ? 6000 : 4000)
    })

    // ---------- the page's own comings and goings

    const goAway = () => {
      if (hiddenAt === null) hiddenAt = Date.now()
      if (getActiveRoom() && socket.isConnected()) socket.emit('presence:away', {}, noop)
    }
    const comeBack = () => {
      const hiddenFor = hiddenAt === null ? 0 : Date.now() - hiddenAt
      hiddenAt = null
      if (replacedRef.current) return
      if (!socket.isConnected() || hiddenFor > STALE_AFTER_HIDDEN_MS) {
        socket.reconnect()
        return
      }
      const active = getActiveRoom()
      if (active) rejoin(active)
    }
    // backgrounded, locked, switched away from: away, never a leave — iOS
    // suspends the page and its socket without warning
    const onVisibility = () => (document.visibilityState === 'hidden' ? goAway() : comeBack())
    // restored from the back/forward cache
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) comeBack()
    }
    // the network is back (or changed): reconnect now, not on socket.io's
    // next backoff tick
    const onOnline = () => {
      if (!socket.isConnected() && !replacedRef.current) socket.reconnect()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', goAway)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', onOnline)

    return () => {
      if (bannerTimer) clearTimeout(bannerTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', goAway)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', onOnline)
      socket.close()
    }
  }, [connect, goHome, pushToast])

  const emit = useCallback(<E extends keyof ClientToServerEvents>(event: E, payload: EmitPayload<E>) => {
    return new Promise<AckArg<E>>((resolve) => {
      const socket = socketRef.current
      if (!socket) {
        resolve({ ok: false, code: 'ROOM_NOT_FOUND', message: 'not connected' } as AckArg<E>)
        return
      }
      socket.emit(event, payload, (result) => resolve(result))
    })
  }, [])

  const leave = useCallback(async () => {
    const roomCode = snapshot?.roomCode ?? getActiveRoom()?.roomCode
    // stop auto-rejoining first: a reconnect mid-leave must not put them back
    clearActiveRoom()
    await Promise.race([
      emit('room:leave', { roomCode }),
      new Promise((resolve) => setTimeout(resolve, LEAVE_TIMEOUT_MS)),
    ])
    goHome(roomCode ? leftText(roomCode) : null, roomCode ?? null)
  }, [emit, goHome, snapshot])

  const playHere = useCallback(() => {
    replacedRef.current = false
    setReplaced(false)
    socketRef.current?.reconnect()
  }, [])

  return {
    snapshot,
    connectionStatus,
    showReconnecting,
    emit,
    homeNotice,
    lastRoomCode,
    toasts,
    dismissToast,
    replaced,
    playHere,
    leave,
  }
}
