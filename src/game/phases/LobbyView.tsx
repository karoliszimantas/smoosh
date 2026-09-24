import { ROUND_OPTIONS, BUILD_TIME_OPTIONS, MIN_PLAYERS_TO_START, estimateDurationSec } from '@smoosh/protocol'
import type { GameSettings } from '@smoosh/protocol'
import type { PhaseProps } from '../types'

export default function LobbyView({ snapshot, emit }: PhaseProps) {
  const { settings, players, you, roomCode } = snapshot
  const canStart = you.isHost && players.length >= MIN_PLAYERS_TO_START
  const estimateMin = Math.max(1, Math.round(estimateDurationSec(settings, players.length) / 60))

  const updateSettings = (patch: Partial<GameSettings>) => {
    void emit('room:updateSettings', { ...settings, ...patch })
  }

  return (
    <div className="lobby-view">
      <h1>Room {roomCode}</h1>

      <ul className="player-list">
        {players.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'disconnected'}>
            {p.name}
            {p.isHost ? ' (host)' : ''}
            {!p.connected ? ' (disconnected)' : ''}
          </li>
        ))}
      </ul>

      {you.isHost ? (
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
              onChange={(e) => updateSettings({ buildTimeSec: Number(e.target.value) as GameSettings['buildTimeSec'] })}
            >
              {BUILD_TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}s
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <p className="lobby-settings-readonly">
          {settings.rounds} rounds &middot; {settings.buildTimeSec}s to build
        </p>
      )}

      <p className="lobby-estimate">Estimated length: ~{estimateMin} min</p>

      {you.isHost && (
        <button disabled={!canStart} onClick={() => void emit('room:start', {})}>
          {canStart ? 'Start game' : `Need at least ${MIN_PLAYERS_TO_START} players`}
        </button>
      )}
    </div>
  )
}
