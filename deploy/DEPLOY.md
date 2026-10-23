# Deploying the smoosh server on the Hetzner box

Target shape: the Ubuntu box that already runs trendguessr, systemd + Caddy
(auto-HTTPS). The server is one Node process with in-memory rooms; the client
is static files on Cloudflare Workers and talks to it over socket.io.

Fill in before you start: `<domain>` (the server becomes `smoosh.<domain>`),
`<repo-url>`, and the secrets for `server/.env`.

## 1. Node 22 and pnpm 10

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v                      # v22.x
command -v node              # /usr/bin/node, the path in smoosh.service
sudo corepack enable pnpm    # puts a pnpm shim next to node
```

No build tools needed: sharp ships prebuilt linux-x64 (and arm64) binaries,
so the install downloads them instead of compiling. If it ever starts
compiling from source, the platform has no prebuilt and wants
`sudo apt install build-essential`.

## 2. User and code

```bash
sudo useradd -r -m -d /var/lib/smoosh -s /usr/sbin/nologin smoosh
sudo mkdir /opt/smoosh && sudo chown smoosh:smoosh /opt/smoosh
sudo -u smoosh git clone <repo-url> /opt/smoosh
cd /opt/smoosh               # so smoosh can read the cwd for what follows

# package.json has no packageManager field, so pin the major for this user,
# or corepack hands out whatever pnpm is newest
sudo -u smoosh -H corepack install -g pnpm@10
sudo -u smoosh -H pnpm -v    # 10.x
```

The home is `/var/lib/smoosh`, not `/opt/smoosh`, so pnpm's store and
corepack's cache don't land inside the checkout.

## 3. Dependencies

```bash
sudo -u smoosh -H env npm_config_onnxruntime_node_install_cuda=skip \
  pnpm -C /opt/smoosh install --frozen-lockfile
```

- **Not `--prod`.** The server runs TypeScript through tsx, and tsx is a
  devDependency of `server/`. `--prod` would leave it out and the service
  would not start.
- **The `env` part:** `tools/` depends on onnxruntime-node, whose postinstall
  downloads its CUDA build (hundreds of MB) on linux-x64. Nothing here needs
  it. `tools/` itself stays installed because the moderation tool runs on
  this box (see below).

## 4. Secrets: `server/.env`

```bash
sudo -u smoosh cp /opt/smoosh/server/.env.example /opt/smoosh/server/.env
sudo chmod 600 /opt/smoosh/server/.env
sudo -u smoosh -H nano /opt/smoosh/server/.env
```

Copy the values from the Oracle VM's `server/.env`. What each one is:

| Variable | What it does | Unset |
| --- | --- | --- |
| `PIXABAY_KEY` | in-game image search; never sent to clients | search doesn't work |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 API token for the buckets below | everything stays on local disk |
| `R2_ASSETS_BUCKET` | public bucket for the shared cut library (`smoosh-assets`) | cuts go to `server/data/cuts/` |
| `R2_PUBLIC_URL` | public URL of that bucket (`https://pub-….r2.dev`) | same as above |
| `PROMPT_WRITE_KEY` | code for the shared prompt list at `/prompts`; give it only to collaborators | `/prompts` says it isn't set up |
| `LABELS_WRITE_KEY` | code for the labelling tool at `/labels` | `PROMPT_WRITE_KEY` works there too |
| `R2_PROMPTS_BUCKET` | a PRIVATE bucket for the prompt list and labels | they live in `server/data/` |
| `MEDIA_DATA_DIR` | moves the data dir | leave it commented out: the unit only allows writes to `server/data` |

A store uses R2 only when all of its variables are set: the three
credentials plus `R2_ASSETS_BUCKET` and `R2_PUBLIC_URL` for cuts, plus
`R2_PROMPTS_BUCKET` for prompts. An empty value counts as unset. Don't put
`PORT` or `NODE_ENV` here, the unit sets them.

## 5. Data dir

The server writes `blocklist.json`, `reports.jsonl`, and (when R2 is unset)
the prompt list and local cuts to `/opt/smoosh/server/data`. The path comes
from the source file's location, not the working directory. It must exist
before the service starts: the unit makes everything else read-only.

```bash
sudo -u smoosh mkdir -p /opt/smoosh/server/data
```

Bring the Oracle VM's data over so the blocklist (and the prompt list, if
`R2_PROMPTS_BUCKET` was unset there) survive the move:

```bash
# from your laptop, copying box to box through it
scp -3 -r <oracle-vm>:<path-to-smoosh>/server/data <hetzner>:/tmp/smoosh-data
# on the box
sudo cp -r /tmp/smoosh-data/. /opt/smoosh/server/data/
sudo chown -R smoosh:smoosh /opt/smoosh/server/data
```

## 6. Service

```bash
sudo cp /opt/smoosh/deploy/smoosh.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now smoosh
systemctl status smoosh
curl -s 'http://127.0.0.1:3001/socket.io/?EIO=4&transport=polling'
# sanity: 0{"sid":"…","upgrades":["websocket"],…}
```

The server listens on all interfaces (there's no host setting), so check
that the firewall really keeps 3001 closed:

```bash
sudo ufw status              # only 22, 80, 443
curl -m 5 http://<server-ip>:3001/   # from your laptop: must time out
```

trendguessr's quick test may have left ufw inactive or 8600 open. If
`ufw status` says inactive, allow SSH before enabling it, or you lock
yourself out:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp
sudo ufw enable
sudo ufw delete allow 8600/tcp   # only if the quick test opened it
```

A Hetzner Cloud firewall with the same three ports does the job too.

## 7. HTTPS front door

Point a DNS A record `smoosh.<domain>` at the server's IP first; Caddy needs
it to get the certificate. Then add the site next to trendguessr's:

```bash
cd /opt/smoosh
{ echo; sed 's/smoosh.example.com/smoosh.<domain>/' deploy/Caddyfile; } \
  | sudo tee -a /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -s 'https://smoosh.<domain>/socket.io/?EIO=4&transport=polling'
```

Check trendguessr still answers after the reload.

## 8. Switch the client over

Server first, client second. The new client speaks the new protocol and
needs the new server running before it goes live. The client that is live
now has the Oracle URL baked in, so it never reaches the new server; it
keeps playing on Oracle until the new client replaces it.

On your laptop:

```bash
# in .env.production:
#   VITE_SERVER_URL=https://smoosh.<domain>
# and in wrangler.toml, [vars] GAME_SERVER_URL must point at the same server:
# the Worker proxies /api/admin/* to it (see worker/index.ts).

pnpm exec wrangler login     # once
pnpm run deploy:client       # tsc -b, vite build, wrangler deploy ./dist
```

Commit the `.env.production` change. Then open the game on two phones and
play a round.

Once nobody is in a game on the old client (an open tab keeps talking to
Oracle until it's reloaded), stop the server on the Oracle VM and delete the
VM. It holds a copy of `server/.env`, so rotate the R2 token and
`PROMPT_WRITE_KEY` if you aren't sure the disk goes with it.

## Things to know

- **One process only.** Rooms are in process memory. Don't run a second copy
  or put a cluster in front of it.
- **A restart clears every room**, mid-game ones included. Update between
  games.
- **Logs:** `journalctl -u smoosh -f` (live), `journalctl -u smoosh --since
  today`. Each finished round logs a `[round]` line.
- **Updating:**

  ```bash
  sudo -u smoosh git -C /opt/smoosh pull
  sudo -u smoosh -H env npm_config_onnxruntime_node_install_cuda=skip \
    pnpm -C /opt/smoosh install --frozen-lockfile
  sudo systemctl restart smoosh
  ```

  If `deploy/smoosh.service` changed, copy it again and `daemon-reload` before
  the restart. If the protocol changed, update the server first and run
  `pnpm run deploy:client` right after: from then on the live client talks
  to the new server, so keep the gap short and do both between games.
- **Moderation** runs here, on the same data dir:
  `sudo -u smoosh -H pnpm -C /opt/smoosh/tools moderate list`
  (`block <id>` / `unblock <id>`). Deleting stored cuts from R2 needs the R2
  variables in `tools/.env`.
