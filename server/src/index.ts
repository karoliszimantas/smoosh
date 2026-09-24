import http from 'node:http'
import { createSocketServer } from './socket.ts'
import { createRequestHandler } from './http.ts'
import { startIdleReaper } from './idleReaper.ts'

const PORT = Number(process.env.PORT ?? 3001)

const httpServer = http.createServer()
const { deps } = createSocketServer(httpServer)
httpServer.on('request', createRequestHandler(deps))

startIdleReaper()

httpServer.listen(PORT, () => {
  console.log(`smoosh server listening on :${PORT}`)
})
