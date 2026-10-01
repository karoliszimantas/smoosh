import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents, RoomSnapshot } from '@smoosh/protocol'
import { generateId } from '../id'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'
const SESSION_KEY = 'smoosh_session_id'
const ROOM_INFO_KEY = 'smoosh_room_info'

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting'

type AckArg<E extends keyof ClientToServerEvents> = Parameters<ClientToServerEvents[E]>[1] extends (
  r: infer R,
) => void
  ? R
  : never

type EmitPayload<E extends keyof ClientToServerEvents> = Parameters<ClientToServerEvents[E]>[0]

// exported for BuildView, which needs it to authenticate the submission
// upload (the HTTP endpoint checks X-Session-Id against the seat, same
// credential as the socket handshake)
export function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
  } catch {
    // sessionStorage unavailable (private browsing, etc.) — fall through to
    // a fresh id; reconnect-after-reload just won't work in that case
  }
  const id = generateId()
  try {
    sessionStorage.setItem(SESSION_KEY, id)
  } catch {
    // best effort
  }
  return id
}

type RoomInfo = { roomCode: string; name: string }

function storeRoomInfo(info: RoomInfo): void {
  try {
    sessionStorage.setItem(ROOM_INFO_KEY, JSON.stringify(info))
  } catch {
    // best effort
  }
}

function getStoredRoomInfo(): RoomInfo | null {
  try {
    const raw = sessionStorage.getItem(ROOM_INFO_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as RoomInfo).roomCode === 'string' &&
      typeof (parsed as RoomInfo).name === 'string'
    ) {
      return parsed as RoomInfo
    }
    return null
  } catch {
    return null
  }
}

export type GameConnection = {
  snapshot: RoomSnapshot | null
  connectionStatus: ConnectionStatus
  emit: <E extends keyof ClientToServerEvents>(event: E, payload: EmitPayload<E>) => Promise<AckArg<E>>
}

// the one socket module — connects once, authenticates with a client-owned
// sessionId (distinct from socket.id, which changes on every reconnect), and
// silently resumes a reload mid-game if a room was previously joined
export function useGameConnection(): GameConnection {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null)
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')

  useEffect(() => {
    const sessionId = getSessionId()
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
      auth: { sessionId },
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnectionStatus('connected')
      const stored = getStoredRoomInfo()
      if (stored) {
        socket.emit('room:join', { roomCode: stored.roomCode, name: stored.name }, () => {
          // a failed silent rejoin (e.g. the room expired) just leaves the
          // player on the home screen — nothing else to do here
        })
      }
    })
    socket.on('disconnect', () => setConnectionStatus('reconnecting'))
    socket.io.on('reconnect_attempt', () => setConnectionStatus('reconnecting'))
    socket.io.on('reconnect', () => setConnectionStatus('connected'))

    socket.on('state:sync', (snap) => {
      setSnapshot(snap)
      const me = snap.players.find((p) => p.id === snap.you.playerId)
      if (me) storeRoomInfo({ roomCode: snap.roomCode, name: me.name })
    })

    return () => {
      socket.close()
    }
  }, [])

  const emit = useCallback(<E extends keyof ClientToServerEvents>(event: E, payload: EmitPayload<E>) => {
    return new Promise<AckArg<E>>((resolve) => {
      const socket = socketRef.current
      if (!socket) {
        resolve({ ok: false, code: 'ROOM_NOT_FOUND', message: 'not connected' } as AckArg<E>)
        return
      }
      // TS can't verify [payload, ack] against Parameters<ClientToServerEvents[E]>
      // for a generic E, even though it holds for every concrete instantiation
      // callers actually use — this is the one place that widens the type.
      const typelessEmit = socket.emit.bind(socket) as (
        event: E,
        payload: EmitPayload<E>,
        ack: (result: AckArg<E>) => void,
      ) => void
      typelessEmit(event, payload, (result) => resolve(result))
    })
  }, [])

  return { snapshot, connectionStatus, emit }
}
