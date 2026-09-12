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

## E2F7 screenshot regression (fixed)
The screenshot was mathematically misleading, not a wrong winner or lost chips. Aria's K7 correctly beat 67 on K-9-9-Q-3 and her final 790 stack was correct. The defect was settlement presentation: a 210 unmatched all-in excess was built as a one-player side pot and merged into “Aria wins 790.” Poker rules require that excess to be returned, not won. Settlement now refunds unmatched excess before pot-layer construction, reports only the 580 genuinely contested pot as winnings, and records the 210 refund separately. A regression test recreates the exact cards and 290-vs-500 contribution ledger.

## Production closeout
- Deployed Worker version `9b75191b-390f-4b8a-a3e3-078c214d3c1b`.
- Live three-client hand, private-card isolation, chip conservation, reconnect to same seat and next-hand continuation passed.
- Live guessed/unreserved room returned 404; reserved room with foreign Origin returned 403.
- Live response exposes CSP/frame-ancestors none, HSTS, nosniff, no-referrer, Permissions Policy, COOP and X-Frame-Options deny.


## Best current hand indicator (2026-09-12)
- Baseline verified before changes: 26/26 tests and exhaustive 2,598,960-hand evaluator census green.
- Added a private player-facing `bestHand` summary computed by the authoritative evaluator from the player's hole cards plus the current board.
- Preflop uses made-hand/high-card descriptions; flop through river uses `pokersolver`'s exact best-five description.
- UI is an understated monochrome capsule between the player's cards and identity, hidden outside a dealt hand.
- Added street progression and privacy regressions. 28/28 tests and exhaustive evaluator census green after changes.
- Deployed Worker version `e83b7c0c-ac2b-49f8-8cf3-6542a59903aa`; local multi-client E2E passed and a live host-vs-bot game was played through showdown.
- Verified production at 390x844 from preflop through flop, turn, river and showdown. The capsule stays below the hole cards without covering the table or action controls.

## Table layout declutter (2026-09-12)
- Rebuilt seat geometry: per-slot arrangements ('down' stacks cards/bet below the pill toward center with horizontal lean clamped to 0.42; 'side'/'low' seats hang cards straight inward at +/-72px and tuck bets below them at +26/+32px; dealer button attached to the pill corner toward cards at (+/-46, -26) or a*20+t*30).
- Street label moved out of the pot line to a caption under the community cards; pot pill stands alone above the board. Bet badges can no longer collide with the pot pill or street label in any 2-9 handed layout.
- Seat z-order: bet > cards > pill, dealer button on top.
- 28/28 tests + exhaustive census green after changes. Verified live at 390x844: 2-handed preflop, 4-handed preflop/showdown, 6-handed preflop with three bet badges out, 6-handed river with board + RIVER caption, 6-handed showdown with reveal. No overlaps, no clipping.
- The half-clipped panel at the right viewport edge in the user's screenshot is not app UI - never reproduced in any state; consistent with iOS/Safari edge chrome.
- Deployed Worker version 9c82229b-4270-4862-a195-0c645dbc689f; main at 9a6048d + this note.

## Custom avatar heads (2026-09-12)
- Deterministic monochrome SVG avatar heads: tone(5) x face(4) x eyes(6) x brows(5) x mouth(6) x hair(6) x glasses(4), all grayscale in the noir palette.
- Client renderer in public/avatar.js (UMD, also imported by tests); server validation in src/avatar.js; counts parity locked by test.
- Avatar spec stored server-side per player (join payload + 'avatar' message, sanitized); survives reconnect via seat token. localStorage pp_avatar pre-fills and sends on join.
- Players who never open the maker still get a distinct default face derived deterministically from their name (client-side; server avatar stays null).
- Avatar maker sheet: live 128px preview, per-component steppers, shuffle, Done. Entry points: home avatar button next to name input, menu sheet, tap own avatar in me area.
- Rendering: 27px head peeking above each seat pill (behind it, z below cards/bets), 27px in me-info, 24px in lobby rows. Acting/winner rings, folded/offline dimming match the pill.
- Tests: sanitize/join/setAvatar/publicState/rejoin engine tests, client parity + determinism + all-variant render smoke, wire-level e2e (set, broadcast, invalid rejection, no-clobber). 36/36 + e2e green locally.
- Deployed Worker version e2cdb228-256f-4747-b7c2-207bae651aba (main 8042c1b). Verified live at 390x844: home avatar button + live name-derived default, maker sheet (steppers, shuffle, Done), lobby rows, and real bot games at 2, 4 and 6-handed from preflop through showdown - avatars stay above their own seat pill, clear of cards, bet badges, dealer button, best-hand capsule and result banner. Stored avatar survives reload and follows the player into new tables via localStorage + join payload; seat record persists via reconnect token.
- Fix during verification: the maker sheet was initially nested inside the hidden #table section and could not open from the home screen; moved to a top-level overlay (commit 8042c1b).

## Animated cartoon avatars + seat placement fix (2026-09-12, second pass)
- Renderer rebuilt as monochrome cartoon stickers: bold outlined faces, blush, button nose, 8 eyes (big shiny, starry, sleepy, wink...), 6 brows (worried), 8 mouths (tongue, laugh), 8+8 hair styles, heart glasses - 2x5x4x8x6x8x8x5 = 614,400 combos, still pure grayscale.
- New Style row (male/female) in the maker: per-style hair sets (female: pixie, long, bob, ponytail, pigtails...) and lashes on open-eye variants. Specs saved before the pick canonicalize to s:0 and keep working (server sanitize defaults s; client norm() reads old specs).
- Seat placement definitively fixed: avatar is a 38px badge riding the pill's top edge ABOVE it (was a 27px sliver hidden behind the pill - the "barely see the head" jank). Pill gets its own stacking slot; acting timer bar moved to the pill's bottom edge so the badge never covers it.
- Avatars blink (phase-staggered per face so a full table never syncs), idle-bob, and pop with a squash-rotate on a win. prefers-reduced-motion disables all of it.
- Event feed capsule moved into the topbar row (between room code and menu) so it never covers the top seat's avatar.
- Gates: 36/36 unit, e2e.mjs + e2e-bots green (e2e updated to assert canonical spec echo + female round-trip after finding the s-key canonicalization broke exact-echo comparison). Live-verified at 390x844 on production: maker (male + female), 6-handed preflop through showdown with winner reveal, reload persistence of stored spec. Earlier local runs verified 2- and 4-handed and desktop 1280x800.
- Deployed Worker version e8a08dd2-0ed9-40ad-b38b-38ab3b93defe; live avatar.js/styles.css/app.js byte-identical to the validated local build. Deploy creds: new classic PAT "poker deploy" (repo scope, 30-day) in vault "GitHub PAT (poker deploy)"; Cloudflare token pocket-poker-deploy rolled, new value in vault "Cloudflare API token (pocket-poker-deploy)".
