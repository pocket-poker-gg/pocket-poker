import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, join, startHand, act, availableActions, timeoutAct, publicState, potTotal, rebuy, GameError } from '../src/engine.js';

function mkGame(n, stacks = null) {
  const g = createGame('TEST', { sb: 5, bb: 10, stack: 1000 });
  const ids = [];
  for (let i = 0; i < n; i++) {
    const { player } = join(g, { name: 'P' + i });
    ids.push(player.id);
    if (stacks) player.stack = stacks[i];
  }
  return { g, ids };
}
function auto(state) {
  // returns acting player id
  return state.hand?.acting;
}
function totalChips(state) {
  const inStacks = state.players.reduce((a, p) => a + p.stack, 0);
  return inStacks; // during a hand, bets come out of stacks into contrib; conservation checked via stacks+contrib
}
function totalWithPot(state) {
  const h = state.hand;
  const pot = h ? potTotal(h) : 0;
  return state.players.reduce((a, p) => a + p.stack, 0) + pot;
}
// play a full hand with a decision fn (state, id, av) => action
function playHand(state, decide, maxSteps = 500) {
  let steps = 0;
  while (state.status === 'playing') {
    if (++steps > maxSteps) throw new Error('hand did not terminate');
    const id = state.hand.acting;
    assert.ok(id, 'must have acting player while playing');
    const av = availableActions(state, id);
    assert.ok(av.yourTurn);
    const a = decide(state, id, av);
    act(state, id, a);
  }
}

test('lobby: join, seats, host', () => {
  const { g, ids } = mkGame(3);
  assert.equal(g.players.length, 3);
  assert.equal(g.hostId, ids[0]);
  assert.deepEqual(g.players.map((p) => p.seat), [0, 1, 2]);
});

test('blinds posted, fold-around win, chip conservation', () => {
  const { g, ids } = mkGame(3);
  startHand(g, ids[0]);
  const h = g.hand;
  const contribs = Object.values(h.contrib).sort((a, b) => a - b);
  assert.deepEqual(contribs, [0, 5, 10]);
  assert.equal(totalWithPot(g), 3000);
  // everyone folds to BB
  playHand(g, (state, id) => ({ kind: 'fold' }));
  assert.equal(g.status, 'between');
  assert.equal(totalChips(g), 3000);
  // BB posted 10, SB 5, dealer 0; uncalled 5 refunded to BB, BB wins 10 -> BB stack 1005
  const order = [...g.players].sort((a, b) => a.seat - b.seat);
  const dIdx = order.findIndex((p) => p.id === g.hand.dealerId);
  const bb = order[(dIdx + 2) % 3];
  assert.equal(bb.stack, 1005);
  const w = g.hand.result.winners[0];
  assert.equal(w.id, bb.id);
  assert.equal(w.amount, 10);
});

test('limped pot reaches flop with 3 community cards', () => {
  const { g, ids } = mkGame(4);
  startHand(g, ids[0]);
  playHand(g, (state, id, av) => {
    if (state.hand.street !== 'preflop') return av.canCheck ? { kind: 'check' } : { kind: 'fold' };
    return av.canCheck ? { kind: 'check' } : { kind: 'call' };
  });
  // hand may finish if everyone folds; but with limp/check it should reach showdown
  assert.equal(g.status, 'between');
  assert.equal(g.hand.community.length, 5);
  assert.equal(totalChips(g), 4000);
});

test('min raise enforcement', () => {
  const { g, ids } = mkGame(3);
  startHand(g, ids[0]);
  const first = g.hand.acting;
  act(g, first, { kind: 'raise', amount: 25 }); // raise size 15 over bb 10
  assert.equal(g.hand.minRaise, 15);
  const next = g.hand.acting;
  assert.throws(() => act(g, next, { kind: 'raise', amount: 39 }), GameError);
  act(g, next, { kind: 'raise', amount: 40 });
  assert.equal(g.hand.currentBet, 40);
});

test('wrong turn rejected', () => {
  const { g, ids } = mkGame(3);
  startHand(g, ids[0]);
  const notActing = ids.find((id) => id !== g.hand.acting && g.hand.cards[id]);
  assert.throws(() => act(g, notActing, { kind: 'call' }), GameError);
});

test('side pots with staggered all-ins', () => {
  const { g, ids } = mkGame(3, [50, 200, 1000]);
  startHand(g, ids[0]);
  playHand(g, (state, id, av) => {
    if (av.owe === 0 && !av.canBet) return { kind: 'check' };
    return { kind: 'allin' };
  });
  assert.equal(totalChips(g), 1250);
  // at least one showdown happened
  assert.equal(g.hand.result.type, 'showdown');
  const potsTotal = g.hand.result.pots.reduce((a, p) => a + p.amount, 0);
  assert.equal(potsTotal, 1250);
});

test('uncontested overbet refund', () => {
  const { g, ids } = mkGame(2, [100, 1000]);
  startHand(g, ids[0]);
  playHand(g, (state, id, av) => {
    const p = state.players.find((x) => x.id === id);
    if (p.stack <= 100) return av.owe > 0 ? { kind: 'call' } : { kind: 'allin' };
    if (av.owe > 0) return { kind: 'fold' };
    return { kind: 'bet', amount: 1000 };
  });
  assert.equal(totalChips(g), 1100);
});

test('rebuy between hands', () => {
  const { g, ids } = mkGame(2);
  g.players[1].stack = 30;
  rebuy(g, ids[1]);
  assert.equal(g.players[1].stack, 1000);
});

test('property: 300 random hands conserve chips and terminate', () => {
  let hands = 0;
  for (let iter = 0; iter < 60; iter++) {
    const { g, ids } = mkGame(4);
    for (let hh = 0; hh < 5 && g.players.filter((p) => p.stack > 0).length >= 2; hh++) {
      try {
        startHand(g, g.hostId);
      } catch {
        break;
      }
      hands++;
      playHand(g, (state, id, av) => {
        const r = Math.random();
        if (av.owe > 0) {
          if (r < 0.25) return { kind: 'fold' };
          if (r < 0.75 || !av.canRaise) return { kind: 'call' };
          const to = Math.floor(av.minRaiseTo + Math.random() * (av.maxRaiseTo - av.minRaiseTo + 1));
          return { kind: 'raise', amount: to };
        }
        if (r < 0.6 || !av.canBet) return { kind: 'check' };
        const to = Math.floor(av.minBet + Math.random() * (av.maxBet - av.minBet + 1));
        return { kind: 'bet', amount: to };
      });
      assert.equal(totalChips(g), 4000, 'chips conserved');
      for (const p of g.players) assert.ok(p.stack >= 0, 'no negative stack');
    }
  }
  assert.ok(hands > 200, `ran ${hands} hands`);
});

test('timeout auto check/fold', () => {
  const { g, ids } = mkGame(3);
  startHand(g, ids[0]);
  g.hand.turnDeadline = 0;
  const acting = g.hand.acting;
  const ok = timeoutAct(g);
  assert.ok(ok);
  assert.notEqual(g.hand.acting, acting);
});

test('publicState hides hole cards, reveals at showdown', () => {
  const { g, ids } = mkGame(3);
  startHand(g, ids[0]);
  const view = publicState(g, ids[0]);
  const me = view.players.find((p) => p.id === ids[0]);
  const other = view.players.find((p) => p.id === ids[1]);
  assert.ok(Array.isArray(me.cards));
  assert.equal(other.cards, null);
  playHand(g, (state, id, av) => (av.owe > 0 ? { kind: 'call' } : { kind: 'check' }));
  if (g.hand.result.type === 'showdown') {
    const view2 = publicState(g, ids[0]);
    const other2 = view2.players.find((p) => p.id === ids[1]);
    if (g.hand.cards[ids[1]]) assert.ok(Array.isArray(other2.cards));
  }
});
