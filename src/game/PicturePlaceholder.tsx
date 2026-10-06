import { NO_PICTURE_TEXT } from './roomMessages'

// stands in for a picture that isn't there — never arrived, or won't load —
// in the picture's own box, so nothing around it moves and the round goes on
export default function PicturePlaceholder({ text = NO_PICTURE_TEXT }: { text?: string }) {
  return (
    <div className="picture-display picture-placeholder" role="img" aria-label={text}>
      <p>{text}</p>
    </div>
  )
}
