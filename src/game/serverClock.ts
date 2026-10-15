// How far this phone's clock is from the server's. Every deadline the game
// shows is a server timestamp, and a phone whose clock runs a few seconds
// fast would otherwise end its build early and cut the player short.
//
// Each snapshot carries the server's clock when it was built. By the time it
// arrives the phone's clock has moved on by the trip's latency, so
// `serverNow - Date.now()` always comes out at or below the true offset —
// never above it. The largest of the recent samples is the one that waited
// least on the way, so that's the estimate; the window lets a phone whose
// clock was corrected (or a much faster connection) move on from old samples.

const SAMPLES = 10

export type ClockOffset = {
  // one snapshot's server time, against the local clock when it arrived
  sample: (serverNow: number, localNow: number) => void
  // server time minus local time, in ms; 0 until the first sample
  offset: () => number
}

export function createClockOffset(size = SAMPLES): ClockOffset {
  const samples: number[] = []
  return {
    sample: (serverNow, localNow) => {
      if (!Number.isFinite(serverNow)) return
      samples.push(serverNow - localNow)
      if (samples.length > size) samples.shift()
    },
    offset: () => (samples.length === 0 ? 0 : Math.max(...samples)),
  }
}

const shared = createClockOffset()

// called with every snapshot as it arrives
export function noteServerTime(serverNow: number): void {
  shared.sample(serverNow, Date.now())
}

// the server's clock, as best this phone can tell — compare server
// deadlines with this, never with Date.now()
export function serverNow(): number {
  return Date.now() + shared.offset()
}
