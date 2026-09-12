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
The asset binding canonicalizes `/index.html` to `/`, so fetching `/index.html` from the Worker returned a 307 and prevented replacement. Fixed by passing the original root request to `env.ASSETS`; no recursion occurs because this calls the asset binding, not the Worker entrypoint.

## Shipped and verified (2026-09-12)
- Production deployment: `https://pocket-poker.pocket-poker-gg.workers.dev`
- Version: `659c906f-3c45-4217-949c-a6dbdb24f552`
- Real production room metadata verified with room `YU4R`: room-specific title, description, canonical URL, OG image, and Twitter large image all emitted server-side.
- Live invite image verified as PNG RGB 1200x630.
- External OpenGraph.xyz scan: 0 errors, 1 non-card warning (generic SEO meta description length), all social preview requirements green; rendered image and room title correctly.
- 19/19 engine + bot tests pass. Mobile app visually checked at 390x844.

## URL decision
Do not rename the account subdomain. Cloudflare now permits this, contrary to the initial assumption, but the account hosts Pocket Poker, Slate, and Logos. Renaming it would simultaneously change all three public URLs and break existing links. Creating a new account would split Durable Object state and credentials for cosmetic gain. `pocketpoker.workers.dev` is also not a valid single Worker route shape in the current Cloudflare model: Workers use `<worker>.<account-subdomain>.workers.dev`. The safe free route is to keep the existing stable URL. A shorter route like `pocket.pocket-poker-gg.workers.dev` would be a separate Worker and would not preserve existing room state without a migration/alias design. No URL mutation performed.
