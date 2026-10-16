// The host's way on from a reveal before its time is up: Next picture, or
// Scores after the round's last one.
export function nextPictureLabel(pictureIndex: number, pictureCount: number): string {
  return pictureIndex >= pictureCount - 1 ? 'Scores' : 'Next picture'
}

export type NextPictureResult = 'sent' | 'already' | 'refused'

// One send per picture, however many taps land: a second tap while the
// first is out (or after it went through) does nothing. A refusal frees the
// picture again, so a tap can try once more.
export function nextPictureSender(
  send: (pictureIndex: number) => Promise<{ ok: boolean }>,
): (pictureIndex: number) => Promise<NextPictureResult> {
  const sent = new Set<number>()
  return async (pictureIndex) => {
    if (sent.has(pictureIndex)) return 'already'
    sent.add(pictureIndex)
    const res = await send(pictureIndex)
    if (res.ok) return 'sent'
    sent.delete(pictureIndex)
    return 'refused'
  }
}
