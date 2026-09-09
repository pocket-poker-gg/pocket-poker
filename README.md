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

## Bots

The host can add computer opponents from the lobby ("Add a bot", up to the 9-seat table limit). Bots are server-side players inside the room's Durable Object - no client needed, they act on Durable Object alarms after a short human-like think time (well inside the 60s turn timer), survive hibernation and deploys like any other room state, can be kicked like any player between hands, and auto-rebuy if they bust.

Six personality profiles (tightness / aggression / bluff / pace): Aria (tight-aggressive), Gus (loose-aggressive), Mabel (rock), Dex (balanced), Ruby (loose-passive), Hal (maniac). Decision logic (`src/bots.js`): Chen-formula preflop scoring with position- and action-dependent ranges, postflop made-hand strength plus draw/out counting and board-texture discounts, pot-odds-driven calls, value bets/raises, semi-bluffs on strong draws, position-weighted bluffs, and stack/commitment awareness. Bots never fold when checking is free, never fold near-nuts, and every action is validated against the engine's `availableActions`.

Tests: `node --test test/engine.test.mjs test/bots.test.mjs` (unit + 300-hand all-bot property test: termination, chip conservation, VPIP/raise/all-in sanity, profile spread) and `BASE=<url> node test/e2e-bots.mjs` (live spectation: add bots, play 3 hands, kick).
