// Pocket Poker engine - pure, no I/O. Server-authoritative state machine for NLHE.
import pokersolver from 'pokersolver';
import { BOT_PROFILES } from './bots.js';
const { Hand } = pokersolver;

const SUITS = ['c', 'd', 'h', 's'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const TURN_MS = 60000;

function randInt(n) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
}
function genToken() {
  // 256-bit reconnect/seat capability. The human room code is never seat authority.
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function makeRoomCode() {
  const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alpha[randInt(alpha.length)];
  return s;
}
function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export class GameError extends Error {}

export function createGame(code, config = {}) {
  return {
    version: 1,
    code,
    status: 'lobby', // lobby | playing | between
    config: { sb: config.sb ?? 5, bb: config.bb ?? 10, stack: config.stack ?? 1000 },
    players: [], // {id,name,seat,token,stack,connected,sittingOut}
    seq: 0,
    dealerSeat: -1,
    handNum: 0,
    hand: null,
    log: [], // {n, msg}
    logSeq: 0,
    hostId: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
}

function log(state, msg) {
  state.log.push({ n: ++state.logSeq, msg });
  if (state.log.length > 30) state.log.splice(0, state.log.length - 30);
}

export function join(state, { name, token }) {
  name = String(name || '').trim().slice(0, 16) || 'Player';
  if (token) {
    const ex = state.players.find((p) => p.token === token);
    if (ex) {
      ex.connected = true;
      if (name && name !== 'Player') ex.name = name;
      return { player: ex, token: ex.token, rejoined: true };
    }
  }
  if (state.players.length >= 9) throw new GameError('Table is full (9 max)');
  const used = new Set(state.players.map((p) => p.seat));
  let seat = 0;
  while (used.has(seat)) seat++;
  const p = {
    id: 'p' + ++state.seq,
    name,
    seat,
    token: genToken(),
    stack: state.config.stack,
    connected: true,
    sittingOut: false,
  };
  state.players.push(p);
  if (!state.hostId) state.hostId = p.id;
  log(state, `${p.name} joined`);
  return { player: p, token: p.token };
}

export function addBot(state, byId) {
  if (byId !== state.hostId) throw new GameError('Only the host can add bots');
  if (state.players.length >= 9) throw new GameError('Table is full (9 max)');
  const usedNames = new Set(state.players.map((p) => p.name));
  let prof = BOT_PROFILES.find((pr) => !usedNames.has(pr.name));
  if (!prof) prof = BOT_PROFILES[randInt(BOT_PROFILES.length)];
  let name = prof.name;
  for (let i = 2; usedNames.has(name); i++) name = `${prof.name} ${i}`;
  const usedSeats = new Set(state.players.map((p) => p.seat));
  let seat = 0;
  while (usedSeats.has(seat)) seat++;
  const p = {
    id: 'p' + ++state.seq,
    name,
    seat,
    token: null,
    stack: state.config.stack,
    connected: true,
    sittingOut: false,
    isBot: true,
    bot: { tight: prof.tight, aggro: prof.aggro, bluff: prof.bluff, pace: prof.pace },
  };
  state.players.push(p);
  log(state, `${p.name} (bot) joined`);
  return { player: p };
}

export function markConnected(state, id, connected) {
  const p = state.players.find((x) => x.id === id);
  if (p) {
    p.connected = connected;
    if (!connected) log(state, `${p.name} disconnected`);
    else log(state, `${p.name} reconnected`);
  }
}

export function kick(state, byId, targetId) {
  if (byId !== state.hostId && byId !== targetId)
    throw new GameError('Only the host can remove players');
  const t = state.players.find((p) => p.id === targetId);
  if (!t) return;
  if (state.hand && !state.hand.folded[targetId] && inHand(state, targetId))
    throw new GameError('Cannot remove a player mid-hand');
  state.players = state.players.filter((p) => p.id !== targetId);
  if (state.hostId === targetId)
    state.hostId = state.players.find((p) => !p.isBot)?.id || null;
  log(state, `${t.name} was removed`);
}

export function rebuy(state, id) {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new GameError('Not at table');
  if (state.status === 'playing') throw new GameError('Rebuy between hands only');
  if (p.stack >= state.config.stack) throw new GameError('Stack already full');
  p.stack = state.config.stack;
  p.sittingOut = false;
  log(state, `${p.name} rebought to ${p.stack}`);
}

function inHand(state, id) {
  return !!(state.hand && state.hand.cards[id]);
}
function seatOrder(state) {
  return [...state.players].sort((a, b) => a.seat - b.seat);
}
// players eligible to be dealt in: connected or not (connected state doesn't matter), stack>0, not sittingOut
function activePlayers(state) {
  return seatOrder(state).filter((p) => p.stack > 0 && !p.sittingOut);
}
function nextIdx(arr, fromSeat) {
  for (let i = 0; i < arr.length; i++) if (arr[i].seat > fromSeat) return i;
  return 0;
}

export function startHand(state, byId) {
  if (byId !== state.hostId) throw new GameError('Only the host can start');
  if (state.status === 'playing') throw new GameError('Hand already in progress');
  for (const p of state.players) {
    if (p.isBot && p.stack === 0) {
      p.stack = state.config.stack;
      p.sittingOut = false;
      log(state, `${p.name} (bot) rebought to ${p.stack}`);
    }
  }
  const act = activePlayers(state);
  if (act.length < 2) throw new GameError('Need at least 2 players with chips');

  state.handNum++;
  const deck = Array.isArray(state._testDeck) ? [...state._testDeck] : makeDeck();
  delete state._testDeck;
  if (deck.length !== 52 || new Set(deck).size !== 52) throw new GameError('Invalid deck');
  const hand = {
    num: state.handNum,
    street: 'preflop',
    community: [],
    deck,
    cards: {}, // id -> [c1,c2]
    contrib: {}, // id -> total this hand
    streetBets: {}, // id -> this street
    currentBet: 0,
    minRaise: state.config.bb,
    acting: null,
    lastAggressor: null,
    toAct: [],
    noReopen: {}, // id -> true (may not raise this street; short all-in)
    folded: {},
    allin: {},
    turnDeadline: 0,
    result: null,
    revealed: false,
    actionSeq: 0,
    recentActionIds: [],
  };
  state.hand = hand;
  state.status = 'playing';

  // dealer: next active seat after previous dealer
  const dIdx = state.dealerSeat < 0 ? randInt(act.length) : nextIdx(act, state.dealerSeat);
  const dealer = act[dIdx];
  state.dealerSeat = dealer.seat;
  hand.dealerId = dealer.id;

  for (const p of act) {
    hand.cards[p.id] = [deck.pop(), deck.pop()];
    hand.contrib[p.id] = 0;
    hand.streetBets[p.id] = 0;
  }

  const post = (p, amt) => {
    const a = Math.min(amt, p.stack);
    p.stack -= a;
    hand.contrib[p.id] += a;
    hand.streetBets[p.id] += a;
    if (p.stack === 0) hand.allin[p.id] = true;
  };

  let sbIdx, bbIdx;
  if (act.length === 2) {
    sbIdx = dIdx;
    bbIdx = (dIdx + 1) % act.length;
  } else {
    sbIdx = (dIdx + 1) % act.length;
    bbIdx = (dIdx + 2) % act.length;
  }
  post(act[sbIdx], state.config.sb);
  post(act[bbIdx], state.config.bb);
  hand.currentBet = Math.max(...Object.values(hand.streetBets));
  hand.minRaise = state.config.bb;
  hand.lastAggressor = act[bbIdx].id;

  hand.toAct = orderedFrom(act, (bbIdx + 1) % act.length).filter((p) => !hand.allin[p.id]).map((p) => p.id);
  beginTurn(state);
  log(state, `Hand #${hand.num} - ${dealer.name} on the button`);
  return state;
}

function orderedFrom(arr, startIdx) {
  const out = [];
  for (let i = 0; i < arr.length; i++) out.push(arr[(startIdx + i) % arr.length]);
  return out;
}

function beginTurn(state) {
  const h = state.hand;
  h.acting = h.toAct[0] || null;
  h.turnDeadline = h.acting ? Date.now() + TURN_MS : 0;
  h.botActAt = 0;
  if (h.acting) {
    const p = state.players.find((x) => x.id === h.acting);
    if (p && p.isBot) h.botActAt = Date.now() + botThinkMs(state, p);
  }
}

function botThinkMs(state, p) {
  const h = state.hand;
  const owe = h ? Math.max(0, h.currentBet - (h.streetBets[p.id] || 0)) : 0;
  let ms = 900 + randInt(1800);
  if (owe > 0) ms += Math.min(2000, Math.round((owe / Math.max(1, p.stack + owe)) * 3000));
  const pace = p.bot && typeof p.bot.pace === 'number' ? p.bot.pace : 1;
  return Math.min(6500, Math.round(ms * pace));
}

export function potTotal(hand) {
  return Object.values(hand.contrib).reduce((a, b) => a + b, 0);
}

export function availableActions(state, id) {
  const h = state.hand;
  const p = state.players.find((x) => x.id === id);
  if (!h || !p || h.acting !== id || state.status !== 'playing') return { yourTurn: false };
  const owe = h.currentBet - (h.streetBets[id] || 0);
  const out = { yourTurn: true, owe, stack: p.stack, minRaise: h.minRaise };
  if (owe === 0) {
    out.canCheck = true;
    if (p.stack > 0 && !h.noReopen[id]) {
      if (h.currentBet === 0) {
        out.canBet = true;
        out.minBet = Math.min(state.config.bb, p.stack);
        out.maxBet = p.stack;
      } else {
        // big-blind option: this is a raise spot, not an opening bet
        out.canRaise = true;
        out.minRaiseTo = Math.min(h.currentBet + h.minRaise, (h.streetBets[id] || 0) + p.stack);
        out.maxRaiseTo = (h.streetBets[id] || 0) + p.stack;
      }
    }
  } else {
    out.canFold = true;
    out.canCall = true;
    out.callAmt = Math.min(owe, p.stack);
    const raiseToMin = h.currentBet + h.minRaise;
    if (p.stack > owe && !h.noReopen[id]) {
      out.canRaise = true;
      out.minRaiseTo = Math.min(raiseToMin, (h.streetBets[id] || 0) + p.stack);
      out.maxRaiseTo = (h.streetBets[id] || 0) + p.stack;
    }
  }
  return out;
}

function commit(state, p, amt) {
  const h = state.hand;
  const a = Math.min(amt, p.stack);
  p.stack -= a;
  h.contrib[p.id] += a;
  h.streetBets[p.id] += a;
  if (p.stack === 0) h.allin[p.id] = true;
  return a;
}

export function act(state, id, a) {
  const h = state.hand;
  if (state.status !== 'playing' || !h) throw new GameError('No hand in progress');
  if (h.acting !== id) throw new GameError('Not your turn');
  const p = state.players.find((x) => x.id === id);
  const owe = h.currentBet - (h.streetBets[id] || 0);
  const kind = a.kind;

  const done = () => {
    h.toAct = h.toAct.filter((x) => x !== id);
    afterAction(state);
  };

  switch (kind) {
    case 'fold':
      if (owe === 0) throw new GameError('You can check');
      h.folded[id] = true;
      delete h.cards[id];
      log(state, `${p.name} folded`);
      done();
      break;
    case 'check':
      if (owe > 0) throw new GameError(`Call is ${owe}`);
      log(state, `${p.name} checked`);
      done();
      break;
    case 'call': {
      if (owe === 0) throw new GameError('You can check');
      const got = commit(state, p, owe);
      log(state, `${p.name} called ${got}${h.allin[id] ? ' (all in)' : ''}`);
      done();
      break;
    }
    case 'bet':
    case 'raise': {
      const to = Math.round(Number(a.amount));
      if (!Number.isFinite(to)) throw new GameError('Bad amount');
      const streetBet = h.streetBets[id] || 0;
      const delta = to - streetBet;
      if (delta <= 0 || delta > p.stack) throw new GameError('Bad amount');
      if (h.noReopen[id] && to > h.currentBet) throw new GameError('Betting is capped after a short all-in');
      const isAllIn = delta === p.stack;
      if (h.currentBet === 0) {
        if (to < state.config.bb && !isAllIn) throw new GameError(`Min bet is ${state.config.bb}`);
        commit(state, p, delta);
        h.currentBet = to;
        h.minRaise = Math.max(to, state.config.bb);
        h.lastAggressor = id;
        reopenToAct(state, id);
        log(state, `${p.name} bet ${to}${isAllIn ? ' (all in)' : ''}`);
      } else {
        const raiseSize = to - h.currentBet;
        if (raiseSize <= 0) throw new GameError('Raise must exceed current bet');
        if (raiseSize < h.minRaise && !isAllIn)
          throw new GameError(`Min raise is to ${h.currentBet + h.minRaise}`);
        commit(state, p, delta);
        const fullRaise = raiseSize >= h.minRaise;
        const wasBet = h.currentBet;
        h.currentBet = to;
        if (fullRaise) {
          h.minRaise = raiseSize;
          h.lastAggressor = id;
          reopenToAct(state, id);
        } else {
          // short all-in: players still to act just owe more; players who already
          // acted must act again but may not re-raise
          for (const q of livePlayers(state)) {
            if (q.id === id) continue;
            if (h.allin[q.id]) continue;
            if (!h.toAct.includes(q.id)) {
              h.toAct.push(q.id);
              if ((h.streetBets[q.id] || 0) === wasBet) h.noReopen[q.id] = true;
            }
          }
        }
        log(state, `${p.name} raised to ${to}${isAllIn ? ' (all in)' : ''}`);
      }
      done();
      break;
    }
    case 'allin': {
      const to = (h.streetBets[id] || 0) + p.stack;
      if (p.stack === 0) throw new GameError('No chips');
      if (to > h.currentBet) {
        const raiseSize = to - h.currentBet;
        const wasBet = h.currentBet;
        const fullRaise = raiseSize >= h.minRaise;
        commit(state, p, p.stack);
        h.currentBet = to;
        if (h.currentBet === raiseSize) h.minRaise = Math.max(h.minRaise, raiseSize);
        if (fullRaise) {
          h.minRaise = raiseSize;
          h.lastAggressor = id;
          reopenToAct(state, id);
        } else {
          for (const q of livePlayers(state)) {
            if (q.id === id || h.allin[q.id]) continue;
            if (!h.toAct.includes(q.id)) {
              h.toAct.push(q.id);
              if ((h.streetBets[q.id] || 0) === wasBet) h.noReopen[q.id] = true;
            }
          }
        }
        log(state, `${p.name} went all in for ${to}`);
      } else {
        commit(state, p, p.stack);
        log(state, `${p.name} called all in for ${to}`);
      }
      done();
      break;
    }
    default:
      throw new GameError('Unknown action');
  }
  h.actionSeq++;
  state.lastActivityAt = Date.now();
  return state;
}

function reopenToAct(state, raiserId) {
  const h = state.hand;
  const act = livePlayers(state);
  const idx = act.findIndex((p) => p.id === raiserId);
  const ordered = orderedFrom(act, (idx + 1) % act.length);
  h.toAct = ordered.filter((p) => !h.allin[p.id]).map((p) => p.id);
  h.noReopen = {};
}

function livePlayers(state) {
  const h = state.hand;
  return seatOrder(state).filter((p) => h.cards[p.id] && !h.folded[p.id]);
}

function afterAction(state) {
  const h = state.hand;
  const live = livePlayers(state);
  if (live.length === 1) {
    awardUncontested(state, live[0]);
    return;
  }
  if (h.toAct.length === 0) advanceStreet(state);
  else beginTurn(state);
}

function advanceStreet(state) {
  const h = state.hand;
  // everyone matched; reset street bookkeeping
  for (const k of Object.keys(h.streetBets)) h.streetBets[k] = 0;
  h.currentBet = 0;
  h.minRaise = state.config.bb;
  h.noReopen = {};
  h.lastAggressor = null;

  const live = livePlayers(state);
  const canAct = live.filter((p) => !h.allin[p.id]);
  if (h.street === 'preflop') {
    h.deck.pop();
    h.community.push(h.deck.pop(), h.deck.pop(), h.deck.pop());
    h.street = 'flop';
  } else if (h.street === 'flop') {
    h.deck.pop();
    h.community.push(h.deck.pop());
    h.street = 'turn';
  } else if (h.street === 'turn') {
    h.deck.pop();
    h.community.push(h.deck.pop());
    h.street = 'river';
  } else if (h.street === 'river') {
    showdown(state);
    return;
  }
  log(state, `${h.street[0].toUpperCase() + h.street.slice(1)}: ${h.community.join(' ')}`);
  if (canAct.length <= 1 && h.street !== 'river') {
    // all-in runout: keep dealing
    h.toAct = [];
    advanceStreet(state);
    return;
  }
  const dIdx = live.findIndex((p) => p.id === h.dealerId);
  const ordered = orderedFrom(live, (dIdx + 1) % live.length);
  h.toAct = ordered.filter((p) => !h.allin[p.id]).map((p) => p.id);
  if (h.toAct.length === 0) advanceStreet(state);
  else beginTurn(state);
}

function awardUncontested(state, winner) {
  const h = state.hand;
  const total = potTotal(h);
  // refund uncalled overbet portion: highest contributor gets back what nobody matched
  const contribs = Object.entries(h.contrib).sort((a, b) => b[1] - a[1]);
  let paid = total;
  if (contribs.length >= 2) {
    const uncalled = contribs[0][1] - contribs[1][1];
    if (uncalled > 0) {
      const wp = state.players.find((p) => p.id === contribs[0][0]);
      if (wp) {
        wp.stack += uncalled;
        paid -= uncalled;
      }
    }
  }
  winner.stack += paid;
  h.result = { type: 'uncontested', winners: [{ id: winner.id, name: winner.name, amount: paid }] };
  h.acting = null;
  h.turnDeadline = 0;
  state.status = 'between';
  log(state, `${winner.name} won ${paid}`);
}

function buildPots(h) {
  const entries = Object.entries(h.contrib)
    .filter(([, v]) => v > 0)
    .map(([id, amt]) => ({ id, amt }));
  const pots = [];
  while (entries.some((e) => e.amt > 0)) {
    const min = Math.min(...entries.filter((e) => e.amt > 0).map((e) => e.amt));
    let total = 0;
    const eligible = [];
    for (const e of entries) {
      if (e.amt > 0) {
        total += Math.min(e.amt, min);
        e.amt -= min;
        if (!h.folded[e.id] && h.cards[e.id]) eligible.push(e.id);
      }
    }
    if (total > 0) pots.push({ amount: total, eligible });
  }
  return pots;
}

function showdown(state) {
  const h = state.hand;
  h.street = 'showdown';
  h.revealed = true;
  const evals = {};
  for (const id of Object.keys(h.cards)) {
    if (h.folded[id]) continue;
    const ev = Hand.solve(h.cards[id].concat(h.community));
    ev.pid = id;
    evals[id] = ev;
  }
  const pots = buildPots(h);
  const wins = {};
  const potResults = [];
  for (const pot of pots) {
    const cands = pot.eligible.filter((id) => evals[id]).map((id) => evals[id]);
    if (cands.length === 0) continue;
    const winHands = Hand.winners(cands);
    const best = winHands.map((ev) => ({ id: ev.pid, ev }));
    const share = Math.floor(pot.amount / best.length);
    let remainder = pot.amount - share * best.length;
    // odd chips go to earliest seat left of dealer
    const order = seatOrder(state)
      .filter((p) => best.some((b) => b.id === p.id))
      .sort((a, b) => ((a.seat - state.dealerSeat - 1 + 100) % 100) - ((b.seat - state.dealerSeat - 1 + 100) % 100));
    const perPot = {};
    for (const b of best) {
      const p = state.players.find((x) => x.id === b.id);
      let amt = share;
      if (order[0] && order[0].id === b.id && remainder > 0) {
        amt += remainder;
        remainder = 0;
      }
      p.stack += amt;
      wins[b.id] = (wins[b.id] || 0) + amt;
      perPot[b.id] = amt;
    }
    potResults.push({
      amount: pot.amount,
      winners: best.map((b) => ({
        id: b.id,
        name: state.players.find((x) => x.id === b.id).name,
        amount: perPot[b.id],
        hand: b.ev.descr,
        cards: h.cards[b.id],
      })),
    });
  }
  h.result = { type: 'showdown', pots: potResults };
  h.acting = null;
  h.turnDeadline = 0;
  state.status = 'between';
  const summary = Object.entries(wins)
    .map(([id, amt]) => `${state.players.find((p) => p.id === id).name} +${amt}`)
    .join(', ');
  log(state, `Showdown - ${summary}`);
}

export function timeoutAct(state) {
  const h = state.hand;
  if (!h || state.status !== 'playing' || !h.acting) return false;
  if (Date.now() < h.turnDeadline) return false;
  const id = h.acting;
  const p = state.players.find((x) => x.id === id);
  const owe = h.currentBet - (h.streetBets[id] || 0);
  log(state, `${p.name} timed out`);
  act(state, id, { kind: owe === 0 ? 'check' : 'fold' });
  return true;
}

// ---- client view ----
export function publicState(state, forId) {
  const h = state.hand;
  const out = {
    code: state.code,
    status: state.status,
    config: state.config,
    you: forId,
    hostId: state.hostId,
    handNum: state.handNum,
    log: state.log.slice(-12),
    players: seatOrder(state).map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      stack: p.stack,
      connected: p.connected,
      sittingOut: p.sittingOut,
      isHost: p.id === state.hostId,
      isBot: !!p.isBot,
      bet: h ? h.streetBets[p.id] || 0 : 0,
      contrib: h ? h.contrib[p.id] || 0 : 0,
      folded: h ? !!h.folded[p.id] : false,
      allin: h ? !!h.allin[p.id] : false,
      inHand: h ? !!h.cards[p.id] || !!h.folded[p.id] : false,
      isDealer: h ? h.dealerId === p.id : false,
      isActing: h ? h.acting === p.id : false,
      cards: null,
    })),
    hand: null,
    actions: availableActions(state, forId),
  };
  if (h) {
    const revealed = h.revealed || h.street === 'showdown';
    for (const pl of out.players) {
      const mine = h.cards[pl.id];
      if (mine) {
        if (pl.id === forId) pl.cards = mine;
        else if (revealed && !pl.folded) pl.cards = mine;
      }
    }
    out.hand = {
      num: h.num,
      street: h.street,
      community: h.community,
      pot: potTotal(h),
      currentBet: h.currentBet,
      minRaise: h.minRaise,
      acting: h.acting,
      dealerId: h.dealerId,
      turnDeadline: h.turnDeadline,
      result: h.result,
      revealed,
      actionSeq: h.actionSeq,
    };
  }
  return out;
}

export function setTestDeck(state, deck) { state._testDeck = [...deck]; }
