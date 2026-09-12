# Pocket Poker audit compliance build

## Mandate
Close the third-party enterprise audit without changing the four-character table-code UX or breaking live play. Preserve the Apple-quality UI and free Cloudflare deployment.

## Baseline audit (2026-09-12)
Already present: single authoritative Durable Object per table; server-owned deck/actions/stacks/pots; per-player sanitized views; hibernating WebSockets; durable state after transitions; high-entropy reconnect token; heads-up rules; side pots; chip conservation/property smoke tests; PWA metadata; reconnect UI.

P0/P1 gaps found:
- Unknown guessed codes could instantiate tables; create did not atomically reserve/check collisions.
- Reconnect token was 128-bit rather than requested 256-bit.
- WebSockets lacked Origin enforcement, schema size limits, protocol version, action sequence and replay IDs.
- A replaced socket could mark a reconnected player disconnected.
- Static/dynamic responses lacked the full strict security-header set.
- Proof suite was far below audit bar: no exhaustive evaluator census, seeded deck vectors, adversarial protocol/replay tests, or chaos/restart suite.

## Hard constraints
- Keep visible 4-character codes exactly.
- No payment method / paid service.
- Preserve routes and existing Durable Object state.
- Do not touch sibling repos.

## Work plan
1. P0/P1 server and protocol hardening.
2. Proof layer: exhaustive evaluator, golden/seeded vectors, properties, multi-client, chaos/restart.
3. Full tests, deploy, live verification, 390x844 visual proof, push.
