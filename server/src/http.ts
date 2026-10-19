import type { IncomingMessage, ServerResponse } from 'node:http'
import { BLANK_PICTURE_PARAM, BUILD_GRACE_SEC, UPLOAD_MESSAGES } from '@smoosh/protocol'
import { getRoom, findSeatBySession, touchRoom } from './rooms/Room.ts'
import { putSubmission, getSubmission } from './submissions/store.ts'
import { isPictureType, sniffPictureType } from './submissions/imageType.ts'
import { looksBlank } from './submissions/blank.ts'
import {
  acceptSubmission,
  submissionRejection,
  type PhaseMachineDeps,
  type SubmissionRejection,
} from './game/phaseMachine.ts'
import { handleMediaRequest } from './media/routes.ts'
import { handlePromptsRequest, PROMPT_CORS_HEADERS } from './prompts/routes.ts'
import { handleLabelsRequest } from './labels/routes.ts'
import { personalDeadline } from './game/promptSwap.ts'
import { roomLog, who } from './roomLog.ts'
import type { Room, Seat } from './rooms/Room.ts'

// R2 takes far more; this is a guard, not a budget. A busy 1024px picture
// can pass 1MB, and the phone re-encodes smaller if it's ever refused
const MAX_UPLOAD_BYTES = 5_000_000

// shown to the player as-is, so it says what happened to their picture
const REJECTION_MESSAGES: Record<SubmissionRejection, string> = {
  too_late: UPLOAD_MESSAGES.too_late,
  wrong_phase: UPLOAD_MESSAGES.wrong_phase,
}

type UploadTarget = { roomCode: string; round: number; playerId: string }

// matches socket.io's own cors: { origin: '*' } in socket.ts — the phone
// client runs on a different origin/port than this server in dev, and the
// upload sends custom headers (X-Session-Id), which triggers a CORS
// preflight the browser will block without these
function withCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  // lets a phone's Resource Timing see sizes, for its download totals
  res.setHeader('Timing-Allow-Origin', '*')
  // PATCH/DELETE and the prompt headers are for /api/prompts
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, X-Session-Id, ${PROMPT_CORS_HEADERS}`)
}

function send(res: ServerResponse, status: number, body?: string): void {
  if (res.headersSent) return
  withCors(res)
  res.writeHead(status, body ? { 'Content-Type': 'text/plain' } : undefined)
  res.end(body)
}

// how this upload landed against the deadline it was racing: the player's own
// in BUILD (a prompt swap moves it), the pass's in chain. Tells whether the
// grace after the deadline is the right length
function againstDeadline(room: Room, playerId: string, now: number): string {
  const p = room.phase
  const deadline = p.phase === 'build' ? personalDeadline(room, playerId, now) : p.phase === 'pass' ? p.deadline : null
  if (deadline === null) return `during ${p.phase}`
  const s = ((now - deadline) / 1000).toFixed(1)
  return now <= deadline ? `${s.replace('-', '')}s before the deadline` : `${s}s into the ${BUILD_GRACE_SEC}s grace`
}

// one line per picture that reaches the server, sent or refused, with its
// stages as the server saw them: the body arriving, then storing it
// `against`: read before the picture is accepted — the last one in ends the
// phase, and its deadline with it
function logUpload(
  room: Room,
  seat: Seat,
  outcome: string,
  against: string,
  timing: { startedAt: number; bodyAt?: number; bytes?: number },
): void {
  const body = timing.bodyAt === undefined ? '' : `, body ${timing.bodyAt - timing.startedAt}ms, stored ${Date.now() - timing.bodyAt}ms`
  const size = timing.bytes === undefined ? '' : ` ${Math.round(timing.bytes / 1024)}KB`
  roomLog(room.code, `ops ${who(seat)} upload ${outcome}${size}${body}, ${against}`)
}

function parseUploadPath(pathname: string): UploadTarget | null {
  const match = /^\/submissions\/([^/]+)\/(\d+)\/([^/]+)$/.exec(pathname)
  if (!match) return null
  const roomCode = match[1]
  const round = Number(match[2])
  const playerId = match[3]
  if (!roomCode || !playerId || !Number.isFinite(round)) return null
  return { roomCode, round, playerId }
}

export function createRequestHandler(deps: PhaseMachineDeps) {
  return function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // node passes the request line through as-is: `GET http://[/x` makes
    // URL throw, and a throw in a request listener ends the process
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://internal')
    } catch {
      send(res, 400, 'bad request')
      return
    }
    if (url.pathname.startsWith('/socket.io')) return // socket.io's own listener handles this path

    if (req.method === 'OPTIONS') {
      withCors(res)
      res.writeHead(204)
      res.end()
      return
    }

    if (handlePromptsRequest(req, res, url)) return
    if (handleLabelsRequest(req, res, url)) return
    if (handleMediaRequest(req, res, url)) return

    const target = parseUploadPath(url.pathname)
    if (!target) {
      send(res, 404)
      return
    }

    if (req.method === 'GET') {
      handleGet(res, target)
      return
    }
    if (req.method === 'POST') {
      // the phone says there's nothing on it; the pixels are checked anyway
      handlePost(req, res, target, deps, url.searchParams.get(BLANK_PICTURE_PARAM) === '1')
      return
    }
    send(res, 405, 'method not allowed')
  }
}

function handleGet(res: ServerResponse, { roomCode, round, playerId }: UploadTarget): void {
  const picture = getSubmission(roomCode, round, playerId)
  if (!picture) {
    send(res, 404)
    return
  }
  withCors(res)
  // served as what its bytes were found to be, and the browser told not to
  // guess otherwise
  res.writeHead(200, {
    'Content-Type': picture.type,
    'Content-Length': picture.buffer.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(picture.buffer)
}

function handlePost(
  req: IncomingMessage,
  res: ServerResponse,
  target: UploadTarget,
  deps: PhaseMachineDeps,
  saidBlank: boolean,
): void {
  const { roomCode, round, playerId } = target

  // WebP, or JPEG/PNG from Safari. Only the sender's word — the bytes are
  // checked once they've arrived
  const declaredType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
  if (!isPictureType(declaredType)) {
    send(res, 415, UPLOAD_MESSAGES.wrong_type)
    return
  }

  const declaredLength = Number(req.headers['content-length'] ?? 0)
  if (declaredLength > MAX_UPLOAD_BYTES) {
    send(res, 413, UPLOAD_MESSAGES.too_large)
    return
  }

  const room = getRoom(roomCode)
  if (!room) {
    send(res, 404, UPLOAD_MESSAGES.room_not_found)
    return
  }

  const sessionId = req.headers['x-session-id']
  const seat = typeof sessionId === 'string' ? findSeatBySession(room, sessionId) : undefined
  if (!seat || seat.playerId !== playerId) {
    send(res, 403, UPLOAD_MESSAGES.not_owner)
    return
  }

  // cheap early check before reading the body; acceptSubmission re-checks
  // once it has arrived, since the round can close mid-upload
  const startedAt = Date.now()
  const early = submissionRejection(room, round)
  if (early) {
    console.warn(`[build] ${roomCode} round ${round}: rejected upload from ${playerId} (${early})`)
    logUpload(room, seat, `refused (${early})`, againstDeadline(room, playerId, startedAt), { startedAt })
    send(res, 409, REJECTION_MESSAGES[early])
    return
  }

  const chunks: Buffer[] = []
  let total = 0

  req.on('data', (chunk: Buffer) => {
    if (res.headersSent) return
    total += chunk.length
    if (total > MAX_UPLOAD_BYTES) {
      send(res, 413, UPLOAD_MESSAGES.too_large)
      req.destroy()
      return
    }
    chunks.push(chunk)
  })

  req.on('end', () => {
    if (res.headersSent) return
    const buffer = Buffer.concat(chunks)
    const bodyAt = Date.now()
    const type = sniffPictureType(buffer)
    if (!type) {
      send(res, 415, UPLOAD_MESSAGES.wrong_type)
      return
    }
    // known before the picture is accepted: the last one in ends BUILD, and
    // the picture order is fixed right then. Chain passes are never skipped,
    // so they aren't checked
    const blankCheck = saidBlank || room.settings.mode === 'chain' ? Promise.resolve(saidBlank) : looksBlank(buffer)
    void blankCheck
      .then((blank) => {
        if (res.headersSent) return
        const against = againstDeadline(room, playerId, Date.now())
        const result = acceptSubmission(room, deps, playerId, round, () =>
          putSubmission(roomCode, round, playerId, { buffer, type, blank }),
        )
        if (!result.ok) {
          logUpload(room, seat, `refused (${result.reason})`, against, { startedAt, bodyAt, bytes: buffer.length })
          send(res, 409, REJECTION_MESSAGES[result.reason])
          return
        }
        touchRoom(room)
        send(res, 200, 'ok')
        logUpload(room, seat, 'accepted', against, { startedAt, bodyAt, bytes: buffer.length })
      })
      .catch((err: unknown) => {
        console.error(`[build] ${roomCode} round ${round}: upload from ${playerId} failed:`, err)
        send(res, 500, UPLOAD_MESSAGES.failed)
      })
  })

  req.on('error', () => send(res, 400, UPLOAD_MESSAGES.failed))
}
