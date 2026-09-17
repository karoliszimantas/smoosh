// crypto.randomUUID is only exposed in secure contexts, so it's missing over
// plain http on a LAN IP — fall back to a non-cryptographic id there.
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}
