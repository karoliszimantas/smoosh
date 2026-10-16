import { LIE_TEXT_MAX_LEN } from '@smoosh/protocol'

// A lie is one line, like a real prompt: a newline typed or pasted into
// the box becomes a space (Enter itself sends)
export function oneLine(text: string): string {
  return text.replace(/[ \t]*[\r\n]+[ \t]*/g, ' ')
}

// the n/80 counter shows once it's worth watching
export const LIE_COUNT_FROM = 60

export function showLieCount(length: number): boolean {
  return length >= LIE_COUNT_FROM
}

// What a screen reader hears about the counter: a step at a time as the
// end comes near, never every keystroke. The same text twice in a row
// isn't announced again, so it only speaks when a step changes.
export function lieCountNote(length: number, max: number = LIE_TEXT_MAX_LEN): string {
  const left = max - length
  if (left <= 0) return 'No characters left'
  if (left <= 10) return '10 or fewer characters left'
  if (length >= LIE_COUNT_FROM) return `${max - LIE_COUNT_FROM} or fewer characters left`
  return ''
}
