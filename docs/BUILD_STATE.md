# Pocket Poker rich invite build state

## Goal
Give shared table URLs a large, Apple-quality iMessage preview, and investigate the cleanest free `workers.dev` URL without breaking the current app.

## Completed locally
- Added a 1200x630 black-and-white invitation card at `public/share/pocket-poker-invite.png`.
- Added full Open Graph, Twitter large-image, canonical, image dimensions/type/alt, and versioned Apple icon metadata.
- Root HTML is now rendered through the Worker with safe room-aware metadata for valid `?room=ABCD` links.
- Native share copy is now an invitation rather than "Poker? Table code".
- Existing API, WebSocket and static asset routing is unchanged.

## URL research
Cloudflare's current documentation says the account `workers.dev` subdomain is configurable and changed in Workers & Pages > Change next to Your subdomain. This means the existing account may be renamed to `pocketpoker`, if available, rather than creating a second account. Changing it affects every Worker route in this account (Pocket Poker, Slate, Logos), so it must not be done while sibling builds depend on current URLs. Preferred no-break route is to retain the account subdomain and use the shorter Worker name `pocket`, yielding `pocket.pocket-poker-gg.workers.dev`; this preserves the account namespace but requires a new Worker/migration or alias strategy for the Durable Object state. Do not rename blindly.

## Remaining
- Run unit tests and local HTTP/meta verification.
- Commit.
- Deploy with existing Cloudflare account credentials, without touching sibling Workers.
- Verify live HTML, image dimensions, app, a real room URL, and mobile screenshot.
- Verify the rich card with an external Open Graph preview renderer. A true Messages screenshot may require the user's iPhone cache to refresh and is not mechanically available from Chrome.
- Push commit to GitHub when credential path is available.

## Deploy finding
First live deploy uploaded the new assets, but Cloudflare's default asset routing served `/` before the Worker, so room-aware substitution did not run. Added `[assets].run_worker_first = true`; redeploy required. This is why live verification is part of the gate.
