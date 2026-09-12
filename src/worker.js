import { makeRoomCode } from './engine.js';
import { PokerRoom } from './room.js';
export { PokerRoom };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      return json({ code: makeRoomCode() });
    }
    const m = url.pathname.match(/^\/ws\/([A-Z0-9]{4})$/);
    if (m) {
      if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket')
        return new Response('Expected WebSocket', { status: 426 });
      const id = env.ROOMS.idFromName(m[1]);
      return env.ROOMS.get(id).fetch(request);
    }
    // Serve the HTML shell through the Worker so link crawlers receive a room-aware
    // invitation even though the app itself remains a static PWA.
    if (request.method === 'GET' && url.pathname === '/') {
      const asset = await env.ASSETS.fetch(request);
      if (!asset.ok) return asset;

      const code = (url.searchParams.get('room') || '').toUpperCase();
      const roomCode = /^[A-Z0-9]{4}$/.test(code) ? code : null;
      const origin = url.origin;
      const canonicalUrl = roomCode ? `${origin}/?room=${roomCode}` : `${origin}/`;
      const pageTitle = roomCode ? `Join table ${roomCode} · Pocket Poker` : 'Pocket Poker';
      const title = roomCode ? `You’re invited to table ${roomCode}` : 'Pocket Poker — cards with friends';
      const description = roomCode
        ? `Table ${roomCode} is open. Tap to take your seat — no account or install.`
        : `No-limit hold’em with friends. No accounts, no installs, play money only.`;

      const escapeHtml = (value) => value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
      const html = (await asset.text())
        .replaceAll('%%PAGE_TITLE%%', escapeHtml(pageTitle))
        .replaceAll('%%OG_TITLE%%', escapeHtml(title))
        .replaceAll('%%OG_DESCRIPTION%%', escapeHtml(description))
        .replaceAll('%%OG_URL%%', escapeHtml(canonicalUrl))
        .replaceAll('%%OG_ORIGIN%%', escapeHtml(origin));

      const headers = new Headers(asset.headers);
      headers.set('content-type', 'text/html; charset=UTF-8');
      // Room URLs have unique metadata. Revalidate to prevent one room's card
      // from being served for another while still allowing edge revalidation.
      headers.set('cache-control', 'public, max-age=0, must-revalidate');
      return new Response(html, { status: asset.status, headers });
    }
    return env.ASSETS.fetch(request);
  },
};
