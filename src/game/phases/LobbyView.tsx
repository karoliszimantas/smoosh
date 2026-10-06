import {
  ROUND_OPTIONS,
  BUILD_TIME_OPTIONS,
  ANSWER_TIME_OPTIONS,
  MIN_PLAYERS_TO_START,
  chainBuildingSec,
  estimateDurationSec,
} from '@smoosh/protocol'
import type { ChainStructure, GameMode, GameSettings } from '@smoosh/protocol'
import type { PhaseProps } from '../types'
import ThemeSwitcher from '../../themes/ThemeSwitcher'

const MODE_LABELS: Record<GameMode, { label: string; blurb: string }> = {
  guess: { label: 'Guess', blurb: 'Secret prompts — fool the others with fake ones' },
  gallery: { label: 'Gallery', blurb: 'Everyone builds, then votes for a favourite' },
  chain: { label: 'Chain', blurb: 'Pictures pass from player to player — two layers each, half-seen' },
}

const STRUCTURE_LABELS: Record<ChainStructure, { label: string; blurb: string }> = {
  rotate: { label: 'Pass round', blurb: 'One picture each, passed round the whole room — nobody ever waits' },
  groups: { label: 'Groups', blurb: 'The same, inside groups of 3–4 — nobody ever waits' },
  single: { label: 'One at a time', blurb: 'One picture per group, one player at a time — the rest wait their turn' },
}

// a pass is at most this long, however long BUILD may be in other modes
const PASS_TIME_MAX = 120

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
  if (settings.mode === 'chain') return `${MODE_LABELS.chain.label} · ${STRUCTURE_LABELS[settings.chainStructure].label}`
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
  // Chain needs prompts too, and a pass is 60–120 seconds
  const setMode = (mode: GameMode) =>
    updateSettings(
      mode === 'gallery'
        ? { mode }
        : mode === 'chain'
          ? { mode, prompted: true, ...(settings.buildTimeSec > PASS_TIME_MAX ? { buildTimeSec: 90 } : {}) }
          : { mode, prompted: true },
    )
  const chain = settings.mode === 'chain'
  const roundBuildMin = Math.round((chainBuildingSec(settings, Math.max(3, presentCount)) / 60) * 10) / 10

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
                { value: 'chain', label: MODE_LABELS.chain.label },
              ]}
              value={settings.mode}
              onChange={setMode}
            />
            {chain && (
              <Segmented
                label="Chains"
                options={(['rotate', 'groups', 'single'] as const).map((value) => ({ value, label: STRUCTURE_LABELS[value].label }))}
                value={settings.chainStructure}
                onChange={(chainStructure) => updateSettings({ chainStructure })}
              />
            )}
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
                ? 'No prompt — build whatever you want, then vote for a favourite and a runner-up'
                : settings.mode === 'gallery'
                  ? 'Same prompt for everyone, then vote for a favourite and a runner-up'
                  : chain
                    ? `${MODE_LABELS.chain.blurb}. ${STRUCTURE_LABELS[settings.chainStructure].blurb}.`
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
              {chain ? 'Time per pass' : 'Build time'}
              <select
                value={settings.buildTimeSec}
                onChange={(e) =>
                  updateSettings({ buildTimeSec: Number(e.target.value) as GameSettings['buildTimeSec'] })
                }
              >
                {BUILD_TIME_OPTIONS.filter((t) => !chain || t <= PASS_TIME_MAX).map((t) => (
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
          {chain && (
            // what the time setting costs, seen while choosing it
            <p className="lobby-mode-blurb">
              First pass {settings.buildTimeSec + 30}s, then {settings.buildTimeSec}s each — about {roundBuildMin} min of
              building a round.
            </p>
          )}
          {/* the room decides, every game — see allowPhotos in the protocol */}
          <div className="lobby-photos">
            <span>Allow photos</span>
            <Segmented
              label="Allow photos"
              options={[
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
              value={settings.allowPhotos ? 'on' : 'off'}
              onChange={(v) => updateSettings({ allowPhotos: v === 'on' })}
            />
          </div>
          <p className="lobby-mode-blurb">
            {settings.allowPhotos
              ? 'Players can add photos from their phones. Photos stay on the phone — only finished pictures are shared.'
              : 'Pictures are built from the library only.'}
          </p>
        </>
      ) : (
        <>
          <p className="lobby-mode-readonly">{modeSummary(settings)}</p>
          <p className="lobby-settings-readonly">
            {settings.rounds} rounds &middot; {settings.buildTimeSec}s to build &middot; {settings.answerTimeSec}s to
            answer &middot; photos {settings.allowPhotos ? 'allowed' : 'off'}
          </p>
        </>
      )}

      <p className="lobby-estimate">Estimated length: ~{estimateMin} min</p>

      {/* per player and per device — your pick, not the room's */}
      <div className="lobby-theme">
        Your style
        <ThemeSwitcher variant="inline" />
      </div>

      {!you.isHost && <p className="phase-status">The host starts the game — waiting for them.</p>}

      {you.isHost && (
        <button className="lobby-start" disabled={!canStart} onClick={() => void emit('room:start', {})}>
          {canStart ? 'Start game' : `Need at least ${MIN_PLAYERS_TO_START} players`}
        </button>
      )}
    </div>
  )
}
