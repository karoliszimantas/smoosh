import http from 'node:http'
import { createSocketServer } from './socket.ts'
import { createRequestHandler } from './http.ts'
import { startIdleReaper } from './idleReaper.ts'
import { initModeration } from './media/moderation.ts'
import { initCutStore } from './media/cutStore.ts'
import { getPromptStore } from './prompts/shared.ts'
import { noteProcessError, startHealth } from './ops/health.ts'
import { captureConsole } from './ops/logTail.ts'
import { describeAdminConfig } from './admin/config.ts'

// first, so the admin logs section has the whole run
captureConsole()

const PORT = Number(process.env.PORT ?? 3001)

// every game lives in this process's memory: one bad packet or a stray
// rejection must not end everyone's game. Logged, and the server carries on.
process.on('uncaughtException', (err) => {
  noteProcessError()
  console.error('[process] uncaught exception:', err)
})
process.on('unhandledRejection', (reason) => {
  noteProcessError()
  console.error('[process] unhandled rejection:', reason)
})

const httpServer = http.createServer()
const { io, deps } = createSocketServer(httpServer)
httpServer.on('request', createRequestHandler(deps))

// the server's own health in the log, and a record of how each run ended —
// a stop through here says so, and what it took with it; a crash can't
const health = startHealth({ openSockets: () => io.engine.clientsCount })
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    health.stop(signal)
    process.exit(0)
  })
}

startIdleReaper()
console.log(describeAdminConfig())

// the blocklist must be in place before the first search is served; the cut
// index is a nice-to-have — if R2 is unreachable at boot, the game still
// runs, players just see every image as uncut until the next restart
await initModeration()
await initCutStore().catch((err: unknown) => console.error('[cuts] index load failed:', err))
// games draw prompts from this list — load it now rather than on the first
// game. Unreachable is not fatal: games use the generated pool meanwhile.
await getPromptStore()
  .list()
  .then((all) => console.log(`[prompts] ${all.filter((p) => !p.archived).length} live prompt(s) loaded`))
  .catch(() => console.error('[prompts] list unreachable at boot — games use the generated pool until it loads'))

httpServer.listen(PORT, () => {
  console.log(`smoosh server listening on :${PORT}`)
})
