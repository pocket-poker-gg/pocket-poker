# Pocket Poker

Multiplayer no-limit Texas Hold'em for friends. No accounts, no installs, play money only.
Open the link, make a table, share the 4-letter code. Live at https://pocket-poker.pocket-poker-gg.workers.dev

## Stack

- Cloudflare Worker serves the static PWA (`public/`) and routes WebSocket traffic.
- One Durable Object per room (`src/room.js`) holds authoritative game state, persists to SQLite storage, hibernates when idle.
- Game engine (`src/engine.js`) is a pure state machine: blinds, min-raise rules, short all-in no-reopen, side pots, split pots with odd-chip rule, uncalled-bet refunds, rebuys, 60s turn timer with auto check/fold.
- Hand evaluation: `pokersolver`.

## Develop

```
npm install
npx wrangler dev          # local dev on :8787
npx node --test test/     # engine unit + property tests
node test/e2e.mjs         # local e2e (needs wrangler dev running)
BASE=https://pocket-poker.pocket-poker-gg.workers.dev node test/e2e.mjs  # prod e2e
```

## Deploy

Set `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit scope) and `CLOUDFLARE_ACCOUNT_ID`, then `npx wrangler deploy`.
