// a hard offset shadow, "3px 4px 0 rgba(0,0,0,.55)": its offset in screen
// pixels and its colour. Anything else (a blur, a spread) falls back to the
// approved card shadow
export function parseHardShadow(css: string): { x: number; y: number; color: string } {
  const match = /^\s*(-?[\d.]+)px\s+(-?[\d.]+)px\s+0(?:px)?\s+((?:rgba?|hsla?)\([^)]*\)|#[\da-f]{3,8}|[a-z]+)\s*$/i.exec(css)
  if (!match) return { x: 3, y: 4, color: 'rgba(0,0,0,.55)' }
  return { x: Number(match[1]), y: Number(match[2]), color: match[3] ?? 'rgba(0,0,0,.55)' }
}
