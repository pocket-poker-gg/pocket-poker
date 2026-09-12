import {
  createGame, join, addBot, act, startHand, kick, rebuy, availableActions, setAvatar,
  markConnected, timeoutAct, publicState, GameError,
} from './engine.js';
import { decideBotAction } from './bots.js';

const PROTOCOL_VERSION = 2;
const MAX_MESSAGE_BYTES = 2048;
const ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACTION_ID = /^[A-Za-z0-9_-]{8,80}$/;

export class PokerRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = null;
    this.sessions = new Map();
    this.peers = new Map();
    this.rate = new Map();
    this.ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get('state')) || null;
      if (this.state?.hand) {
        if (!Number.isInteger(this.state.hand.actionSeq)) this.state.hand.actionSeq = 0;
        if (!Array.isArray(this.state.hand.recentActionIds)) this.state.hand.recentActionIds = [];
      }
      for (const ws of ctx.getWebSockets()) {
        const att = ws.deserializeAttachment();
        if (att?.pid) this.sessions.set(ws, att.pid);
      }
      this.reconcileConnections();
    });
  }

  reconcileConnections() {
    if (!this.state) return;
    const connected = new Set(this.sessions.values());
    for (const p of this.state.players) p.connected = p.isBot || connected.has(p.id);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/reserve') {
      if (this.state) return new Response('occupied', { status: 409 });
      this.state = createGame(this.ctx.id.name);
      await this.save();
      return new Response(null, { status: 204 });
    }
    if (request.method === 'GET' && url.pathname === '/exists') {
      return new Response(null, { status: this.state ? 204 : 404 });
    }
    if (!this.state) return new Response('Table not found', { status: 404 });
    const configured = this.env.PUBLIC_ORIGIN;
    const expected = configured && url.hostname.endsWith('.workers.dev') ? configured : url.origin;
    const origin = request.headers.get('Origin');
    if (!origin || origin !== expected) return new Response('Forbidden', { status: 403 });
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket')
      return new Response('Expected WebSocket', { status: 426 });
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    const peer = [...new Uint8Array(keyBytes)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
    const now = Date.now();
    const bucket = this.rate.get(peer) || { start: now, count: 0 };
    if (now - bucket.start > 60_000) { bucket.start = now; bucket.count = 0; }
    if (++bucket.count > 30) return new Response('Too many connections', { status: 429 });
    this.rate.set(peer, bucket);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    this.peers.set(server, peer);
    return new Response(null, { status: 101, webSocket: client });
  }

  async save() {
    if (!this.state) return;
    this.state.lastActivityAt = Date.now();
    await this.ctx.storage.put('state', this.state);
    const h = this.state.hand;
    let at = Date.now() + ROOM_TTL_MS;
    if (this.state.status === 'playing' && h?.turnDeadline) {
      at = Math.min(at, h.turnDeadline + 400);
      if (h.botActAt) at = Math.min(at, h.botActAt);
    }
    await this.ctx.storage.setAlarm(at);
  }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }

  broadcast() {
    for (const [ws, pid] of this.sessions)
      this.send(ws, { t: 'state', protocolVersion: PROTOCOL_VERSION, state: publicState(this.state, pid) });
  }

  validateEnvelope(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string')
      throw new GameError('Bad message');
    if (msg.protocolVersion !== PROTOCOL_VERSION) throw new GameError('App updated - reload to continue');
  }

  async handle(ws, msg) {
    this.validateEnvelope(msg);
    const pid = this.sessions.get(ws);
    switch (msg.t) {
      case 'join': {
        if (pid) throw new GameError('Already joined');
        const peer = this.peers.get(ws);
        const newSeat = !msg.token || !this.state.players.some((p) => p.token === msg.token);
        if (newSeat && peer) {
          const bucket = this.rate.get(`join:${peer}`) || { start: Date.now(), count: 0 };
          if (Date.now() - bucket.start > 60_000) { bucket.start = Date.now(); bucket.count = 0; }
          if (++bucket.count > 12) throw new GameError('Too many join attempts - try again shortly');
          this.rate.set(`join:${peer}`, bucket);
        }
        const { player, token, rejoined } = join(this.state, { name: msg.name, token: msg.token, avatar: msg.avatar });
        // One active transport owns a human seat. Close stale transports before binding.
        for (const [other, otherPid] of this.sessions) {
          if (other !== ws && otherPid === player.id) {
            this.sessions.delete(other);
            try { other.close(4001, 'Session replaced'); } catch {}
          }
        }
        this.sessions.set(ws, player.id);
        ws.serializeAttachment({ pid: player.id });
        this.reconcileConnections();
        this.send(ws, { t: 'welcome', protocolVersion: PROTOCOL_VERSION, playerId: player.id, token, rejoined: !!rejoined });
        return;
      }
      default:
        if (!pid) throw new GameError('Join required');
    }
    switch (msg.t) {
      case 'add_bot': addBot(this.state, pid); return;
      case 'start': startHand(this.state, pid); return;
      case 'config': {
        if (pid !== this.state.hostId) throw new GameError('Only the host can change settings');
        if (this.state.status !== 'lobby') throw new GameError('Settings locked once play starts');
        const sb = Math.max(1, Math.min(500, Math.round(Number(msg.sb)) || this.state.config.sb));
        const bb = Math.max(sb, Math.min(1000, Math.round(Number(msg.bb)) || this.state.config.bb));
        const stack = Math.max(bb * 10, Math.min(1000000, Math.round(Number(msg.stack)) || this.state.config.stack));
        this.state.config = { sb, bb, stack };
        for (const p of this.state.players) if (p.stack > 0) p.stack = stack;
        return;
      }
      case 'action': {
        const h = this.state.hand;
        if (!h || msg.handNum !== h.num || msg.expectedSeq !== h.actionSeq)
          throw new GameError('Action expired - table has moved on');
        if (!ACTION_ID.test(String(msg.actionId || ''))) throw new GameError('Invalid action id');
        h.recentActionIds ||= [];
        if (h.recentActionIds.includes(msg.actionId)) throw new GameError('Duplicate action');
        h.recentActionIds.push(msg.actionId);
        if (h.recentActionIds.length > 128) h.recentActionIds.shift();
        act(this.state, pid, { kind: msg.kind, amount: msg.amount });
        return;
      }
      case 'rebuy': rebuy(this.state, pid); return;
      case 'avatar': setAvatar(this.state, pid, msg.avatar); return;
      case 'kick': kick(this.state, pid, msg.playerId); return;
      case 'restart': {
        if (pid !== this.state.hostId) throw new GameError('Only the host can restart');
        for (const p of this.state.players) { p.stack = this.state.config.stack; p.sittingOut = false; }
        this.state.status = 'lobby'; this.state.hand = null;
        this.state.log.push({ n: ++this.state.logSeq, msg: 'New game - stacks reset' });
        return;
      }
      case 'leave': kick(this.state, pid, pid); this.sessions.delete(ws); return;
      default: throw new GameError('Unknown message');
    }
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES)
      return this.send(ws, { t: 'error', msg: 'Bad message' });
    let msg; try { msg = JSON.parse(raw); } catch { return this.send(ws, { t: 'error', msg: 'Bad message' }); }
    try { await this.handle(ws, msg); }
    catch (e) { this.send(ws, { t: 'error', msg: e instanceof GameError ? e.message : 'Server error' }); return; }
    await this.save(); this.broadcast();
  }

  async webSocketClose(ws) {
    const pid = this.sessions.get(ws); this.sessions.delete(ws); this.peers.delete(ws);
    if (this.state && pid && ![...this.sessions.values()].includes(pid)) {
      markConnected(this.state, pid, false); await this.save(); this.broadcast();
    }
  }
  async webSocketError(ws) { return this.webSocketClose(ws); }

  async alarm() {
    if (!this.state) return;
    if (Date.now() - (this.state.lastActivityAt || this.state.createdAt || 0) >= ROOM_TTL_MS && this.sessions.size === 0) {
      await this.ctx.storage.deleteAll(); this.state = null; return;
    }
    let guard = 0;
    while (this.state.status === 'playing' && guard++ < 40) {
      const h = this.state.hand; if (!h?.acting) break;
      const p = this.state.players.find((x) => x.id === h.acting);
      if (!p?.isBot || !h.botActAt || Date.now() < h.botActAt) break;
      try { act(this.state, p.id, decideBotAction(this.state, p.id, availableActions(this.state, p.id))); }
      catch { try { act(this.state, p.id, { kind: h.currentBet - (h.streetBets[p.id] || 0) > 0 ? 'call' : 'check' }); } catch { break; } }
    }
    let g2 = 0; while (timeoutAct(this.state) && g2++ < 20) {}
    await this.save(); this.broadcast();
  }
}
