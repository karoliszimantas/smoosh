import type { MouseEvent } from 'react'
import type { AdminSection } from '@smoosh/protocol'
import { sectionPath } from './paths'

const SECTION_LABEL: Record<AdminSection, string> = { prompts: 'Prompts', labels: 'Labels', logs: 'Logs' }

// Only the sections this account can reach, straight from the server's
// answer: a missing door is clearer than a locked one.
export default function AdminNav({
  sections,
  current,
  onGo,
}: {
  sections: readonly AdminSection[]
  current: AdminSection | null
  onGo: (e: MouseEvent<HTMLAnchorElement>, s: AdminSection) => void
}) {
  return (
    <nav className="admin-nav" aria-label="Admin">
      {sections.map((s) => (
        <a key={s} href={sectionPath(s)} aria-current={s === current ? 'page' : undefined} onClick={(e) => onGo(e, s)}>
          {SECTION_LABEL[s]}
        </a>
      ))}
    </nav>
  )
}
