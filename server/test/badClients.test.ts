import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { io as connect, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@smoosh/protocol'
import { createSocketServer } from '../src/socket.ts'
import { createRequestHandler } from '../src/http.ts'
import type { TypedServer } from '../src/handlers/context.ts'

// The real server, wired the way index.ts wires it, on a spare port. Every
// game lives in this one process, so nothing a client sends may end it.

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>

let httpServer: http.Server
let ioServer: TypedServer
let base: string
const sockets: Socket[] = []
// in production one of these is the process going down; here the test
// runner catches it, so it's collected and checked instead
const crashes: unknown[] = []
const recordCrash = (err: unknown) => crashes.push(err)

let sessions = 0
async function client(): Promise<GameSocket> {
  const socket: GameSocket = connect(base, {
    auth: { sessionId: `bad-clients-${++sessions}` },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  })
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  return socket
}

// a raw request line node's parser accepts but URL can't make sense of
function rawRequest(request: string): Promise<string> {
  const { port } = httpServer.address() as AddressInfo
  return new Promise((resolve, reject) => {
    const conn = net.connect(port, '127.0.0.1', () => conn.write(request))
    let response = ''
    conn.on('data', (chunk: Buffer) => {
      response += chunk.toString()
      // the reply is kept alive, so stop at the end of the headers
      if (response.includes('\r\n\r\n')) {
        conn.destroy()
        resolve(response)
      }
    })
    conn.on('error', reject)
    conn.on('close', () => resolve(response))
  })
}

async function serverStillAnswers(): Promise<void> {
  expect(crashes).toEqual([])
  const res = await fetch(`${base}/nope`)
  expect(res.status).toBe(404)
  const fresh = await client()
  const created = await fresh.emitWithAck('room:create', { name: 'Fresh' })
  expect(created.ok).toBe(true)
}

beforeAll(async () => {
  process.on('uncaughtException', recordCrash)
  httpServer = http.createServer()
  const { io, deps } = createSocketServer(httpServer)
  ioServer = io
  httpServer.on('request', createRequestHandler(deps))
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`
})

afterAll(async () => {
  process.off('uncaughtException', recordCrash)
  for (const socket of sockets) socket.disconnect()
  await new Promise<void>((resolve) => {
    void ioServer.close(() => resolve())
  })
})

describe('a client that emits without an ack', () => {
  it('is ignored, and the server keeps serving everyone', async () => {
    // untyped on purpose: the protocol types won't let an emit skip its ack
    const rogue: Socket = await client()
    rogue.emit('room:start', {}) // not in a room: the refusal has nowhere to go
    rogue.emit('room:create', { name: 'Rogue' }) // succeeds, nobody to tell
    rogue.emit('room:start', {}) // in a room now, alone: refused
    rogue.emit('lie:submit', 'garbage')
    // packets on one socket are handled in order: this answer means every
    // emit above has been through its handler
    const left = (await rogue.emitWithAck('room:leave', {})) as { ok: boolean }
    expect(left.ok).toBe(true)
    expect(rogue.connected).toBe(true)

    await serverStillAnswers()
  })
})

describe('a request line with a URL that does not parse', () => {
  it('gets a 400, and the server keeps serving', async () => {
    const response = await rawRequest('GET http://[/x HTTP/1.1\r\nHost: x\r\n\r\n')
    expect(response.startsWith('HTTP/1.1 400')).toBe(true)

    await serverStillAnswers()
  })
})
