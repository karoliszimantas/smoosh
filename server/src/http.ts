import type { IncomingMessage, ServerResponse } from 'node:http'
import { getRoom, touchRoom } from './rooms/Room.ts'
import { putSubmission, getSubmission } from './submissions/store.ts'
import { dropPendingActor, type PhaseMachineDeps } from './game/phaseMachine.ts'

const MAX_UPLOAD_BYTES = 1_000_000

type UploadTarget = { roomCode: string; round: number; playerId: string }

// matches socket.io's own cors: { origin: '*' } in socket.ts — the phone
// client runs on a different origin/port than this server in dev, and the
// upload sends custom headers (X-Session-Id), which triggers a CORS
// preflight the browser will block without these
function withCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id')
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
    send(res, 415, 'expected Content-Type: image/webp')
    return
  }

  const declaredLength = Number(req.headers['content-length'] ?? 0)
  if (declaredLength > MAX_UPLOAD_BYTES) {
    send(res, 413, 'file too large (max 1MB)')
    return
  }

  const room = getRoom(roomCode)
  if (!room) {
    send(res, 404, 'room not found')
    return
  }

  const sessionId = req.headers['x-session-id']
  const seat = typeof sessionId === 'string' ? room.seats.get(sessionId) : undefined
  if (!seat || seat.playerId !== playerId) {
    send(res, 403, 'session does not own this player')
    return
  }

  if (room.phase.phase !== 'build' || room.phase.round !== round) {
    send(res, 409, 'not currently accepting submissions for this round')
    return
  }

  const chunks: Buffer[] = []
  let total = 0

  req.on('data', (chunk: Buffer) => {
    if (res.headersSent) return
    total += chunk.length
    if (total > MAX_UPLOAD_BYTES) {
      send(res, 413, 'file too large (max 1MB)')
      req.destroy()
      return
    }
    chunks.push(chunk)
  })

  req.on('end', () => {
    if (res.headersSent) return
    putSubmission(roomCode, round, playerId, Buffer.concat(chunks))
    touchRoom(room)
    dropPendingActor(room, deps, playerId)
    deps.onSnapshot(room)
    send(res, 200, 'ok')
  })

  req.on('error', () => send(res, 400, 'upload failed'))
}
