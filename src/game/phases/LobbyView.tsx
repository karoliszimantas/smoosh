import {
  ROUND_OPTIONS,
  BUILD_TIME_OPTIONS,
  ANSWER_TIME_OPTIONS,
  MIN_PLAYERS_TO_START,
  estimateDurationSec,
} from '@smoosh/protocol'
import type { GameMode, GameSettings } from '@smoosh/protocol'
import type { PhaseProps } from '../types'
import ThemeSwitcher from '../../themes/ThemeSwitcher'

const MODE_LABELS: Record<GameMode, { label: string; blurb: string }> = {
  guess: { label: 'Guess', blurb: 'Secret prompts — fool the others with fake ones' },
  gallery: { label: 'Gallery', blurb: 'Everyone builds, everyone rates 1–5' },
}

// a row of mutually exclusive buttons — quicker on a phone than a <select>,
// and every option is visible at once
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          className={`segmented-option${o.value === value ? ' active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function modeSummary(settings: GameSettings): string {
  if (settings.mode === 'guess') return MODE_LABELS.guess.label
  return `${MODE_LABELS.gallery.label} · ${settings.prompted ? 'Prompted' : 'Freestyle'}`
}

export default function LobbyView({ snapshot, emit }: PhaseProps) {
  const { settings, players, you, roomCode } = snapshot
  // only players here when the game starts are dealt in
  const presentCount = players.filter((p) => p.presence === 'present').length
  const awayCount = players.length - presentCount
  const canStart = you.isHost && presentCount >= MIN_PLAYERS_TO_START
  const estimateMin = Math.max(1, Math.round(estimateDurationSec(settings, players.length) / 60))

  const updateSettings = (patch: Partial<GameSettings>) => {
    void emit('room:updateSettings', { ...settings, ...patch })
  }

  // Guess can't be freestyle (the server rejects it) — switching to Guess
  // turns prompts back on
  const setMode = (mode: GameMode) => updateSettings(mode === 'guess' ? { mode, prompted: true } : { mode })

  return (
    <div className="lobby-view">
      <h1>Room {roomCode}</h1>

      <ul className="player-list">
        {players.map((p) => (
          <li key={p.id} className={p.presence === 'away' ? 'away' : ''}>
            {p.name}
            {p.isHost ? ' (host)' : ''}
            {p.presence === 'away' && <span className="away-marker">away</span>}
          </li>
        ))}
      </ul>
      {awayCount > 0 && <p className="lobby-away-note">Anyone away when the game starts sits it out.</p>}

      {you.isHost ? (
        <>
          <div className="lobby-mode">
            <Segmented
              label="Game mode"
              options={[
                { value: 'guess', label: MODE_LABELS.guess.label },
                { value: 'gallery', label: MODE_LABELS.gallery.label },
              ]}
              value={settings.mode}
              onChange={setMode}
            />
            {settings.mode === 'gallery' && (
              <Segmented
                label="Prompt"
                options={[
                  { value: 'prompted', label: 'Prompted' },
                  { value: 'freestyle', label: 'Freestyle' },
                ]}
                value={settings.prompted ? 'prompted' : 'freestyle'}
                onChange={(v) => updateSettings({ prompted: v === 'prompted' })}
              />
            )}
            <p className="lobby-mode-blurb">
              {settings.mode === 'gallery' && !settings.prompted
                ? 'No prompt — build whatever you want, everyone rates 1–5'
                : settings.mode === 'gallery'
                  ? 'Same prompt for everyone, everyone rates 1–5'
                  : MODE_LABELS.guess.blurb}
            </p>
          </div>
          <div className="lobby-settings">
            <label>
              Rounds
              <select
                value={settings.rounds}
                onChange={(e) => updateSettings({ rounds: Number(e.target.value) as GameSettings['rounds'] })}
              >
                {ROUND_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Build time
              <select
                value={settings.buildTimeSec}
                onChange={(e) =>
                  updateSettings({ buildTimeSec: Number(e.target.value) as GameSettings['buildTimeSec'] })
                }
              >
                {BUILD_TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}s
                  </option>
                ))}
              </select>
            </label>
            <label>
              Answer time
              <select
                value={settings.answerTimeSec}
                onChange={(e) =>
                  updateSettings({ answerTimeSec: Number(e.target.value) as GameSettings['answerTimeSec'] })
                }
              >
                {ANSWER_TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}s
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      ) : (
        <>
          <p className="lobby-mode-readonly">{modeSummary(settings)}</p>
          <p className="lobby-settings-readonly">
            {settings.rounds} rounds &middot; {settings.buildTimeSec}s to build &middot; {settings.answerTimeSec}s to
            answer
          </p>
        </>
      )}

      <p className="lobby-estimate">Estimated length: ~{estimateMin} min</p>

      {/* per player and per device — your pick, not the room's */}
      <div className="lobby-theme">
        Your style
        <ThemeSwitcher variant="inline" />
      </div>

      {you.isHost && (
        <button className="lobby-start" disabled={!canStart} onClick={() => void emit('room:start', {})}>
          {canStart ? 'Start game' : `Need at least ${MIN_PLAYERS_TO_START} players`}
        </button>
      )}
    </div>
  )
}
