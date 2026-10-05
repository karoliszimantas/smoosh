import {
  DEFAULT_SETTINGS,
  POINTS_PER_RATING_STAR,
  UPLOAD_MESSAGES,
  type AckResult,
  type RoomEvent,
  type ClientToServerEvents,
  type GameSettings,
  type PhaseState,
  type Player,
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
  private ratings = new Map<string, number>()
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
      case 'rate':
        this.startRateResult()
        break
      case 'reveal':
      case 'rateResult':
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
    const author = this.players.find((x) => x.id === p.authorId)?.name ?? '?'
    return `${p.phase} · ${p.pictureIndex + 1}/${p.pictureCount} · ${author}`
  }

  // ---------- phases

  private startBuild(): void {
    this.round += 1
    this.submitted = new Set(this.players.filter((p) => p.id !== YOU_ID && !this.skippers.has(p.id)).map((p) => p.id))
    if (this.yourPicture) URL.revokeObjectURL(this.yourPicture)
    this.yourPicture = null
    const prompts = shuffle(PROMPTS)
    this.prompts = new Map(this.players.map((p, i) => [p.id, prompts[i % prompts.length] ?? '']))
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
    this.ratings = new Map()
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
    } else if (this.settings.mode === 'gallery') {
      this.phase = {
        ...context,
        phase: 'rate',
        imagePath: soloPicturePath(slot.authorId),
        prompt: this.prompts.get(slot.authorId) ?? '',
        deadline: Date.now() + this.settings.answerTimeSec * 1000,
      }
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
    return p.phase === 'lie' || p.phase === 'guess' || p.phase === 'rate' ? p.authorId : ''
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
    const points = new Map<string, number>()
    const add = (id: string, n: number) => points.set(id, (points.get(id) ?? 0) + n)
    for (const [guesser, optionId] of this.guesses) {
      const option = this.options.find((o) => o.id === optionId)
      if (!option) continue
      if (option.authorId === null) {
        add(guesser, 1000)
        add(p.authorId, 1000)
      } else add(option.authorId, 500)
    }
    for (const player of this.players) player.score += points.get(player.id) ?? 0
    const truth = this.options.find((o) => o.authorId === null)
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

  private startRateResult(): void {
    const p = this.phase
    if (p.phase !== 'rate') return
    for (const bot of this.players) {
      if (bot.id !== YOU_ID && bot.id !== p.authorId) this.ratings.set(bot.id, 2 + Math.floor(Math.random() * 4))
    }
    const stars = [...this.ratings.values()]
    const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0]
    for (const s of stars) counts[(s - 1) as 0 | 1 | 2 | 3 | 4] += 1
    const average = stars.length > 0 ? stars.reduce((a, b) => a + b, 0) / stars.length : null
    const points = average === null ? 0 : Math.round(average * POINTS_PER_RATING_STAR)
    const author = this.players.find((x) => x.id === p.authorId)
    if (author) author.score += points
    this.phase = { ...p, phase: 'rateResult', average, counts, points, deadline: Date.now() + 6_000 }
  }

  private startScores(): void {
    const isFinalRound = this.round >= this.settings.rounds
    this.phase = {
      phase: 'scores',
      round: this.round,
      totalRounds: this.settings.rounds,
      isFinalRound,
      scoreboard: this.players.map((p) => ({ playerId: p.id, total: p.score })),
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
        this.startBuild()
        return ok
      case 'room:playAgain':
        this.round = 0
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
      case 'rating:submit': {
        if (phase.phase !== 'rate' || phase.authorId === YOU_ID) return refused('not now')
        this.ratings.set(YOU_ID, (payload as EmitPayload<'rating:submit'>).stars)
        this.startRateResult()
        return ok
      }
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
    if (p.phase === 'rate') acted = author === YOU_ID || this.ratings.has(YOU_ID)
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
        secretPrompt: p.phase === 'build' ? (this.prompts.get(YOU_ID) ?? '') : null,
        hasActedThisPhase: acted,
        ownOptionId: p.phase === 'guess' ? (this.options.find((o) => o.authorId === YOU_ID)?.id ?? null) : null,
        ownRating: p.phase === 'rate' ? (this.ratings.get(YOU_ID) ?? null) : null,
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
