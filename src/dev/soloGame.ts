import {
  AWARDS_HOLD_MS,
  DEFAULT_SETTINGS,
  EMPTY_BREAKDOWN,
  PROMPT_CHOICE_SEC,
  PROMPT_WINDOW_SEC,
  swapAllowance,
  addToBreakdown,
  scorePicture,
  UPLOAD_MESSAGES,
  announcements,
  awardsTimeline,
  galleryResults,
  runnerUpRequired,
  type AckResult,
  type RoomEvent,
  type ClientToServerEvents,
  type GameSettings,
  type PhaseState,
  type Player,
  type PointsBreakdown,
  type RoomSnapshot,
} from '@smoosh/protocol'
import type { AckArg, ConnectionEvent, EmitPayload, GameTransport } from '../game/services'
import { generateId } from '../id'
import { FIXTURE_PLAYERS, YOU_ID, samplePicture, soloPicturePath } from './fixtures'

// A whole game on this device: you plus three bots, no server. It follows
// the real game's flow — build, then every player's slot in a shuffled
// order (a placeholder for anyone whose picture is missing), then scores —
// but moves on only when you act or press Next, so every screen can be
// looked at for as long as needed. Rules are simplified where they don't
// change what's on screen.

const ROOM_CODE = 'SOLO'

const PROMPTS = [
  'a cat riding a bicycle',
  'grandma at the beach',
  'a dog in a bathtub',
  'pirates eating soup',
  'a very tired astronaut',
  'two ducks on a date',
  'a haunted vending machine',
  'a horse doing taxes',
]

const BOT_LIES = ['a goat at a wedding', 'the last slice of pizza', 'a sad clown on holiday', 'robots at the gym']

type Slot = { authorId: string; hasPicture: boolean }
type Option = { id: string; text: string; authorId: string | null }

type Connection = {
  handlers: Map<ConnectionEvent, (() => void)[]>
  snapshotFns: ((s: RoomSnapshot) => void)[]
  eventFns: ((e: RoomEvent) => void)[]
  closed: boolean
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = copy[i]
    const b = copy[j]
    if (a === undefined || b === undefined) continue
    copy[i] = b
    copy[j] = a
  }
  return copy
}

function pick<T>(items: readonly T[]): T | undefined {
  return items[Math.floor(Math.random() * items.length)]
}

export class SoloGame {
  // bots that sit out the next BUILD, so a placeholder comes up among the
  // real pictures
  readonly skippers = new Set<string>(['bob'])
  connected = true

  private players: Player[] = FIXTURE_PLAYERS.map((p) => ({ ...p, score: 0 }))
  private settings: GameSettings = { ...DEFAULT_SETTINGS, rounds: 3 }
  private phase: PhaseState = { phase: 'lobby' }
  private round = 0
  private queue: Slot[] = []
  private index = -1
  private prompts = new Map<string, string>()
  private submitted = new Set<string>()
  private yourPicture: string | null = null
  private lies = new Map<string, string>()
  private options: Option[] = []
  private guesses = new Map<string, string>()
  private votes = new Map<string, { favourite: string; runnerUp: string | null }>()
  private exhibition: { round: number; prompt: string; authorId: string; imagePath: string }[] = []
  private roundPoints = new Map<string, PointsBreakdown>()
  // your prompt window this build (guess), and swaps spent this game
  private window: { endsAt: number; started: boolean; offered: string | null } | null = null
  private swapsUsed = 0
  private burned = new Set<string>()
  private gamePoints = new Map<string, PointsBreakdown>()
  private connections = new Set<Connection>()
  // emits made while "disconnected" — socket.io buffers these and sends
  // them on reconnect, so this does too
  private buffered: (() => void)[] = []

  private readonly onSnapshot: (s: RoomSnapshot) => void

  constructor(onSnapshot: (s: RoomSnapshot) => void) {
    this.onSnapshot = onSnapshot
  }

  // ---------- the transport the game's useGameConnection talks to

  connect(): GameTransport {
    const conn: Connection = { handlers: new Map(), snapshotFns: [], eventFns: [], closed: false }
    this.connections.add(conn)
    setTimeout(() => {
      if (conn.closed || !this.connected) return
      this.fire(conn, 'connect')
      this.pushTo(conn)
    }, 0)
    return {
      on: (event, fn) => {
        const list = conn.handlers.get(event) ?? []
        list.push(fn)
        conn.handlers.set(event, list)
      },
      onSnapshot: (fn) => {
        conn.snapshotFns.push(fn)
      },
      onRoomEvent: (fn) => {
        conn.eventFns.push(fn)
      },
      isConnected: () => this.connected,
      reconnect: () => {
        this.dropConnection()
        setTimeout(() => this.restoreConnection(), 300)
      },
      emit: <E extends keyof ClientToServerEvents>(event: E, payload: EmitPayload<E>, ack: (r: AckArg<E>) => void) => {
        const run = () => {
          ack(this.act(event, payload) as AckArg<E>)
          this.push()
        }
        if (this.connected) setTimeout(run, 0)
        else this.buffered.push(run)
      },
      close: () => {
        conn.closed = true
        this.connections.delete(conn)
      },
    }
  }

  dropConnection(): void {
    if (!this.connected) return
    this.connected = false
    for (const conn of this.connections) this.fire(conn, 'disconnect')
  }

  restoreConnection(): void {
    if (this.connected) return
    this.connected = true
    for (const conn of this.connections) {
      this.fire(conn, 'connect')
      this.pushTo(conn)
    }
    const buffered = this.buffered
    this.buffered = []
    for (const run of buffered) setTimeout(run, 0)
  }

  // the picture upload, answered here instead of by the server — by the
  // same rule: accepted while BUILD is open (grace window included)
  receiveUpload(body: BodyInit | null | undefined): Response {
    if (this.phase.phase !== 'build') return new Response(UPLOAD_MESSAGES.too_late, { status: 409 })
    if (this.yourPicture) URL.revokeObjectURL(this.yourPicture)
    this.yourPicture = body instanceof Blob ? URL.createObjectURL(body) : null
    this.submitted.add(YOU_ID)
    // everyone has submitted — like the server, don't wait out the clock. A
    // bot sitting the round out counts as still building, so this waits for
    // Next, the way the server waits for the deadline
    if (this.players.every((p) => this.submitted.has(p.id))) this.endBuild()
    this.push()
    return new Response('ok', { status: 200 })
  }

  pictureFor(playerId: string): string {
    return playerId === YOU_ID && this.yourPicture ? this.yourPicture : samplePicture(playerId)
  }

  // ---------- the Next button: what the timer would do, now

  next(): void {
    switch (this.phase.phase) {
      case 'lobby':
        this.startBuild()
        break
      case 'build':
        // first press: the deadline (phones auto-submit); second: grace over
        if (!this.phase.collecting) this.phase = { ...this.phase, collecting: true }
        else this.endBuild()
        break
      case 'lie':
        this.startGuess()
        break
      case 'guess':
        this.startReveal()
        break
      case 'vote':
        this.startAwards()
        break
      case 'awards':
        this.startScores()
        break
      case 'reveal':
      case 'missing':
        this.nextSlot()
        break
      case 'scores':
        if (!this.phase.isFinalRound) this.startBuild()
        break
    }
    this.push()
  }

  describe(): string {
    const p = this.phase
    if (p.phase === 'lobby') return 'lobby'
    if (p.phase === 'build') return `build, round ${p.round}${p.collecting ? ' (grace window)' : ''}`
    if (p.phase === 'scores') return `scores${p.isFinalRound ? ' (final)' : ''}`
    if (p.phase === 'vote') return `vote, round ${p.round}`
    if (p.phase === 'awards') return `awards, round ${p.round}${p.skipped ? ' (skipped)' : ''}`
    if (!('authorId' in p)) return p.phase
    const author = this.players.find((x) => x.id === p.authorId)?.name ?? '?'
    return `${p.phase} · ${p.pictureIndex + 1}/${p.pictureCount} · ${author}`
  }

  // ---------- phases

  private startBuild(): void {
    this.round += 1
    this.roundPoints = new Map()
    if (this.round === 1) {
      this.swapsUsed = 0
      this.burned = new Set()
    }
    this.submitted = new Set(this.players.filter((p) => p.id !== YOU_ID && !this.skippers.has(p.id)).map((p) => p.id))
    if (this.yourPicture) URL.revokeObjectURL(this.yourPicture)
    this.yourPicture = null
    const prompts = shuffle(PROMPTS)
    // gallery: one prompt for everybody (none in freestyle)
    const shared = this.settings.prompted ? (prompts[0] ?? '') : ''
    this.prompts = new Map(
      this.players.map((p, i) => [p.id, this.settings.mode === 'gallery' ? shared : (prompts[i % prompts.length] ?? '')]),
    )
    for (const prompt of this.prompts.values()) this.burned.add(prompt)
    this.window =
      this.settings.mode === 'guess' ? { endsAt: Date.now() + PROMPT_WINDOW_SEC * 1000, started: false, offered: null } : null
    this.phase = {
      phase: 'build',
      round: this.round,
      totalRounds: this.settings.rounds,
      deadline: Date.now() + this.settings.buildTimeSec * 1000,
      collecting: false,
    }
  }

  private endBuild(): void {
    this.queue = shuffle(this.players).map((p) => ({ authorId: p.id, hasPicture: this.submitted.has(p.id) }))
    this.index = -1
    if (!this.queue.some((s) => s.hasPicture)) this.startScores()
    else if (this.settings.mode === 'gallery') this.startVote()
    else this.nextSlot()
  }

  private nextSlot(): void {
    this.index += 1
    const slot = this.queue[this.index]
    if (!slot) {
      this.startScores()
      return
    }
    this.lies = new Map()
    this.guesses = new Map()
    this.options = []
    const context = {
      round: this.round,
      totalRounds: this.settings.rounds,
      pictureIndex: this.index,
      pictureCount: this.queue.length,
      authorId: slot.authorId,
    }
    if (!slot.hasPicture) {
      this.phase = { ...context, phase: 'missing', deadline: Date.now() + 4_000 }
    } else {
      this.phase = {
        ...context,
        phase: 'lie',
        imagePath: soloPicturePath(slot.authorId),
        deadline: Date.now() + this.settings.answerTimeSec * 1000,
      }
    }
  }

  private currentAuthor(): string {
    const p = this.phase
    return p.phase === 'lie' || p.phase === 'guess' ? p.authorId : ''
  }

  private startGuess(): void {
    const p = this.phase
    if (p.phase !== 'lie') return
    const bots = this.players.filter((x) => x.id !== YOU_ID && x.id !== p.authorId)
    const lies = shuffle(BOT_LIES)
    bots.forEach((bot, i) => this.lies.set(bot.id, lies[i % lies.length] ?? 'something else'))
    this.options = shuffle([
      { id: generateId(), text: this.prompts.get(p.authorId) ?? '', authorId: null },
      ...[...this.lies].map(([authorId, text]) => ({ id: generateId(), text, authorId })),
    ])
    this.phase = {
      ...p,
      phase: 'guess',
      options: this.options.map((o) => ({ id: o.id, text: o.text })),
      deadline: Date.now() + this.settings.answerTimeSec * 1000,
    }
  }

  private startReveal(): void {
    const p = this.phase
    if (p.phase !== 'guess') return
    for (const bot of this.players) {
      if (bot.id === YOU_ID || bot.id === p.authorId) continue
      const choice = pick(this.options.filter((o) => o.authorId !== bot.id))
      if (choice) this.guesses.set(bot.id, choice.id)
    }
    const truth = this.options.find((o) => o.authorId === null)
    // the real scoring, at this round's table size
    const deltas = scorePicture({
      players: this.queue.length,
      authorId: p.authorId,
      truthOptionId: truth?.id ?? '',
      lies: this.options.flatMap((o) => (o.authorId === null ? [] : [{ optionId: o.id, authorId: o.authorId }])),
      guesses: [...this.guesses].map(([playerId, optionId]) => ({ playerId, optionId })),
    })
    const points = new Map<string, number>()
    for (const d of deltas) {
      points.set(d.playerId, (points.get(d.playerId) ?? 0) + d.points)
      this.roundPoints.set(d.playerId, addToBreakdown(this.roundPoints.get(d.playerId) ?? EMPTY_BREAKDOWN, d))
      this.gamePoints.set(d.playerId, addToBreakdown(this.gamePoints.get(d.playerId) ?? EMPTY_BREAKDOWN, d))
    }
    for (const player of this.players) player.score += points.get(player.id) ?? 0
    this.phase = {
      ...p,
      phase: 'reveal',
      options: this.options.map((o) => ({
        id: o.id,
        text: o.text,
        isTruth: o.authorId === null,
        authorId: o.authorId,
        pickedBy: [...this.guesses].filter(([, id]) => id === o.id).map(([guesser]) => guesser),
      })),
      realOptionId: truth?.id ?? '',
      pointsThisPicture: [...points].map(([playerId, n]) => ({ playerId, points: n })),
      deadline: Date.now() + 8_000,
    }
  }

  // ---------- gallery: the whole round at once, then the awards

  private votable(voterId: string): string[] {
    return this.queue.filter((s) => s.hasPicture && s.authorId !== voterId).map((s) => s.authorId)
  }

  private startVote(): void {
    this.votes = new Map()
    this.phase = {
      phase: 'vote',
      round: this.round,
      totalRounds: this.settings.rounds,
      prompt: this.prompts.get(YOU_ID) ?? '',
      pictures: this.queue.map((s) => ({ authorId: s.authorId, imagePath: s.hasPicture ? soloPicturePath(s.authorId) : null })),
      deadline: Date.now() + this.settings.answerTimeSec * 1000,
    }
  }

  private startAwards(): void {
    const p = this.phase
    if (p.phase !== 'vote') return
    // the bots vote at random — a runner-up whenever one is required
    for (const bot of this.players) {
      if (bot.id === YOU_ID) continue
      const choices = shuffle(this.votable(bot.id))
      const [favourite, second] = choices
      if (!favourite) continue
      const runnerUp = second && (runnerUpRequired(choices.length) || Math.random() < 0.5) ? second : null
      this.votes.set(bot.id, { favourite, runnerUp })
    }
    const authors = this.queue.filter((s) => s.hasPicture).map((s) => s.authorId)
    const results = galleryResults(
      authors,
      [...this.votes].map(([voterId, v]) => ({ voterId, ...v })),
    )
    for (const r of results) {
      const author = this.players.find((x) => x.id === r.authorId)
      if (author) author.score += r.points
      if (r.award === 'best') {
        this.exhibition.push({ round: this.round, prompt: p.prompt, authorId: r.authorId, imagePath: soloPicturePath(r.authorId) })
      }
    }
    const order = announcements(results)
    const startsAt = Date.now()
    this.phase = {
      phase: 'awards',
      round: this.round,
      totalRounds: this.settings.rounds,
      prompt: p.prompt,
      pictures: results.map((r) => ({ ...r, imagePath: soloPicturePath(r.authorId) })),
      announcements: order,
      startsAt,
      skipped: false,
      deadline: startsAt + awardsTimeline(order).totalMs,
    }
  }

  private startScores(): void {
    const isFinalRound = this.round >= this.settings.rounds
    this.phase = {
      phase: 'scores',
      round: this.round,
      totalRounds: this.settings.rounds,
      isFinalRound,
      scoreboard: this.players.map((p) => ({
        playerId: p.id,
        total: p.score,
        round: this.settings.mode === 'guess' ? (this.roundPoints.get(p.id) ?? EMPTY_BREAKDOWN) : null,
        game: this.settings.mode === 'guess' ? (this.gamePoints.get(p.id) ?? EMPTY_BREAKDOWN) : null,
      })),
      exhibition: [...this.exhibition],
      deadline: isFinalRound ? null : Date.now() + 6_000,
    }
  }

  // ---------- what you send

  private act(event: keyof ClientToServerEvents, payload: unknown): AckResult<unknown> {
    const ok: AckResult<unknown> = { ok: true, data: undefined }
    const phase = this.phase
    switch (event) {
      case 'room:create':
        return { ok: true, data: { roomCode: ROOM_CODE } }
      case 'room:join':
        return ok
      case 'room:updateSettings':
        if (phase.phase === 'lobby') this.settings = payload as GameSettings
        return ok
      case 'room:start':
        // Chain needs real players passing pictures — try it with a room
        if (this.settings.mode === 'chain') return refused('Chain isn’t in the solo walkthrough — play it in a room')
        this.startBuild()
        return ok
      case 'chainVote:submit':
      case 'chainReveal:skip':
        return refused('not in solo')
      case 'room:playAgain':
        this.round = 0
        this.exhibition = []
        this.gamePoints = new Map()
        for (const p of this.players) p.score = 0
        this.phase = { phase: 'lobby' }
        return ok
      case 'lie:submit': {
        if (phase.phase !== 'lie' || phase.authorId === YOU_ID) return refused('not now')
        this.lies.set(YOU_ID, (payload as EmitPayload<'lie:submit'>).text)
        this.startGuess()
        return ok
      }
      case 'guess:submit': {
        if (phase.phase !== 'guess' || phase.authorId === YOU_ID) return refused('not now')
        this.guesses.set(YOU_ID, (payload as EmitPayload<'guess:submit'>).optionId)
        this.startReveal()
        return ok
      }
      // nothing to keep track of with nobody else really here
      case 'room:leave':
      case 'presence:away':
        return ok
      case 'vote:submit': {
        if (phase.phase !== 'vote' || this.votes.has(YOU_ID)) return refused('not now')
        const { favourite, runnerUp } = payload as EmitPayload<'vote:submit'>
        const votable = this.votable(YOU_ID)
        if (favourite === YOU_ID || runnerUp === YOU_ID) return refused('you cannot vote for your own picture')
        if (!votable.includes(favourite) || (runnerUp !== null && (!votable.includes(runnerUp) || runnerUp === favourite))) {
          return refused('that picture is not up for a vote')
        }
        if (runnerUp === null && runnerUpRequired(votable.length)) return refused('pick a runner-up too')
        this.votes.set(YOU_ID, { favourite, runnerUp })
        this.startAwards()
        return ok
      }
      // your prompt window — the server's rules, simplified (no timers here)
      case 'prompt:swap': {
        const w = this.window
        if (phase.phase !== 'build' || !w || w.started || w.offered || Date.now() >= w.endsAt) return refused('too late to swap')
        if (this.swapsUsed >= swapAllowance(this.settings.rounds)) return refused('no swaps left this game')
        const offered = shuffle(PROMPTS.filter((p) => !this.burned.has(p)))[0]
        if (!offered) return refused('no prompts to spare')
        this.burned.add(offered)
        this.swapsUsed += 1
        this.window = { ...w, offered, endsAt: Math.max(w.endsAt, Date.now() + PROMPT_CHOICE_SEC * 1000) }
        return ok
      }
      case 'prompt:keep':
      case 'build:begin': {
        const w = this.window
        if (phase.phase !== 'build' || !w || w.started) return ok
        const keep = event === 'prompt:keep' ? (payload as EmitPayload<'prompt:keep'>).keep : 'swapped'
        if (w.offered && keep === 'swapped') this.prompts.set(YOU_ID, w.offered)
        // the clock starts now: your build gets its full time from here
        this.window = { endsAt: Date.now(), started: true, offered: null }
        this.phase = { ...phase, deadline: Date.now() + this.settings.buildTimeSec * 1000 }
        return ok
      }
      case 'awards:skip':
        if (phase.phase === 'awards' && !phase.skipped) {
          this.phase = { ...phase, skipped: true, deadline: Date.now() + AWARDS_HOLD_MS }
        }
        return ok
    }
  }

  // ---------- snapshots

  private snapshot(): RoomSnapshot {
    const p = this.phase
    const author = this.currentAuthor()
    let acted = false
    if (p.phase === 'build') acted = this.submitted.has(YOU_ID)
    if (p.phase === 'lie') acted = author === YOU_ID || this.lies.has(YOU_ID)
    if (p.phase === 'guess') acted = author === YOU_ID || this.guesses.has(YOU_ID)
    if (p.phase === 'vote') acted = this.votes.has(YOU_ID)
    return {
      roomCode: ROOM_CODE,
      settings: this.settings,
      players: this.players.map((x) => (x.id === YOU_ID ? { ...x, presence: this.connected ? 'present' : 'away' } : x)),
      phase: p,
      // bots act instantly, so only BUILD ever waits on anyone
      waitingOn: p.phase === 'build' ? this.players.filter((x) => !this.submitted.has(x.id)).map((x) => x.id) : [],
      you: {
        playerId: YOU_ID,
        isHost: true,
        secretPrompt:
          p.phase === 'build'
            ? (this.window && !this.window.started && this.window.offered && Date.now() >= this.window.endsAt
                ? this.window.offered
                : (this.prompts.get(YOU_ID) ?? ''))
            : null,
        hasActedThisPhase: acted,
        ownOptionId: p.phase === 'guess' ? (this.options.find((o) => o.authorId === YOU_ID)?.id ?? null) : null,
        ownVote: p.phase === 'vote' ? (this.votes.get(YOU_ID) ?? null) : null,
        pass: null,
        chainVote: null,
        build:
          p.phase === 'build'
            ? {
                windowEndsAt: this.window && !this.window.started && Date.now() < this.window.endsAt ? this.window.endsAt : null,
                deadline: p.deadline,
                swapsLeft: Math.max(0, swapAllowance(this.settings.rounds) - this.swapsUsed),
                canSwap:
                  !!this.window &&
                  !this.window.started &&
                  !this.window.offered &&
                  this.swapsUsed < swapAllowance(this.settings.rounds),
                offered: this.window && !this.window.started ? this.window.offered : null,
              }
            : null,
      },
    }
  }

  private push(): void {
    if (!this.connected) return
    for (const conn of this.connections) this.pushTo(conn)
  }

  private pushTo(conn: Connection): void {
    const snap = this.snapshot()
    for (const fn of conn.snapshotFns) fn(snap)
    this.onSnapshot(snap)
  }

  private fire(conn: Connection, event: ConnectionEvent): void {
    for (const fn of conn.handlers.get(event) ?? []) fn()
  }
}

function refused(message: string): AckResult<unknown> {
  return { ok: false, code: 'PHASE_MISMATCH', message }
}
