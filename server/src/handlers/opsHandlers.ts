import { OpsReportSchema } from '@smoosh/protocol'
import { findSeatBySession, getRoom } from '../rooms/Room.ts'
import { roomLog, who } from '../roomLog.ts'
import { notePhaseSeen } from '../ops/phaseAcks.ts'
import { reportLine } from '../ops/reportLine.ts'
import { fail, ok, safeAck, type TypedServer, type TypedSocket } from './context.ts'

// a phone sends a handful a minute; past this it's misbehaving, and the
// rest of the minute's reports are dropped rather than flooding the log
const REPORTS_PER_MINUTE = 60

export function registerOpsHandlers(_io: TypedServer, socket: TypedSocket): void {
  let windowStart = 0
  let inWindow = 0

  // the phone times the round trip itself; the answer is all it needs
  socket.on('ops:ping', (_payload, cb) => {
    safeAck(cb)(ok({ serverNow: Date.now() }))
  })

  socket.on('ops:report', (payload, cb) => {
    const ack = safeAck(cb)
    const now = Date.now()
    if (now - windowStart > 60_000) {
      windowStart = now
      inWindow = 0
    }
    if (++inWindow > REPORTS_PER_MINUTE) {
      ack(ok(undefined))
      return
    }
    const parsed = OpsReportSchema.safeParse(payload)
    if (!parsed.success) {
      ack(fail(new Error('bad report')))
      return
    }
    const report = parsed.data
    const room = socket.data.roomCode ? getRoom(socket.data.roomCode) : undefined
    const seat = room ? findSeatBySession(room, socket.data.sessionId) : undefined
    if (report.kind === 'seen') {
      if (room && seat) notePhaseSeen(room, seat, report.key, report.frameMs, (m) => roomLog(room.code, m))
    } else if (room) {
      roomLog(room.code, `ops ${who(seat)} ${reportLine(report)}`)
    } else {
      // not in a room (yet): the home screen's numbers still count
      console.log(`[ops] ${socket.data.sessionId.slice(0, 8)} ${reportLine(report)}`)
    }
    ack(ok(undefined))
  })
}
