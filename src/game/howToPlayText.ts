// The rules in three steps, as the how-to-play cards and the first lobby's
// note both say them. No point values: they depend on the table's size
// (guessPointsFor), and a number that's wrong half the time is worse than
// none.
export const HOW_TO_PLAY_STEPS = [
  { title: 'Build it.', text: 'You get a secret, silly prompt. Smoosh photos together to show it.' },
  { title: 'Fake it.', text: 'Everyone else invents a fake prompt for your picture.' },
  {
    title: 'Spot it.',
    text: 'Find the real one: points for you and the builder. Fool someone: points for you.',
  },
] as const
