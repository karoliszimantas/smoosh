import { SERVER_URL } from './serverUrl'

export type PictureProps = { imagePath: string }

// a submitted picture, straight from the game server
export default function ServerPicture({ imagePath }: PictureProps) {
  return <img className="picture-display" src={`${SERVER_URL}${imagePath}`} alt="" />
}
