import {
  createGame, join, addBot, act, startHand, kick, rebuy, availableActions,
  markConnected, timeoutAct, publicState, GameError,
} from './engine.js';
import { decideBotAction } from './bots.js';

export class PokerRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = null;
    this.sessions = new Map(); // ws -> playerId
    this.ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get('state')) || null;
      for (const ws of ctx.getWebSockets()) {
        const att = ws.deserializeAttachment();
        if (att && att.pid) this.sessions.set(ws, att.pid);
        if (this.state && att && att.pid) {
          const p = this.state.players.find((x) => x.id === att.pid);
          if (p) p.connected = true;
        }
      }
    });
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async save() {
    await this.ctx.storage.put('state', this.state);
    const h = this.state?.hand;
    if (this.state?.status === 'playing' && h?.turnDeadline) {
      let at = h.turnDeadline + 400;
      if (h.botActAt) at = Math.min(at, h.botActAt);
      await this.ctx.storage.setAlarm(at);
    }
  }

  send(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {}
  }

  broadcast() {
    for (const [ws, pid] of this.sessions) {
      this.send(ws, { t: 'state', state: publicState(this.state, pid) });
    }
  }

  async handle(ws, msg) {
    const pid = this.sessions.get(ws);
    const code = this.ctx.id.name;
    switch (msg.t) {
      case 'join': {
        if (!this.state) this.state = createGame(code);
        const { player, token, rejoined } = join(this.state, {
          name: msg.name,
          token: msg.token,
        });
        this.sessions.set(ws, player.id);
        ws.serializeAttachment({ pid: player.id });
        this.send(ws, { t: 'welcome', playerId: player.id, token, rejoined: !!rejoined });
        return;
      }
      case 'add_bot': {
        if (!this.state) throw new GameError('No table yet');
        addBot(this.state, pid);
        return;
      }
      case 'start':
        startHand(this.state, pid);
        return;
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
      case 'action':
        act(this.state, pid, { kind: msg.kind, amount: msg.amount });
        return;
      case 'rebuy':
        rebuy(this.state, pid);
        return;
      case 'kick':
        kick(this.state, pid, msg.playerId);
        return;
      case 'restart': {
        if (pid !== this.state.hostId) throw new GameError('Only the host can restart');
        for (const p of this.state.players) {
          p.stack = this.state.config.stack;
          p.sittingOut = false;
        }
        this.state.status = 'lobby';
        this.state.hand = null;
        this.state.log.push({ n: ++this.state.logSeq, msg: 'New game - stacks reset' });
        return;
      }
      case 'leave': {
        // voluntary leave between hands
        kick(this.state, pid === this.state.hostId ? pid : pid, pid);
        const p = this.state.players.find((x) => x.id === pid);
        if (!p) this.sessions.delete(ws);
        return;
      }
      default:
        throw new GameError('Unknown message');
    }
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.send(ws, { t: 'error', msg: 'Bad message' });
    }
    try {
      await this.handle(ws, msg);
    } catch (e) {
      this.send(ws, { t: 'error', msg: e instanceof GameError ? e.message : 'Server error' });
      return;
    }
    await this.save();
    this.broadcast();
  }

  async webSocketClose(ws) {
    const pid = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (this.state && pid) {
      markConnected(this.state, pid, false);
      await this.save();
      this.broadcast();
    }
  }

  async webSocketError(ws) {
    this.sessions.delete(ws);
  }

  async alarm() {
    if (!this.state) return;
    // bots whose think time has elapsed act now; each action may queue the next
    // bot whose botActAt is already past (e.g. after hibernation)
    let guard = 0;
    while (this.state.status === 'playing' && guard++ < 40) {
      const h = this.state.hand;
      if (!h || !h.acting) break;
      const p = this.state.players.find((x) => x.id === h.acting);
      if (!p || !p.isBot) break;
      if (!h.botActAt || Date.now() < h.botActAt) break;
      try {
        const av = availableActions(this.state, p.id);
        act(this.state, p.id, decideBotAction(this.state, p.id, av));
      } catch {
        try {
          const owe = h.currentBet - (h.streetBets[p.id] || 0);
          act(this.state, p.id, { kind: owe > 0 ? 'call' : 'check' });
        } catch {
          break;
        }
      }
    }
    let g2 = 0;
    while (timeoutAct(this.state) && g2++ < 20) {}
    await this.save();
    this.broadcast();
  }
}
