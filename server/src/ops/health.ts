import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { monitorEventLoopDelay, performance, type EventLoopUtilization } from 'node:perf_hooks'
import { DATA_DIR } from '../media/moderation.ts'
import { allRooms } from '../rooms/Room.ts'

// The server's own health, a line at a time in the same log as the rooms:
// `journalctl -u smoosh | grep '\[ops\]'`. Every game lives in this one
// process's memory, on one core, so the lines that matter are the ones that
// say it's struggling before anything visibly breaks — event loop lag above
// all — and the ones that say it died, taking every game with it.

// sampled this often while any room is open (OPS_HEALTH_EVERY_MS overrides,
// for a test run)…
const BUSY_EVERY_MS = Number(process.env.OPS_HEALTH_EVERY_MS) || 30_000
// …and only this often when there's nobody to serve
const IDLE_EVERY_MS = 5 * 60_000
// the lag monitor's own tick: fine enough to see a 20ms stall, coarse
// enough to cost nothing measurable
const LAG_RESOLUTION_MS = 10

const STATE_FILE = path.join(DATA_DIR, 'ops-state.json')

type BootState = {
  boots: number
  startedAt: number
  // refreshed at every sample: roughly when this run was last alive
  aliveAt: number
  // set only by a shutdown that went through stop() — a crash, an OOM kill
  // or a SIGKILL never gets to write it
  cleanExit: boolean
  exitReason: string | null
}

function readState(): BootState | null {
  try {
    const v: unknown = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    if (typeof v !== 'object' || v === null) return null
    const s = v as Partial<BootState>
    if (typeof s.boots !== 'number' || typeof s.startedAt !== 'number' || typeof s.aliveAt !== 'number') return null
    return {
      boots: s.boots,
      startedAt: s.startedAt,
      aliveAt: s.aliveAt,
      cleanExit: s.cleanExit === true,
      exitReason: typeof s.exitReason === 'string' ? s.exitReason : null,
    }
  } catch {
    return null
  }
}

function writeState(state: BootState): void {
  try {
    mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(state))
  } catch (err) {
    console.error('[ops] could not write boot state:', err)
  }
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 120) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 120) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h${m % 60}m` : `${Math.floor(h / 24)}d${h % 24}h`
}

const mb = (bytes: number) => (bytes / 1048576).toFixed(0)

export type Census = { rooms: number; players: number; present: number; playing: number }

export function census(): Census {
  let rooms = 0
  let players = 0
  let present = 0
  let playing = 0
  for (const room of allRooms()) {
    rooms++
    if (room.phase.phase !== 'lobby') playing++
    for (const seat of room.seats.values()) {
      players++
      if (seat.presence === 'present') present++
    }
  }
  return { rooms, players, present, playing }
}

let processErrors = 0
// an uncaught exception or rejection the process lived through
export function noteProcessError(): void {
  processErrors++
}

export type HealthDeps = { openSockets: () => number }

// Starts sampling, and says how the last run ended. Returns stop(), which
// the shutdown path calls before exiting.
export function startHealth(deps: HealthDeps): { stop: (reason: string) => void } {
  const previous = readState()
  const boots = (previous?.boots ?? 0) + 1
  const startedAt = Date.now()
  if (!previous) {
    console.log(`[ops] boot #${boots}: no record of an earlier run`)
  } else {
    const ran = duration(previous.aliveAt - previous.startedAt)
    const ended = previous.cleanExit
      ? `stopped cleanly (${previous.exitReason ?? 'unknown'})`
      : `DIED without a clean shutdown — crash, OOM kill or SIGKILL — last seen alive ${new Date(previous.aliveAt).toISOString()}`
    console.log(`[ops] boot #${boots}: previous run lasted ~${ran} and ${ended}`)
  }
  const state: BootState = { boots, startedAt, aliveAt: startedAt, cleanExit: false, exitReason: null }
  writeState(state)

  const lag = monitorEventLoopDelay({ resolution: LAG_RESOLUTION_MS })
  lag.enable()
  let cpuWas = process.cpuUsage()
  let eluWas: EventLoopUtilization = performance.eventLoopUtilization()
  let sampledAt = performance.now()
  let loggedAt = 0
  let samplerMs = 0

  const sample = () => {
    const began = performance.now()
    const people = census()
    const now = Date.now()
    state.aliveAt = now
    // nobody here: a line now and then is enough to show it's alive
    const due = people.rooms > 0 || now - loggedAt >= IDLE_EVERY_MS
    if (due) {
      const elapsedMs = began - sampledAt
      const cpu = process.cpuUsage(cpuWas)
      const cpuPct = ((cpu.user + cpu.system) / 1000 / elapsedMs) * 100
      const elu = performance.eventLoopUtilization(eluWas)
      const m = process.memoryUsage()
      // the monitor's own tick is in every reading: what's over it is lag
      const ms = (ns: number) => Math.max(0, ns / 1e6 - LAG_RESOLUTION_MS).toFixed(0)
      console.log(
        `[ops] health` +
          ` | lag p50 ${ms(lag.percentile(50))}ms p99 ${ms(lag.percentile(99))}ms max ${ms(lag.max)}ms, loop busy ${(elu.utilization * 100).toFixed(0)}%` +
          ` | cpu ${cpuPct.toFixed(0)}%, load ${os.loadavg()[0]?.toFixed(2) ?? '?'}` +
          ` | mem rss ${mb(m.rss)}MB heap ${mb(m.heapUsed)}/${mb(m.heapTotal)}MB ext ${mb(m.external)}MB, box free ${mb(os.freemem())}/${mb(os.totalmem())}MB` +
          ` | sockets ${deps.openSockets()}, rooms ${people.rooms} (${people.playing} in a game), players ${people.present}/${people.players} here` +
          ` | up ${duration(now - startedAt)}, boot #${boots}, errors ${processErrors}, sampler ${samplerMs.toFixed(1)}ms`,
      )
      loggedAt = now
      lag.reset()
      cpuWas = process.cpuUsage()
      eluWas = performance.eventLoopUtilization()
      sampledAt = performance.now()
      writeState(state)
      samplerMs = 0
    }
    samplerMs += performance.now() - began
  }
  const timer = setInterval(sample, BUSY_EVERY_MS)
  timer.unref()

  return {
    stop: (reason) => {
      clearInterval(timer)
      lag.disable()
      const people = census()
      // a restart ends every game in memory: say how many it took
      console.log(
        `[ops] shutting down (${reason}) after ${duration(Date.now() - startedAt)}: ` +
          `${people.rooms} room(s), ${people.playing} mid-game, ${people.players} player(s) dropped`,
      )
      writeState({ ...state, aliveAt: Date.now(), cleanExit: true, exitReason: reason })
    },
  }
}
