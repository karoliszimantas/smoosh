import type { Theme } from './types'
import { night } from './night'

const INK = '#1A1714'
const PAPER = '#FBF7EE'
const DESK = '#E6DCC9'

// Night's scrapbook on a light desk: the same paper, ink and shadows; the
// desk, the paper and the few things that sit straight on the desk change.
export const day: Theme = {
  ...night,
  id: 'day',
  name: 'Day',

  chromeBg: DESK,
  chromeBorder: '#5C5348', // legacy outline; paper cards use shadow.card

  // on the desk
  textPrimary: INK,
  textMuted: '#5C5348',

  pageBg: DESK,
  surface: PAPER,

  surfaceSunken: '#D6CAB3',
  surfaceSunkenText: INK,
  focus: '#B8320A',
  ghost: '#5C5348',

  shadow: { ...night.shadow, burst: '4px 5px 0 rgba(26,23,20,.85)' },
  paper: { ...night.paper, dot: 'rgba(26,23,20,.06)' },
  timer: { ...night.timer, calm: PAPER, string: '#5C5348' },

  gallery: {
    ...night.gallery,
    wall: DESK,
    wallText: INK,
    placardBg: PAPER,
    frame: `0 0 0 6px ${PAPER}, 3px 4px 0 6px rgba(0,0,0,.55)`,
  },
}
