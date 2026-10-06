import type { PhaseProps } from '../types'
import DeadlineTimer from '../DeadlineTimer'
import PicturePlaceholder from '../PicturePlaceholder'
import { NO_PICTURE_TEXT, YOUR_PICTURE_MISSING_TEXT } from '../roomMessages'

// a player's turn in the picture order whose picture never arrived — shown
// to everyone, calmly, in the picture's own place, and the round goes on
export default function MissingView({ snapshot }: PhaseProps) {
  const phase = snapshot.phase
  if (phase.phase !== 'missing') return null

  const isYou = phase.authorId === snapshot.you.playerId

  return (
    <div className="missing-view">
      <DeadlineTimer deadline={phase.deadline} calm />
      <PicturePlaceholder text={isYou ? YOUR_PICTURE_MISSING_TEXT : NO_PICTURE_TEXT} />
    </div>
  )
}
