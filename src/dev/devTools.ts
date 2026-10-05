import { io } from 'socket.io-client'
import { UPLOAD_MESSAGES, type RoomSnapshot } from '@smoosh/protocol'
import {
  defaultServices,
  socketTransport,
  type GameServices,
  type GameSocket,
  type GameTransport,
} from '../game/services'
import { SERVER_URL } from '../game/serverUrl'
import { clearActiveRoom } from '../game/session'
import { createDevStore, type DevStore } from './devStore'
import { makeDevPicture } from './devPicture'
import { fixtureSnapshot, samplePicture, FIXTURE_BASE, type FixturePhase } from './fixtures'
import { SoloGame } from './soloGame'
import { createElement } from 'react'
import DevPanel from './DevPanel'

// Dev-only. Loaded by main.tsx in `vite dev` (or a `--mode devtools` build
// opened with ?dev=1), never in production. It reaches the game only by
// handing main.tsx its own GameServices — the socket, the upload, the
// picture — wrapped so the panel can make each of them misbehave on this
// device alone. The server is never told anything it wouldn't hear anyway.

const SOLO_KEY = 'smoosh_dev_solo'

export type DevControls = {
  store: DevStore
  solo: SoloGame | null
  dropConnection: () => void
  restoreConnection: () => void
  // shows a phase with fake data, on this device only, until the next real update
  jumpTo: (phase: FixturePhase, opts?: { authorId?: string }) => void
  setSolo: (on: boolean) => void
}

function readSoloFlag(): boolean {
  if (new URLSearchParams(location.search).has('solo')) return true
  try {
    return sessionStorage.getItem(SOLO_KEY) === '1'
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createDevTools() {
  const store = createDevStore({
    open: false,
    dock: 'top',
    uploadDelayMs: 0,
    uploadFault: 'none',
    brokenImageOf: null,
    slowImagesMs: 0,
    connected: true,
    snapshot: null,
    solo: readSoloFlag(),
  })
  const recordSnapshot = (snapshot: RoomSnapshot) => store.set({ snapshot })

  const solo = store.get().solo ? new SoloGame(recordSnapshot) : null

  // the live socket and the listeners the game registered on it, kept so the
  // panel can drop/restore it and slip a fake snapshot in
  let socket: GameSocket | null = null
  let gameListeners: ((s: RoomSnapshot) => void)[] = []

  const connect = (sessionId: string): GameTransport => {
    if (solo) {
      const transport = solo.connect()
      gameListeners = []
      return {
        ...transport,
        onSnapshot: (fn) => {
          gameListeners.push(fn)
          transport.onSnapshot(fn)
        },
      }
    }
    socket = io(SERVER_URL, { auth: { sessionId } })
    socket.on('connect', () => store.set({ connected: true }))
    socket.on('disconnect', () => store.set({ connected: false }))
    const transport = socketTransport(socket)
    const listeners: ((s: RoomSnapshot) => void)[] = []
    gameListeners = listeners
    transport.onSnapshot((s) => {
      recordSnapshot(s)
      for (const fn of listeners) fn(s)
    })
    return { ...transport, onSnapshot: (fn) => void listeners.push(fn) }
  }

  const upload: GameServices['upload'] = async (url, init) => {
    const { uploadDelayMs, uploadFault } = store.get()
    if (uploadDelayMs > 0) await sleep(uploadDelayMs)
    switch (uploadFault) {
      case 'network':
        throw new TypeError('Failed to fetch (dev panel: forced network failure)')
      case 'too_late':
        return new Response(UPLOAD_MESSAGES.too_late, { status: 409 })
      case 'too_large':
        return new Response(UPLOAD_MESSAGES.too_large, { status: 413 })
      case 'never':
        // the phone that never gets it out: no request, no answer, ever
        return new Promise<Response>(() => {})
      case 'none':
        return solo ? solo.receiveUpload(init.body) : defaultServices.upload(url, init)
    }
  }

  const controls: DevControls = {
    store,
    solo,
    dropConnection: () => {
      if (solo) solo.dropConnection()
      else socket?.disconnect()
      store.set({ connected: false })
    },
    restoreConnection: () => {
      if (solo) solo.restoreConnection()
      else socket?.connect()
      store.set({ connected: true })
    },
    jumpTo: (phase, opts) => {
      const live = store.get().snapshot
      const base =
        live && live.players.length > 1
          ? { roomCode: live.roomCode, settings: live.settings, players: live.players, youId: live.you.playerId }
          : FIXTURE_BASE
      const fake = fixtureSnapshot(phase, base, opts)
      for (const fn of gameListeners) fn(fake)
    },
    setSolo: (on) => {
      try {
        if (on) sessionStorage.setItem(SOLO_KEY, '1')
        else sessionStorage.removeItem(SOLO_KEY)
        // a solo room code must not be "rejoined" on the real server, or vice versa
        clearActiveRoom()
      } catch {
        // best effort
      }
      const url = new URL(location.href)
      url.searchParams.delete('solo')
      location.replace(url.toString())
    },
  }

  const services: GameServices = {
    connect,
    upload,
    Picture: makeDevPicture(store, (playerId) => solo?.pictureFor(playerId) ?? samplePicture(playerId)),
  }

  return { services, Panel: () => createElement(DevPanel, { controls }) }
}
