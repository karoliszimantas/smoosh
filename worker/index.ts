// The Worker in front of the client's static assets. It does one thing:
// /api/admin/* goes on to the game server, so the admin area and its session
// cookie live on the page's own origin. A cookie set by the game server's
// own domain would be a third-party cookie here, which Safari refuses.
// Everything else is served from the assets without running this at all
// (run_worker_first in wrangler.toml).
//
// The game itself never comes through here: players talk to the game server
// directly, as before.

type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> }
  // https://… — the game server, as in .env.production's VITE_SERVER_URL
  GAME_SERVER_URL: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/admin/')) return env.ASSETS.fetch(request)
    const upstream = new URL(`${url.pathname}${url.search}`, env.GAME_SERVER_URL)
    const headers = new Headers(request.headers)
    headers.delete('host')
    // the server checks a write's Origin against the host the browser asked for
    headers.set('x-forwarded-host', url.host)
    headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') ?? '')
    return fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
      // the sign-in's redirects and cookies go back to the browser as they are
      redirect: 'manual',
    })
  },
}
