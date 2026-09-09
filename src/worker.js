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
    return env.ASSETS.fetch(request);
  },
};
