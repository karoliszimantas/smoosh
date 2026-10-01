import http from 'node:http'
import { createSocketServer } from './socket.ts'
import { createRequestHandler } from './http.ts'
import { startIdleReaper } from './idleReaper.ts'
import { initModeration } from './media/moderation.ts'
import { initCutStore } from './media/cutStore.ts'

const PORT = Number(process.env.PORT ?? 3001)

const httpServer = http.createServer()
const { deps } = createSocketServer(httpServer)
httpServer.on('request', createRequestHandler(deps))

startIdleReaper()

// the blocklist must be in place before the first search is served; the cut
// index is a nice-to-have — if R2 is unreachable at boot, the game still
// runs, players just see every image as uncut until the next restart
await initModeration()
await initCutStore().catch((err: unknown) => console.error('[cuts] index load failed:', err))

httpServer.listen(PORT, () => {
  console.log(`smoosh server listening on :${PORT}`)
})
