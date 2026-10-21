// The last few thousand log lines, kept in memory for /admin's logs section,
// so the evening's games can be read from a phone. Everything still goes to
// journald as before — that stays the full record; this is only the tail
// since the last restart.
//
// Capturing is an array write per line. Reading is a pass over at most
// MAX_LINES short strings when someone opens the page, a millisecond or so —
// nothing that holds up a game.

import { format } from 'node:util'
import { isLogProblem, type AdminLogLine, type AdminLogRoom } from '@smoosh/protocol'

const MAX_LINES = 10_000
// a stack trace is worth keeping; a runaway dump isn't
const MAX_LINE_CHARS = 4000
const ROOM_PREFIX = /^\[room ([A-Z]{4})\] /

export class LogTail {
  private readonly lines: (AdminLogLine | undefined)[]
  private next = 0
  private count = 0

  constructor(private readonly max = MAX_LINES) {
    this.lines = new Array<AdminLogLine | undefined>(max)
  }

  add(level: AdminLogLine['level'], text: string, at = Date.now()): void {
    this.lines[this.next] = { at, level, text: text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text }
    this.next = (this.next + 1) % this.max
    this.count = Math.min(this.count + 1, this.max)
  }

  // oldest first
  all(): AdminLogLine[] {
    const out: AdminLogLine[] = []
    const start = (this.next - this.count + this.max) % this.max
    for (let i = 0; i < this.count; i++) {
      const line = this.lines[(start + i) % this.max]
      if (line) out.push(line)
    }
    return out
  }

  // every room in the tail, latest first, then the server's own lines
  rooms(): AdminLogRoom[] {
    const byCode = new Map<string | null, AdminLogRoom>()
    for (const line of this.all()) {
      const code = ROOM_PREFIX.exec(line.text)?.[1] ?? null
      const room = byCode.get(code) ?? { code, firstAt: line.at, lastAt: line.at, lines: 0, problems: 0 }
      room.lastAt = line.at
      room.lines += 1
      if (isLogProblem(line)) room.problems += 1
      byCode.set(code, room)
    }
    const server = byCode.get(null)
    byCode.delete(null)
    return [...[...byCode.values()].sort((a, b) => b.lastAt - a.lastAt), ...(server ? [server] : [])]
  }

  // one room's lines without the "[room ABCD] " every one of them starts
  // with; null for the lines that aren't any room's
  room(code: string | null): AdminLogLine[] {
    return this.all().flatMap((line) => {
      const match = ROOM_PREFIX.exec(line.text)
      if ((match?.[1] ?? null) !== code) return []
      return [match ? { ...line, text: line.text.slice(match[0].length) } : line]
    })
  }
}

export const logTail = new LogTail()

// From boot, console.log/warn/error also land in the tail — written out
// exactly as console would, then passed on unchanged
export function captureConsole(tail: LogTail = logTail): void {
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      tail.add(level, format(...args))
      original(...args)
    }
  }
}
