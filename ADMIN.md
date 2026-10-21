# Admin

`/admin` holds prompts, labels and logs behind Google sign-in. This is admin
sign-in only: players never sign in.

## Google sign-in is broken: break glass

Use this only when Google sign-in itself is failing, for example Google is
down, the OAuth client was deleted, or the config is wrong.

1. On the phone, open **`https://<the game's domain>/admin/break-glass`**.
   Nothing links there.
2. Paste the **break-glass token**, which is stored in your password manager
   as "smoosh break-glass". It is `ADMIN_BREAK_GLASS_TOKEN` in `server/.env`
   on the game server.
3. Every section opens for **one hour**. A red bar stays at the top while the
   session lasts. Edits are credited to `@break-glass`.

Every use is logged loudly: the sign-in, every request the session makes,
and every wrong or throttled attempt. To see those lines:
`journalctl -u smoosh | grep BREAK-GLASS`.
Five wrong tries from one address, or twenty from anywhere in an hour, and
it stops answering for a while.

Break-glass needs only `ADMIN_SESSION_SECRET` and `ADMIN_BREAK_GLASS_TOKEN`
(both 32+ characters). It works whatever state `GOOGLE_*` and `ADMIN_ORIGIN`
are in. If `ADMIN_BREAK_GLASS_TOKEN` is unset, there is no fallback at all.

If the log shows a break-glass sign-in that wasn't you: change
`ADMIN_BREAK_GLASS_TOKEN` and `ADMIN_SESSION_SECRET` and restart. Changing the
session secret signs everyone out.

## Who gets in

```
ADMIN_EMAILS=a@example.com,b@example.com   # prompts and labels
ADMIN_LOGS_EMAILS=a@example.com            # also logs; must also be on ADMIN_EMAILS
```

The server checks the address against these lists on every request, so
removing someone takes effect at the next restart, whatever their cookie
says. An address that is on neither list sees "You don't have access", and
nothing more. A section someone can't reach is left out of their nav.
Before restarting, check for live games: rooms live in memory.

Sessions last 30 days, in a signed httpOnly cookie on the admin page's own
origin. Signing out clears it.

## Credit for edits

New prompts, votes and label edits are credited as `@` plus the email's
local part: karolis@example.com becomes `@karolis`. The domain is left out
because `tools/asset-labels.tsv` and the prompt export end up in this public
repo. Older rows written under a typed name (`Karolis`) are kept exactly as
they were. A typed name never starts with `@`, because nobody types one any
more, and a typed author on an import can't contain `@`.

Votes are keyed by that credit, so a vote cast under an old typed name and
one cast now as `@name` count as two different voters.

## The laptop: labels:pull and labels:push

Labels sync is machine to machine, so it uses a key, not Google.
`LABELS_SYNC_KEY` is set in both `server/.env` and `tools/.env`, with the same
value. `SMOOSH_SERVER_URL` in `tools/.env` is the game server itself. This key
works only on `/api/labels/file`, and no browser route accepts it.

## Setting it up

1. In Google Cloud Console, go to **APIs & Services → Credentials → Create
   OAuth client ID → Web application**. Add the authorised redirect URI
   `<ADMIN_ORIGIN>/api/admin/auth/callback`. For dev, also add
   `http://localhost:5173/api/admin/auth/callback`. The consent screen
   needs only the `openid` and `email` scopes.
2. In `server/.env`, set `ADMIN_EMAILS`, `ADMIN_LOGS_EMAILS`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_ORIGIN`,
   `ADMIN_SESSION_SECRET`, `ADMIN_BREAK_GLASS_TOKEN` and `LABELS_SYNC_KEY`.
   Generate each secret with `openssl rand -base64 32`. At boot, the server
   logs one `[admin]` line saying what is switched on.
3. Deploy the game server first, then the client. In production,
   `/api/admin/*` reaches the game server through the Worker
   (`worker/index.ts`, `GAME_SERVER_URL` in `wrangler.toml`). That keeps the
   session cookie first-party, which Safari requires. In dev, Vite's proxy
   does the same job.

`/prompts` and `/labels` redirect to `/admin/prompts` and `/admin/labels`.
