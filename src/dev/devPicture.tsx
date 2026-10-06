import { useEffect, useState, type ComponentType } from 'react'
import type { PictureProps } from '../game/ServerPicture'
import { SERVER_URL } from '../game/serverUrl'
import { useDevState, type DevStore } from './devStore'
import PicturePlaceholder from '../game/PicturePlaceholder'

// a WebP header with nothing after it — the browser's own broken-image
// rendering, without asking the server for anything
const BROKEN_SRC = 'data:image/webp;base64,UklGRg=='

// the game's picture, with the panel's picture faults applied: one player's
// picture broken, or every picture slow to start loading
export function makeDevPicture(
  store: DevStore,
  soloPicture: (playerId: string) => string,
): ComponentType<PictureProps> {
  return function DevPicture({ imagePath }: PictureProps) {
    const { brokenImageOf, slowImagesMs } = useDevState(store)
    const [loaded, setLoaded] = useState(slowImagesMs === 0)
    const [broken, setBroken] = useState<string | null>(null)

    useEffect(() => {
      if (slowImagesMs === 0) return
      const timer = setTimeout(() => setLoaded(true), slowImagesMs)
      return () => clearTimeout(timer)
    }, [slowImagesMs, imagePath])

    const playerId = imagePath.split('/').pop() ?? ''
    let src = imagePath.startsWith('solo/') ? soloPicture(playerId) : `${SERVER_URL}${imagePath}`
    if (brokenImageOf !== null && playerId === brokenImageOf) src = BROKEN_SRC
    // no src yet is how a slow picture looks: an empty box, its size kept, until it arrives
    if (broken === src) return <PicturePlaceholder />
    return <img className="picture-display" src={loaded ? src : undefined} alt="" onError={() => setBroken(src)} />
  }
}
