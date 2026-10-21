import { useCallback, useEffect, useMemo, useState } from 'react'
import { isLogProblem, type AdminLogLine, type AdminLogRoom } from '@smoosh/protocol'
import { adminCall } from './api'
import DetailSheet from './DetailSheet'
import { useOnVisible } from './useOnVisible'

// /admin/logs — the evening's games, read on a phone afterwards: every room
// in the server's recent log, latest first, and each one's story. Device
// models, room codes, player names and timings, so only for the logs list.
//
// What the server keeps in memory since its last restart; journald on the
// box has the rest.

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function when(room: AdminLogRoom, now: number): string {
  const day = (at: number) => new Date(at).toDateString()
  const hm = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const date = day(room.lastAt) === day(now) ? '' : `${new Date(room.lastAt).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, `
  return `${date}${hm(room.firstAt)}–${hm(room.lastAt)}`
}

export default function LogsView() {
  const [rooms, setRooms] = useState<AdminLogRoom[] | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<AdminLogRoom | null>(null)

  const refresh = useCallback(() => {
    adminCall<{ rooms: AdminLogRoom[]; now: number }>('GET', '/logs').then(
      (d) => {
        setRooms(d.rooms)
        setNow(d.now)
        setError(null)
      },
      (err: unknown) => setError(err instanceof Error ? err.message : 'The logs didn’t load.'),
    )
  }, [])
  useEffect(refresh, [refresh])
  useOnVisible(refresh)

  return (
    <div className="prompts-view">
      <div className="prompts-summary">
        <span>{rooms ? `${rooms.filter((r) => r.code).length} room${rooms.filter((r) => r.code).length === 1 ? '' : 's'} since the last restart` : ''}</span>
        <button onClick={refresh}>Refresh</button>
      </div>
      {error && <p className="prompts-error">{error}</p>}
      {rooms === null && !error && <p className="prompts-empty">Loading…</p>}
      {rooms?.length === 0 && <p className="prompts-empty">Nothing logged since the last restart.</p>}
      <ul className="admin-log-rooms">
        {rooms?.map((r) => (
          <li key={r.code ?? 'server'}>
            <button onClick={() => setOpen(r)}>
              <span className="admin-log-code">{r.code ?? 'Server'}</span>
              <span className="admin-log-when">{when(r, now)}</span>
              <span className="admin-log-meta">
                {r.lines} line{r.lines === 1 ? '' : 's'}
                {r.problems > 0 && <span className="admin-log-problems"> · {r.problems} to look at</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && <RoomLog key={open.code ?? 'server'} room={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function RoomLog({ room, onClose }: { room: AdminLogRoom; onClose: () => void }) {
  const [lines, setLines] = useState<AdminLogLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [problemsOnly, setProblemsOnly] = useState(false)

  useEffect(() => {
    adminCall<{ lines: AdminLogLine[] }>('GET', `/logs?room=${room.code ?? 'server'}`).then(
      (d) => setLines(d.lines),
      (err: unknown) => setError(err instanceof Error ? err.message : 'That log didn’t load.'),
    )
  }, [room.code])

  const shown = useMemo(() => (lines ?? []).filter((l) => !problemsOnly || isLogProblem(l)), [lines, problemsOnly])

  return (
    <DetailSheet label={`Log for ${room.code ?? 'the server'}`} title={room.code ?? 'Server'} onClose={onClose}>
      {room.problems > 0 && (
        <label className="prompts-check">
          <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
          Only what to look at ({room.problems})
        </label>
      )}
      {error && <p className="prompts-error">{error}</p>}
      {lines === null && !error && <p className="prompts-empty">Loading…</p>}
      <ol className="admin-log-lines">
        {shown.map((l, i) => (
          <li key={i} className={isLogProblem(l) ? 'problem' : undefined}>
            <time>{time(l.at)}</time> {l.text}
          </li>
        ))}
      </ol>
    </DetailSheet>
  )
}
