import type { AdminSection } from '@smoosh/protocol'

// whoever a request is from, once the session checks out
export type Actor = {
  email: string
  // what their edits are credited as: attributionOf(email), or
  // BREAK_GLASS_NAME
  name: string
  sections: readonly AdminSection[]
  via: 'google' | 'break-glass'
}
