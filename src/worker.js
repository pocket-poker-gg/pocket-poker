import { makeRoomCode } from './engine.js';
import { PokerRoom } from './room.js';
export { PokerRoom };

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss:; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};
function secure(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function json(obj, status = 200) {
  return secure(new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }));
}
async function reserveRoom(env) {
  for (let i = 0; i < 24; i++) {
    const code = makeRoomCode();
    const id = env.ROOMS.idFromName(code);
    const res = await env.ROOMS.get(id).fetch(new Request(`https://room.internal/reserve`, { method: 'POST' }));
    if (res.status === 204) return code;
  }
  throw new Error('Unable to reserve room');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/rooms' && request.method === 'POST') return json({ code: await reserveRoom(env) });
      const m = url.pathname.match(/^\/ws\/([A-Z2-9]{4})$/);
      if (m) {
        if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return secure(new Response('Expected WebSocket', { status: 426 }));
        const id = env.ROOMS.idFromName(m[1]);
        return env.ROOMS.get(id).fetch(request);
      }
      if (request.method === 'GET' && url.pathname === '/') {
        const asset = await env.ASSETS.fetch(request);
        if (!asset.ok) return secure(asset);
        const code = (url.searchParams.get('room') || '').toUpperCase();
        const roomCode = /^[A-Z2-9]{4}$/.test(code) ? code : null;
        const origin = url.origin;
        const canonicalUrl = roomCode ? `${origin}/?room=${roomCode}` : `${origin}/`;
        const pageTitle = roomCode ? `Join table ${roomCode} · Pocket Poker` : 'Pocket Poker';
        const title = roomCode ? `You’re invited to table ${roomCode}` : 'Pocket Poker — cards with friends';
        const description = roomCode ? `Table ${roomCode} is open. Tap to take your seat — no account or install.` : `No-limit hold’em with friends. No accounts, no installs, play money only.`;
        const escapeHtml = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        const html = (await asset.text()).replaceAll('%%PAGE_TITLE%%', escapeHtml(pageTitle)).replaceAll('%%OG_TITLE%%', escapeHtml(title)).replaceAll('%%OG_DESCRIPTION%%', escapeHtml(description)).replaceAll('%%OG_URL%%', escapeHtml(canonicalUrl)).replaceAll('%%OG_ORIGIN%%', escapeHtml(origin));
        const headers = new Headers(asset.headers);
        headers.set('content-type', 'text/html; charset=UTF-8');
        headers.set('cache-control', 'public, max-age=0, must-revalidate');
        return secure(new Response(html, { status: asset.status, headers }));
      }
      return secure(await env.ASSETS.fetch(request));
    } catch (error) {
      console.error(JSON.stringify({ event: 'request_error', path: url.pathname, message: error?.message || 'unknown' }));
      return json({ error: 'Request failed' }, 500);
    }
  },
};
