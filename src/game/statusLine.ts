import type { RoomSnapshot } from '@smoosh/protocol'
import { phaseDurationSec } from './phaseDuration'

// What the status strip says for this phase: where the game is (round,
// then picture, pass or step), the clock, and — where nobody is racing it
// — the phase's name on the tag instead of the time.
export type StatusLine = {
  round: string
  step: string
  deadline: number | null
  durationSec: number | null
  word: string | null
  // remounts the tag for each new clock, so the fuse never slides back up
  key: string
}

// Null where there's no strip: the lobby, the awards and chain awards (the
// room's attention belongs on the wall) and the final scores (game over —
// nothing left to time). Those keep the corner menu.
export function statusLine(snapshot: RoomSnapshot): StatusLine | null {
  const phase = snapshot.phase
  if (phase.phase === 'lobby' || phase.phase === 'awards' || phase.phase === 'chainAwards') return null
  if (phase.phase === 'scores' && (phase.isFinalRound || phase.deadline === null)) return null

  const durationSec = phaseDurationSec(phase, snapshot.settings)
  const line = (step: string, deadline: number, word: string | null, part: number | string = '') => ({
    round: `Round ${phase.round}/${phase.totalRounds}`,
    step,
    deadline,
    durationSec,
    word,
    key: `${phase.phase}-${phase.round}-${part}`,
  })

  switch (phase.phase) {
    case 'build':
      // this player's own clock: it starts when their prompt window closes
      return line('Building', snapshot.you.build?.deadline ?? phase.deadline, null)
    case 'pass':
      return line(`Pass ${phase.pass + 1}/${phase.passCount}`, phase.deadline, null, phase.pass)
    case 'lie':
    case 'guess':
      return line(`Picture ${phase.pictureIndex + 1}/${phase.pictureCount}`, phase.deadline, null, phase.pictureIndex)
    case 'reveal':
      return line(`Picture ${phase.pictureIndex + 1}/${phase.pictureCount}`, phase.deadline, 'Reveal', phase.pictureIndex)
    // a picture that never arrived: its turn is skipped
    case 'missing':
      return line(`Picture ${phase.pictureIndex + 1}/${phase.pictureCount}`, phase.deadline, 'Skip', phase.pictureIndex)
    case 'vote':
    case 'chainVote':
      return line('Voting', phase.deadline, null)
    case 'chainReveal':
      return line('Chains', phase.deadline, 'Reveal')
    case 'scores':
      return line('Standings', phase.deadline ?? 0, 'Scores')
  }
}
