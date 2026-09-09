// Pocket Poker bots - rule-based NLHE AI with per-bot personality profiles.
// Pure decision module: no I/O, no imports from engine (avoids cycles).
// decideBotAction(state, id, av) always returns a legal action from av.
import pokersolver from 'pokersolver';
const { Hand } = pokersolver;

const RV = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };

function rand() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] / 2 ** 32;
}

// Personality profiles: tight (hand selection), aggro (bet/raise tendency),
// bluff (bluff frequency), pace (think-time multiplier).
export const BOT_PROFILES = [
  { name: 'Aria', tight: 0.75, aggro: 0.7, bluff: 0.22, pace: 1.0 }, // tight-aggressive
  { name: 'Gus', tight: 0.35, aggro: 0.85, bluff: 0.38, pace: 0.9 }, // loose-aggressive
  { name: 'Mabel', tight: 0.88, aggro: 0.3, bluff: 0.08, pace: 1.1 }, // rock
  { name: 'Dex', tight: 0.55, aggro: 0.6, bluff: 0.28, pace: 1.0 }, // balanced
  { name: 'Ruby', tight: 0.3, aggro: 0.28, bluff: 0.12, pace: 1.15 }, // loose-passive
  { name: 'Hal', tight: 0.22, aggro: 0.95, bluff: 0.45, pace: 0.8 }, // maniac
];

// Chen formula: solid public-domain preflop hand score (0..20).
export function chenScore(c1, c2) {
  const val = (r) => ({ A: 10, K: 8, Q: 7, J: 6, T: 5, 9: 4.5, 8: 4, 7: 3.5, 6: 3, 5: 2.5, 4: 2, 3: 1.5, 2: 1 }[r]);
  const r1 = c1[0], r2 = c2[0];
  const hi = Math.max(val(r1), val(r2));
  const pair = r1 === r2;
  let score = pair ? Math.max(5, hi * 2) : hi;
  if (c1[1] === c2[1]) score += 2; // suited
  const gap = Math.abs(RV[r1] - RV[r2]) - 1;
  if (!pair) {
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
    if (gap <= 1 && Math.max(RV[r1], RV[r2]) < RV.Q) score += 1; // straight potential
  }
  return Math.ceil(score);
}

function livePlayers(state) {
  const h = state.hand;
  return state.players
    .filter((p) => h.cards[p.id] && !h.folded[p.id])
    .sort((a, b) => a.seat - b.seat);
}

// 0 = button, counting away from dealer through the live players.
function positionIndex(state, id) {
  const live = livePlayers(state);
  const my = live.findIndex((p) => p.id === id);
  const d = live.findIndex((p) => p.id === state.hand.dealerId);
  if (my < 0 || d < 0) return 1;
  return (my - d + live.length) % live.length;
}

// Postflop hand analysis: made-hand strength, draw equity, board texture.
function analyze(hole, board, street, liveCount) {
  const all = hole.concat(board);
  const ev = Hand.solve(all);
  const cat = ev.rank; // 1 high card .. 9 straight flush

  const boardRanks = board.map((c) => RV[c[0]]);
  const maxBoard = Math.max(...boardRanks);
  const boardSuits = {};
  for (const c of board) boardSuits[c[1]] = (boardSuits[c[1]] || 0) + 1;
  const boardFlushMax = Math.max(...Object.values(boardSuits));
  const flushPossible = boardFlushMax >= 3;

  const rankCounts = {};
  for (const c of board) rankCounts[c[0]] = (rankCounts[c[0]] || 0) + 1;
  const pairedBoard = Object.values(rankCounts).some((n) => n >= 2);

  // board straight-ness: 3+ board ranks within a 5-wide window
  const bSet = new Set(boardRanks);
  if (bSet.has(14)) bSet.add(1);
  let straighty = false;
  for (let lo = 1; lo <= 10 && !straighty; lo++) {
    let n = 0;
    for (let k = 0; k < 5; k++) if (bSet.has(lo + k)) n++;
    if (n >= 3) straighty = true;
  }

  let s; // made-hand strength 0..1
  if (cat >= 8) s = 0.99;
  else if (cat === 7) s = 0.95;
  else if (cat === 6) {
    // flush: does hero actually hold two (or one) cards of the flush suit?
    const flushSuit = Object.keys(boardSuits).find((k) => boardSuits[k] >= 3);
    const heroInSuit = hole.filter((c) => c[1] === flushSuit).length;
    s = heroInSuit >= 1 ? 0.9 : 0.32; // board flush without hero help is weak
  } else if (cat === 5) s = 0.88;
  else if (cat === 4) s = 0.82;
  else if (cat === 3) s = 0.73;
  else if (cat === 2) {
    const pocket = hole[0][0] === hole[1][0];
    if (pocket) {
      const pv = RV[hole[0][0]];
      const overs = boardRanks.filter((r) => r > pv).length;
      s = overs === 0 ? 0.68 : overs === 1 ? 0.6 : 0.5;
    } else {
      const matched = hole.filter((c) => rankCounts[c[0]]);
      if (matched.length) {
        const pr = Math.max(...matched.map((c) => RV[c[0]]));
        const kicker = Math.max(...hole.filter((c) => !rankCounts[c[0]]).map((c) => RV[c[0]]), 2);
        if (pr === maxBoard) s = 0.58 + (kicker / 14) * 0.12; // top pair
        else if (pr >= maxBoard - 3) s = 0.46; // middle pair
        else s = 0.37; // bottom pair
      } else {
        s = 0.3; // playing a board pair
      }
    }
  } else {
    s = 0.14 + (Math.max(RV[hole[0][0]], RV[hole[1][0]]) / 14) * 0.1;
  }

  // texture discounts for made hands below the nut tier
  if (flushPossible && cat < 6) s -= 0.06;
  if (pairedBoard && cat < 4) s -= 0.04;
  if (straighty && cat < 5) s -= 0.04;

  // draws
  let outs = 0;
  if (cat < 6) {
    const allSuits = {};
    for (const c of all) allSuits[c[1]] = (allSuits[c[1]] || 0) + 1;
    const heroFlushMax = Math.max(
      ...Object.keys(allSuits).map((k) => {
        const heroHas = hole.some((c) => c[1] === k);
        return heroHas ? allSuits[k] : 0;
      }),
      0
    );
    if (heroFlushMax === 4) outs += 9;
  }
  if (cat < 5) {
    const rset = new Set(all.map((c) => RV[c[0]]));
    if (rset.has(14)) rset.add(1);
    let straightOuts = 0;
    for (let lo = 1; lo <= 10; lo++) {
      let n = 0;
      const missing = [];
      for (let k = 0; k < 5; k++) {
        if (rset.has(lo + k)) n++;
        else missing.push(lo + k);
      }
      if (n === 4 && missing.length === 1) {
        const m = missing[0];
        const edge = m === lo || m === lo + 4;
        straightOuts = Math.max(straightOuts, edge ? 8 : 4);
      }
    }
    outs += straightOuts;
  }
  if (outs === 0 && cat <= 2) {
    outs += hole.filter((c) => RV[c[0]] > maxBoard).length * 3; // overcards
  }
  const strongDraw = outs >= 8;
  if (street === 'flop') s += Math.min(outs * 4, 45) / 100;
  else if (street === 'turn') s += Math.min(outs * 2.2, 40) / 100;

  let equity = Math.max(0, Math.min(0.99, s));
  const opps = liveCount - 1;
  if (opps >= 2 && equity < 0.85) equity *= 1 - 0.07 * (opps - 1); // multiway discount
  if (opps === 1 && equity < 0.8) equity += 0.04; // heads-up widen
  return { cat, equity, outs, strongDraw };
}

function potOf(hand) {
  return Object.values(hand.contrib).reduce((a, b) => a + b, 0);
}

export function decideBotAction(state, id, av) {
  const h = state.hand;
  const me = state.players.find((p) => p.id === id);
  const prof = me.bot || { tight: 0.55, aggro: 0.55, bluff: 0.2, pace: 1 };
  const hole = h.cards[id];
  const bb = state.config.bb;
  const pot = potOf(h);
  const owe = av.owe;
  const liveCount = livePlayers(state).length;

  const fallback = () => (owe > 0 ? { kind: 'call' } : { kind: 'check' });
  if (!hole || !av.yourTurn) return fallback();

  // --- sizing helpers (all clamped to what av allows) ---
  const betTo = (want) => {
    if (!av.canBet) return fallback();
    let to = Math.max(av.minBet, Math.min(av.maxBet, Math.round(want)));
    if (to >= av.maxBet || to >= me.stack * 0.7) return { kind: 'allin' };
    return { kind: 'bet', amount: to };
  };
  const raiseTo = (want) => {
    if (!av.canRaise) return owe > 0 ? { kind: 'call' } : { kind: 'check' };
    let to = Math.max(av.minRaiseTo, Math.min(av.maxRaiseTo, Math.round(want)));
    const committed = to - (h.streetBets[id] || 0);
    if (to >= av.maxRaiseTo || committed >= me.stack * 0.7) return { kind: 'allin' };
    return { kind: 'raise', amount: to };
  };
  const raiseSizing = () => raiseTo(h.currentBet * 2.5 + pot * 0.25);

  if (h.street === 'preflop') {
    const score = chenScore(hole[0], hole[1]);
    const posIdx = positionIndex(state, id);
    const late = posIdx <= 1;
    const mid = posIdx <= Math.ceil(liveCount / 2);
    const facingRaise = h.currentBet > bb;
    let need = 4.5 + prof.tight * 5.5;
    if (late) need -= 1.6;
    else if (mid) need -= 0.7;
    if (liveCount === 2) need -= 1.2;
    if (facingRaise) need += 1.4 + Math.min(2, (h.currentBet / bb - 2) * 0.5);
    const margin = score - need;

    if (owe > 0) {
      // open / continue vs action
      if (!facingRaise && margin >= 0.8 && av.canRaise && rand() < 0.3 + prof.aggro * 0.6)
        return raiseTo(bb * (2.5 + rand()));
      if (margin >= 2.6 && av.canRaise && rand() < 0.5 + prof.aggro * 0.5)
        return raiseTo(h.currentBet * 3);
      const allInCall = av.callAmt >= me.stack;
      if (margin >= 0.8) {
        // a hand good enough to play is good enough to call - except for
        // everything when the price is our whole stack
        if (!allInCall || margin >= 3.5 || rand() < 0.4) return { kind: 'call' };
        return { kind: 'fold' };
      }
      // speculative hands: come along only when the price is cheap
      const potOdds = av.callAmt / (pot + av.callAmt);
      if (margin >= -1.5 && !allInCall && potOdds < 0.34 && av.callAmt <= me.stack * 0.18)
        return { kind: 'call' };
      // squeeze bluff: rare, needs a plausible hand and a willing profile
      if (av.canRaise && late && margin >= -3 && rand() < prof.bluff * 0.25 * (1 - prof.tight))
        return raiseTo(h.currentBet * 3);
      return { kind: 'fold' };
    }
    // big-blind option (or unopened around): raise strong, steal late, else check
    if ((av.canBet || av.canRaise) && margin >= 1.2 && rand() < 0.35 + prof.aggro * 0.6)
      return av.canBet ? betTo(bb * (2.5 + rand())) : raiseTo(bb * (2.5 + rand()));
    if ((av.canBet || av.canRaise) && late && rand() < prof.bluff * 0.5)
      return av.canBet ? betTo(bb * 2.5) : raiseTo(bb * 2.5);
    return { kind: 'check' };
  }

  // --- postflop ---
  const a = analyze(hole, h.community, h.street, liveCount);
  const equity = a.equity;
  const posIdx = positionIndex(state, id);
  const late = posIdx <= 1;

  if (owe > 0) {
    const betFrac = owe / Math.max(1, pot);
    const potOdds = owe / (pot + owe);
    let req = potOdds + 0.04 + (prof.tight - 0.5) * 0.08;
    if (betFrac > 0.75) req += 0.07;
    if (owe >= me.stack) req += 0.08; // calling for the whole stack
    if (equity >= 0.88) {
      // monster: never fold; raise for value per aggression
      if (av.canRaise && rand() < 0.4 + prof.aggro * 0.55) return raiseSizing();
      return { kind: 'call' };
    }
    if (av.canRaise && equity >= 0.8 && rand() < 0.4 + prof.aggro * 0.55) return raiseSizing();
    if (av.canRaise && equity >= 0.66 && rand() < prof.aggro * 0.35) return raiseSizing();
    if (av.canRaise && a.strongDraw && rand() < prof.aggro * 0.5) return raiseSizing();
    if (av.canRaise && rand() < prof.bluff * 0.2 && betFrac < 0.8) return raiseSizing();
    if (equity + (rand() - 0.5) * 0.06 >= req) return { kind: 'call' };
    if (h.street === 'river' && a.cat === 2 && betFrac <= 0.7 && rand() < 0.35 + (0.5 - prof.tight) * 0.3)
      return { kind: 'call' }; // bluff catch
    return { kind: 'fold' };
  }

  if (av.canBet) {
    if (equity >= 0.62 && rand() < 0.45 + prof.aggro * 0.5) {
      if (equity >= 0.92 && rand() < 0.3) return { kind: 'check' }; // trap
      return betTo(pot * (0.55 + rand() * 0.3));
    }
    if (rand() < prof.bluff * (late ? 1.2 : 0.6) * (h.street === 'river' ? 0.8 : 1))
      return betTo(Math.max(bb, pot * (0.4 + rand() * 0.25)));
    if (equity >= 0.5 && rand() < prof.aggro * 0.25) return betTo(Math.max(bb, pot * (0.35 + rand() * 0.2)));
  }
  return { kind: 'check' };
}
