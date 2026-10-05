// A light tick, for landing on a detent — where the Vibration API exists
// (Android). Only ever a bonus: the detent itself is shown on screen (see
// LayerSliders), so it reads the same with no vibration at all.
export function haptic(): void {
  if ('vibrate' in navigator) navigator.vibrate(8)
}
