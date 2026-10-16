import type { GameConnection } from './useGameConnection'

// The host's way on from the final screen: everyone back to the lobby, same
// room, same settings, the host's Start to hand. "Change settings" goes the
// same way and then brings the lobby's settings card into view for the
// host. The final screen is gone by the time the lobby mounts, so that
// request waits here for the lobby to take it.
let settingsWanted = false

export async function playAgain(emit: GameConnection['emit'], { changeSettings = false } = {}) {
  settingsWanted = changeSettings
  const res = await emit('room:playAgain', {})
  if (!res.ok) settingsWanted = false
  return res
}

// the lobby, as it mounts: was it opened to change the settings? Asked once
export function takeSettingsRequest(): boolean {
  const wanted = settingsWanted
  settingsWanted = false
  return wanted
}
