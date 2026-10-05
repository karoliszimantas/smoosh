import type { IncomingMessage, ServerResponse } from 'node:http'
import { UPLOAD_MESSAGES } from '@smoosh/protocol'
import { getRoom, findSeatBySession, touchRoom } from './rooms/Room.ts'
import { putSubmission, getSubmission } from './submissions/store.ts'
import {
  acceptSubmission,
  submissionRejection,
  type PhaseMachineDeps,
  type SubmissionRejection,
} from './game/phaseMachine.ts'
import { handleMediaRequest } from './media/routes.ts'
import { handlePromptsRequest, PROMPT_CORS_HEADERS } from './prompts/routes.ts'

const MAX_UPLOAD_BYTES = 1_000_000

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
  // PATCH/DELETE and the prompt headers are for /api/prompts
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, X-Session-Id, ${PROMPT_CORS_HEADERS}`)
}

function send(res: ServerResponse, status: number, body?: string): void {
  if (res.headersSent) return
  withCors(res)
  res.writeHead(status, body ? { 'Content-Type': 'text/plain' } : undefined)
  res.end(body)
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
    const url = new URL(req.url ?? '/', 'http://internal')
    if (url.pathname.startsWith('/socket.io')) return // socket.io's own listener handles this path

    if (req.method === 'OPTIONS') {
      withCors(res)
      res.writeHead(204)
      res.end()
      return
    }

    if (handlePromptsRequest(req, res, url)) return
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
      handlePost(req, res, target, deps)
      return
    }
    send(res, 405, 'method not allowed')
  }
}

function handleGet(res: ServerResponse, { roomCode, round, playerId }: UploadTarget): void {
  const buffer = getSubmission(roomCode, round, playerId)
  if (!buffer) {
    send(res, 404)
    return
  }
  withCors(res)
  res.writeHead(200, {
    'Content-Type': 'image/webp',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
  })
  res.end(buffer)
}

function handlePost(req: IncomingMessage, res: ServerResponse, target: UploadTarget, deps: PhaseMachineDeps): void {
  const { roomCode, round, playerId } = target

  if (req.headers['content-type'] !== 'image/webp') {
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
  const early = submissionRejection(room, round)
  if (early) {
    console.warn(`[build] ${roomCode} round ${round}: rejected upload from ${playerId} (${early})`)
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
    const result = acceptSubmission(room, deps, playerId, round, () =>
      putSubmission(roomCode, round, playerId, Buffer.concat(chunks)),
    )
    if (!result.ok) {
      send(res, 409, REJECTION_MESSAGES[result.reason])
      return
    }
    touchRoom(room)
    send(res, 200, 'ok')
  })

  req.on('error', () => send(res, 400, UPLOAD_MESSAGES.failed))
}
