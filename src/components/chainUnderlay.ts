import { VISIBLE_STRIP } from '@smoosh/protocol'
import { SERVER_URL } from '../game/serverUrl'

// a pass's image: uploaded passes come from the game server; anything else
// (the dev panel's stand-ins) is a path on this site
export function passImageUrl(path: string): string {
  return path.startsWith('/submissions/') ? `${SERVER_URL}${path}` : path
}

// What a chain player sees of the passes before theirs: everything above
// the strip as a flat grey silhouette at a quarter strength — where things
// are and roughly how big, never what — and the bottom strip as it is, to
// react to. Built once per pass from the earlier passes' images.

const SIZE = 1024
const GHOST = '#808080'
const GHOST_ALPHA = 0.25

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // the server sends CORS headers — and the underlay is never exported
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load ${url}`))
    img.src = url
  })
}

export async function buildUnderlay(urls: readonly string[]): Promise<HTMLCanvasElement | null> {
  if (urls.length === 0) return null
  const images = await Promise.all(urls.map(load))
  const full = document.createElement('canvas')
  full.width = SIZE
  full.height = SIZE
  const fctx = full.getContext('2d')
  if (!fctx) return null
  for (const img of images) fctx.drawImage(img, 0, 0, SIZE, SIZE)

  // the silhouette: every opaque pixel, one flat grey
  const ghost = document.createElement('canvas')
  ghost.width = SIZE
  ghost.height = SIZE
  const gctx = ghost.getContext('2d')
  if (!gctx) return null
  gctx.drawImage(full, 0, 0)
  gctx.globalCompositeOperation = 'source-in'
  gctx.fillStyle = GHOST
  gctx.fillRect(0, 0, SIZE, SIZE)

  const out = document.createElement('canvas')
  out.width = SIZE
  out.height = SIZE
  const ctx = out.getContext('2d')
  if (!ctx) return null
  const stripTop = Math.round(SIZE * (1 - VISIBLE_STRIP))
  ctx.globalAlpha = GHOST_ALPHA
  ctx.drawImage(ghost, 0, 0, SIZE, stripTop, 0, 0, SIZE, stripTop)
  ctx.globalAlpha = 1
  ctx.drawImage(full, 0, stripTop, SIZE, SIZE - stripTop, 0, stripTop, SIZE, SIZE - stripTop)
  // let go of the in-between copies now
  for (const c of [full, ghost]) {
    c.width = 0
    c.height = 0
  }
  return out
}
