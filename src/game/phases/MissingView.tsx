import type { PhaseProps } from '../types'
import PicturePlaceholder from '../PicturePlaceholder'
import { blankPictureText, NO_PICTURE_TEXT, YOUR_PICTURE_MISSING_TEXT } from '../roomMessages'

// a player's turn in the picture order whose picture never arrived, or came
// in blank — shown to everyone, calmly, in the picture's own place, and the
// round goes on
export default function MissingView({ snapshot }: PhaseProps) {
  const phase = snapshot.phase
  if (phase.phase !== 'missing') return null

  const isYou = phase.authorId === snapshot.you.playerId
  const author = snapshot.players.find((p) => p.id === phase.authorId)?.name ?? null
  const text = phase.blank
    ? blankPictureText(isYou ? null : (author ?? 'Someone'))
    : isYou
      ? YOUR_PICTURE_MISSING_TEXT
      : NO_PICTURE_TEXT

  return (
    <div className="missing-view">
      <PicturePlaceholder text={text} />
    </div>
  )
}
