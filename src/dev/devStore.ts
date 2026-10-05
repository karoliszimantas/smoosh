import { useSyncExternalStore } from 'react'
import type { RoomSnapshot } from '@smoosh/protocol'

// what the next picture upload does instead of (or before) reaching the server
export type UploadFault = 'none' | 'network' | 'too_late' | 'too_large' | 'never'

export type DevState = {
  open: boolean
  dock: 'top' | 'bottom'
  uploadDelayMs: number
  uploadFault: UploadFault
  // whose picture renders as a broken image
  brokenImageOf: string | null
  // how long every picture takes to start loading
  slowImagesMs: number
  connected: boolean
  // the latest snapshot the client was handed, real or injected
  snapshot: RoomSnapshot | null
  solo: boolean
}

export type DevStore = {
  get: () => DevState
  set: (patch: Partial<DevState>) => void
  subscribe: (fn: () => void) => () => void
}

export function createDevStore(initial: DevState): DevStore {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch }
      for (const fn of listeners) fn()
    },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

export function useDevState(store: DevStore): DevState {
  return useSyncExternalStore(store.subscribe, store.get)
}

// how many faults are switched on — shown on the collapsed tab, so a forced
// failure is never forgotten about
export function activeFaultCount(state: DevState): number {
  return (
    Number(state.uploadDelayMs > 0) +
    Number(state.uploadFault !== 'none') +
    Number(state.brokenImageOf !== null) +
    Number(state.slowImagesMs > 0) +
    Number(!state.connected)
  )
}
