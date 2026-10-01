// Pixabay's limit (100 req/min) is per API key, and there is one key for the
// whole server — so this bucket is a process-wide singleton shared by every
// player in every room, not a per-client limit.
export class TokenBucket {
  private tokens: number
  private lastRefill: number

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity
    this.lastRefill = now()
  }

  private refill(): void {
    const t = this.now()
    this.tokens = Math.min(this.capacity, this.tokens + (t - this.lastRefill) * this.refillPerMs)
    this.lastRefill = t
  }

  tryTake(): boolean {
    this.refill()
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }

  // how long until one whole token is available — for Retry-After
  msUntilNext(): number {
    this.refill()
    return this.tokens >= 1 ? 0 : Math.ceil((1 - this.tokens) / this.refillPerMs)
  }
}
