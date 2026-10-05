import { createContext, useContext, type ComponentType } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents, RoomEvent, RoomSnapshot } from '@smoosh/protocol'
import { SERVER_URL } from './serverUrl'
import ServerPicture, { type PictureProps } from './ServerPicture'

// The game's edges to the outside world — the socket, the picture upload,
// and how a submitted picture is shown. Production uses the defaults below;
// dev tools (src/dev) swap in their own at startup, which is the only way
// they reach the game.

export type AckArg<E extends keyof ClientToServerEvents> = Parameters<ClientToServerEvents[E]>[1] extends (
  r: infer R,
) => void
  ? R
  : never

export type EmitPayload<E extends keyof ClientToServerEvents> = Parameters<ClientToServerEvents[E]>[0]

export type ConnectionEvent = 'connect' | 'disconnect' | 'reconnect_attempt' | 'reconnect'

// as much of the socket as the game uses
export type GameTransport = {
  on: (event: ConnectionEvent, fn: () => void) => void
  onSnapshot: (fn: (snapshot: RoomSnapshot) => void) => void
  onRoomEvent: (fn: (event: RoomEvent) => void) => void
  isConnected: () => boolean
  // drop whatever connection there is and make a fresh one now — for a page
  // back from the background, whose socket may be dead without knowing it
  reconnect: () => void
  emit: <E extends keyof ClientToServerEvents>(event: E, payload: EmitPayload<E>, ack: (r: AckArg<E>) => void) => void
  close: () => void
}

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export function socketTransport(socket: GameSocket): GameTransport {
  return {
    on: (event, fn) => {
      if (event === 'connect' || event === 'disconnect') socket.on(event, fn)
      else socket.io.on(event, fn)
    },
    onSnapshot: (fn) => {
      socket.on('state:sync', fn)
    },
    onRoomEvent: (fn) => {
      socket.on('room:event', fn)
    },
    isConnected: () => socket.connected,
    reconnect: () => {
      socket.disconnect().connect()
    },
    emit: <E extends keyof ClientToServerEvents>(event: E, payload: EmitPayload<E>, ack: (r: AckArg<E>) => void) => {
      // TS can't verify [payload, ack] against Parameters<ClientToServerEvents[E]>
      // for a generic E, even though it holds for every concrete instantiation
      // callers actually use — this is the one place that widens the type.
      const typelessEmit = socket.emit.bind(socket) as (
        event: E,
        payload: EmitPayload<E>,
        ack: (r: AckArg<E>) => void,
      ) => void
      typelessEmit(event, payload, ack)
    },
    close: () => {
      socket.close()
    },
  }
}

export type GameServices = {
  connect: (sessionId: string) => GameTransport
  // the BUILD upload — fetch's signature, so a stand-in can answer instead
  upload: (url: string, init: RequestInit) => Promise<Response>
  Picture: ComponentType<PictureProps>
}

export const defaultServices: GameServices = {
  // A dropped connection retries sooner than socket.io's defaults (first try
  // after 0.5–1.5s, backing off to 5s): a network handover reconnects before
  // there's anything to show, and after an outage it's back within a couple
  // of seconds of the network
  connect: (sessionId) =>
    socketTransport(io(SERVER_URL, { auth: { sessionId }, reconnectionDelay: 300, reconnectionDelayMax: 2000 })),
  upload: (url, init) => fetch(url, init),
  Picture: ServerPicture,
}

const GameServicesContext = createContext<GameServices>(defaultServices)

export const GameServicesProvider = GameServicesContext.Provider

export function useGameServices(): GameServices {
  return useContext(GameServicesContext)
}
