// "Bob, Alice & Cara" — every artist on a chain's placard, in pass order
export function chainArtists(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1] ?? ''}`
}
