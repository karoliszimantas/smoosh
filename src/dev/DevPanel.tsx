import { useEffect, useState, type ReactNode } from 'react'
import { activeFaultCount, useDevState, type UploadFault } from './devStore'
import { FIXTURE_PLAYERS, type FixturePhase } from './fixtures'
import type { DevControls } from './devTools'
import { clearMissingWords, missingWords } from '../assets/missingWords'
import './devPanel.css'

const DELAYS = [0, 1000, 5000, 15000] as const
const SLOW = [0, 3000, 10000] as const

const FAULTS: { value: UploadFault; label: string }[] = [
  { value: 'none', label: 'none' },
  { value: 'network', label: 'network' },
  { value: 'too_late', label: '409 late' },
  { value: 'too_large', label: '413 big' },
  { value: 'never', label: 'never send' },
]

const JUMPS: { phase: FixturePhase; label: string; yours?: boolean; exhibition?: boolean }[] = [
  { phase: 'missing', label: 'Placeholder' },
  { phase: 'missing', label: 'Placeholder (yours)', yours: true },
  { phase: 'build', label: 'build' },
  { phase: 'lie', label: 'lie' },
  { phase: 'guess', label: 'guess' },
  { phase: 'reveal', label: 'reveal' },
  { phase: 'pass', label: 'chain pass' },
  { phase: 'chainReveal', label: 'chain reveal' },
  { phase: 'chainVote', label: 'chain vote' },
  { phase: 'chainAwards', label: 'chain awards' },
  { phase: 'vote', label: 'vote' },
  { phase: 'awards', label: 'awards' },
  { phase: 'scores', label: 'scores' },
  { phase: 'scores', label: 'exhibition', exhibition: true },
  { phase: 'lobby', label: 'lobby' },
]

// prompt words the library had nothing for, counted on this device
function MissingWords() {
  const [words, setWords] = useState(() => missingWords())
  if (words.length === 0) return <p className="devp-note">None yet.</p>
  return (
    <>
      <p className="devp-note">{words.map(([w, n]) => `${w} ×${n}`).join(' · ')}</p>
      <button
        onClick={() => {
          clearMissingWords()
          setWords([])
        }}
      >
        Clear
      </button>
    </>
  )
}

function seconds(ms: number): string {
  return ms === 0 ? 'off' : `${ms / 1000}s`
}

function Choice<T extends string | number | null>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="devp-choice">
      {options.map((o) => (
        <button
          key={String(o.value)}
          className={o.value === value ? 'on' : ''}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="devp-section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

// the game's own banners are pinned to the top of the screen, right where
// the tab sits — keep the tab just below whichever are showing, so it never
// covers one (or its dismiss button)
function useTopBannerOffset(): number {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const measure = () => {
      let bottom = 0
      for (const el of document.querySelectorAll('.notice-region .notice')) {
        bottom = Math.max(bottom, el.getBoundingClientRect().bottom)
      }
      setOffset(bottom)
    }
    measure()
    const observer = new MutationObserver(measure)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  return offset
}

export default function DevPanel({ controls }: { controls: DevControls }) {
  const { store, solo } = controls
  const state = useDevState(store)
  const faults = activeFaultCount(state)
  const players = state.snapshot?.players ?? FIXTURE_PLAYERS
  const youId = state.snapshot?.you.playerId
  const bannerOffset = useTopBannerOffset()

  if (!state.open) {
    return (
      <button
        className="devp-tab"
        style={bannerOffset > 0 ? { top: bannerOffset + 4 } : undefined}
        onClick={() => store.set({ open: true })}
        aria-label="Open dev panel"
      >
        DEV{faults > 0 && <span className="devp-badge">{faults}</span>}
      </button>
    )
  }

  const phase = state.snapshot?.phase.phase ?? '—'

  return (
    <div className={`devp devp-${state.dock}`} role="dialog" aria-label="Dev panel">
      <header className="devp-head">
        <strong>DEV</strong>
        <span className="devp-where">
          {solo ? 'solo' : 'live'} · {solo ? solo.describe() : phase}
        </span>
        <button onClick={() => store.set({ dock: state.dock === 'top' ? 'bottom' : 'top' })} aria-label="Move panel">
          {state.dock === 'top' ? '↓' : '↑'}
        </button>
        <button onClick={() => store.set({ open: false })} aria-label="Close dev panel">
          ✕
        </button>
      </header>

      {solo && (
        <Section title="Solo walkthrough">
          <div className="devp-row">
            <button className="devp-primary" onClick={() => solo.next()}>
              Next ▶
            </button>
            <button onClick={() => controls.setSolo(false)}>Leave solo</button>
          </div>
          <p className="devp-note">Next = the timer running out. Bots skip the next build:</p>
          <div className="devp-choice">
            {FIXTURE_PLAYERS.filter((p) => p.id !== 'you').map((p) => (
              <button
                key={p.id}
                className={solo.skippers.has(p.id) ? 'on' : ''}
                aria-pressed={solo.skippers.has(p.id)}
                onClick={() => {
                  if (solo.skippers.has(p.id)) solo.skippers.delete(p.id)
                  else solo.skippers.add(p.id)
                  store.set({})
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section title="Upload">
        <p className="devp-label">Delay</p>
        <Choice
          options={DELAYS.map((d) => ({ value: d as number, label: seconds(d) }))}
          value={state.uploadDelayMs}
          onChange={(uploadDelayMs) => store.set({ uploadDelayMs })}
        />
        <p className="devp-label">Fault</p>
        <Choice options={FAULTS} value={state.uploadFault} onChange={(uploadFault) => store.set({ uploadFault })} />
      </Section>

      <Section title="Connection">
        <div className="devp-row">
          <button disabled={!state.connected} onClick={controls.dropConnection}>
            Drop
          </button>
          <button disabled={state.connected} onClick={controls.restoreConnection}>
            Reconnect
          </button>
          <span className="devp-note">{state.connected ? 'connected' : 'dropped'}</span>
        </div>
      </Section>

      <Section title="Pictures">
        <p className="devp-label">Broken image</p>
        <Choice
          options={[
            { value: null, label: 'off' },
            ...players.map((p) => ({
              value: p.id as string | null,
              label: p.id === youId ? `${p.name} (you)` : p.name,
            })),
          ]}
          value={state.brokenImageOf}
          onChange={(brokenImageOf) => store.set({ brokenImageOf })}
        />
        <p className="devp-label">Slow to load</p>
        <Choice
          options={SLOW.map((d) => ({ value: d as number, label: seconds(d) }))}
          value={state.slowImagesMs}
          onChange={(slowImagesMs) => store.set({ slowImagesMs })}
        />
      </Section>

      <Section title="Library misses (prompt words with nothing)">
        <MissingWords />
      </Section>

      <Section title="Jump to (this device, until the next update)">
        <div className="devp-choice">
          {JUMPS.map((j) => (
            <button
              key={j.label}
              onClick={() =>
                controls.jumpTo(j.phase, {
                  ...(j.yours && youId ? { authorId: youId } : {}),
                  ...(j.exhibition ? { exhibition: true } : {}),
                })
              }
            >
              {j.label}
            </button>
          ))}
        </div>
      </Section>

      {!solo && (
        <Section title="Solo walkthrough">
          <button className="devp-primary" onClick={() => controls.setSolo(true)}>
            Start solo game (no server)
          </button>
        </Section>
      )}
    </div>
  )
}
