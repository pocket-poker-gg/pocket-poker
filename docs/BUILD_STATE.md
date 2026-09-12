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

## Completed remediation
- Preserved the visible four-character code flow, but codes are now atomically reserved before being returned and guessed/unreserved codes cannot instantiate a room.
- Upgraded seat/reconnect capabilities to 256-bit tokens. A reconnect replaces stale transport ownership without duplicating a seat.
- Added strict same-origin WebSocket enforcement, join/connection abuse buckets, 2 KB message ceiling, schema envelope, protocol version, hand number, expected action sequence and unique action ID replay rejection.
- Added one-week idle table expiry while persisting full authoritative hand state/deck/actions at every accepted transition.
- Added CSP/frame denial, HSTS, nosniff, no-referrer, restrictive Permissions Policy and cross-origin isolation header.
- Added safe shell-only service worker. API and WebSocket traffic are never cached or replayed.
- Added proof suite: known evaluator vectors, privacy/token tests, hostile-action mutation checks, 10,000 random 2-9 player hands with invariants, heads-up and short-all-in gates, exhaustive 2,598,960 five-card census, multi-client play/reconnect, CI.

## Verification so far
- 25/25 unit/property tests green on rerun.
- Exhaustive evaluator census green with all 2,598,960 combinations and canonical category counts (~57 sec locally).
- Local three-client end-to-end hand, private-card isolation, chip conservation, reconnect/same-seat recovery, and next-hand continuation green.
- Existing UI markup/layout was not changed. Client changes are protocol envelope, resync safety and service-worker registration only.

## Remaining
- Bot E2E with the updated protocol.
- Deploy to production and run live E2E/security-header checks.
- 390x844 production screenshot and visual inspection.
- Push main and record final version/proof matrix.
