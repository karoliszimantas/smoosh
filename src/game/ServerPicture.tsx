import { useState } from 'react'
import { SERVER_URL } from './serverUrl'
import PicturePlaceholder from './PicturePlaceholder'

export type PictureProps = { imagePath: string }

// a submitted picture, straight from the game server — one that won't load
// shows the calm placeholder instead of the browser's broken image
export default function ServerPicture({ imagePath }: PictureProps) {
  const [broken, setBroken] = useState<string | null>(null)
  if (broken === imagePath) return <PicturePlaceholder />
  return <img className="picture-display" src={`${SERVER_URL}${imagePath}`} alt="" onError={() => setBroken(imagePath)} />
}
