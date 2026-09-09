import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, join, addBot, startHand, act, availableActions, publicState,
  potTotal, kick, GameError,
} from '../src/engine.js';
import { decideBotAction, chenScore, BOT_PROFILES } from '../src/bots.js';

function mkGame(n) {
  const g = createGame('TEST', { sb: 5, bb: 10, stack: 1000 });
  const ids = [];
  for (let i = 0; i < n; i++) {
    const { player } = join(g, { name: 'P' + i });
    ids.push(player.id);
  }
  return { g, ids };
}
function totalStacks(state) {
  return state.players.reduce((a, p) => a + p.stack, 0);
}

test('chen scores sane', () => {
  assert.equal(chenScore('As', 'Ah'), 20);
  assert.ok(chenScore('Ah', 'Kh') >= 12);
  assert.ok(chenScore('7c', '2d') <= 1);
  assert.ok(chenScore('Ah', 'Kh') > chenScore('Ah', 'Kd')); // suited bonus
});

test('addBot: host only, seats, profile variety, isBot in public state', () => {
  const { g, ids } = mkGame(2);
  assert.throws(() => addBot(g, ids[1]), GameError); // non-host
  const b1 = addBot(g, ids[0]).player;
  const b2 = addBot(g, ids[0]).player;
  const b3 = addBot(g, ids[0]).player;
  assert.ok(b1.isBot && b2.isBot);
  assert.deepEqual([b1.name, b2.name, b3.name], ['Aria', 'Gus', 'Mabel']);
  assert.deepEqual([b1.seat, b2.seat, b3.seat], [2, 3, 4]);
  const view = publicState(g, ids[0]);
  assert.equal(view.players.filter((p) => p.isBot).length, 3);
  assert.equal(view.players.find((p) => p.id === ids[0]).isBot, false);
});

test('kick removes bot; host succession skips bots', () => {
  const { g, ids } = mkGame(2);
  const b = addBot(g, ids[0]).player;
  kick(g, ids[0], b.id);
  assert.equal(g.players.length, 2);
  // host leaves: bot must not inherit host
  const b2 = addBot(g, ids[0]).player;
  kick(g, ids[0], ids[0]); // self-leave
  assert.equal(g.hostId, ids[1]);
  kick(g, ids[1], b2.id);
});

test('broke bot auto-rebuys on next hand', () => {
  const { g, ids } = mkGame(1);
  const b = addBot(g, ids[0]).player;
  b.stack = 0;
  startHand(g, ids[0]);
  assert.equal(b.stack > 0, true);
  assert.ok(g.hand.cards[b.id], 'bot dealt in after rebuy');
});

test('bots never fold when checking is free; legal actions only', () => {
  const { g, ids } = mkGame(1);
  for (let i = 0; i < 3; i++) addBot(g, ids[0]);
  const bots = g.players.filter((p) => p.isBot);
  let checks = 0;
  for (let hand = 0; hand < 40; hand++) {
    if (g.players.filter((p) => p.stack > 0).length < 2) break;
    try { startHand(g, g.hostId); } catch { break; }
    let steps = 0;
    while (g.status === 'playing' && steps++ < 600) {
      const id = g.hand.acting;
      const av = availableActions(g, id);
      const me = g.players.find((p) => p.id === id);
      const a = me.isBot ? decideBotAction(g, id, av) : av.owe > 0 ? { kind: 'call' } : { kind: 'check' };
      if (me.isBot) {
        assert.notEqual(av.owe === 0 && a.kind === 'fold', true, 'bot folded when check was free');
        if (a.kind === 'check') checks++;
        // legality spot-checks
        if (a.kind === 'bet') assert.ok(av.canBet && a.amount >= av.minBet && a.amount <= av.maxBet);
        if (a.kind === 'raise') assert.ok(av.canRaise && a.amount >= av.minRaiseTo && a.amount <= av.maxRaiseTo);
        if (a.kind === 'fold') assert.ok(av.canFold);
        if (a.kind === 'call') assert.ok(av.canCall);
      }
      act(g, id, a);
    }
    assert.equal(g.status, 'between', 'hand terminated');
  }
  assert.ok(checks > 0);
});

test('property: 300 all-bot hands - termination, conservation, non-degenerate play', () => {
  const stats = {}; // per profile: decisions, vpipHands, raises, folds, allins, calls
  let hands = 0;
  let showdowns = 0;
  let expectedChips = 0; // zero-stack bots rebuy at hand start, adding chips
  for (let iter = 0; iter < 60 && hands < 300; iter++) {
    const g = createGame('P' + iter, { sb: 5, bb: 10, stack: 1000 });
    const host = join(g, { name: 'Host' }).player;
    for (let i = 0; i < 5; i++) addBot(g, host.id);
    const bots = g.players.filter((p) => p.isBot);
    for (const b of bots) {
      stats[b.name] ||= { decisions: 0, vpip: 0, hands: 0, raises: 0, folds: 0, allins: 0 };
    }
    // host sits out: bots only
    host.sittingOut = true;
    expectedChips = 6000;
    for (let hh = 0; hh < 5; hh++) {
      if (bots.filter((b) => b.stack > 0).length < 2) break;
      expectedChips += 1000 * bots.filter((b) => b.stack === 0).length; // auto-rebuy
      try { startHand(g, host.id); } catch { break; }
      hands++;
      const vpipThisHand = new Set();
      let steps = 0;
      while (g.status === 'playing' && steps++ < 800) {
        const id = g.hand.acting;
        const p = g.players.find((x) => x.id === id);
        const av = availableActions(g, id);
        const a = decideBotAction(g, id, av);
        const st = stats[p.name];
        st.decisions++;
        if (a.kind === 'fold') st.folds++;
        if (a.kind === 'bet' || a.kind === 'raise') st.raises++;
        if (a.kind === 'allin') st.allins++;
        if (g.hand.street === 'preflop' && (a.kind === 'call' || a.kind === 'bet' || a.kind === 'raise' || a.kind === 'allin'))
          vpipThisHand.add(p.name);
        act(g, id, a);
      }
      assert.ok(steps < 800, 'hand terminated');
      assert.equal(totalStacks(g), expectedChips, 'chips conserved');
      if (g.hand.result?.type === 'showdown') showdowns++;
      for (const n of vpipThisHand) stats[n].vpip++;
      for (const b of bots) if (g.hand.cards?.[b.id] || true) stats[b.name].hands++;
    }
  }
  assert.ok(hands >= 250, `ran ${hands} hands`);
  assert.ok(showdowns > hands * 0.2, `enough showdowns (${showdowns}/${hands})`);
  for (const [name, st] of Object.entries(stats)) {
    const vpipRate = st.vpip / st.hands;
    assert.ok(vpipRate > 0.05 && vpipRate < 0.97, `${name} VPIP ${vpipRate.toFixed(2)} sane`);
    assert.ok(st.raises > 0, `${name} raised at least once`);
    assert.ok(st.folds > 0, `${name} folded at least once`);
    assert.ok(st.allins / st.decisions < 0.3, `${name} not all-in happy (${st.allins}/${st.decisions})`);
  }
  // profiles actually differ: loosest VPIP at least 1.4x tightest
  const vpips = Object.entries(stats).map(([n, s]) => [n, s.vpip / s.hands]);
  const rates = vpips.map(([, r]) => r);
  assert.ok(Math.max(...rates) > Math.min(...rates) * 1.4, `profiles differ: ${JSON.stringify(vpips)}`);
});

test('rock folds junk to a raise; TAG raises aces', () => {
  // construct a fixed preflop spot
  const g = createGame('FIX', { sb: 5, bb: 10, stack: 1000 });
  const host = join(g, { name: 'Host' }).player;
  const mabel = addBot(g, host.id).player; // tight 0.88
  mabel.bot.pace = 1;
  const gus = addBot(g, host.id).player;
  host.sittingOut = true;
  startHand(g, host.id);
  const h = g.hand;
  // force Mabel's hole cards to 7-2 offsuit and make her face a 4x raise
  h.cards[mabel.id] = ['7c', '2d'];
  const raiser = h.toAct.find((x) => x !== mabel.id);
  // walk turns until Mabel is acting vs a raise: raise it up with the other player first
  let guard = 0;
  while (h.acting !== raiser && guard++ < 10) act(g, h.acting, { kind: 'call' });
  act(g, raiser, { kind: 'raise', amount: 40 });
  guard = 0;
  while (h.acting && h.acting !== mabel.id && guard++ < 10) act(g, h.acting, { kind: 'call' });
  if (h.acting === mabel.id) {
    const av = availableActions(g, mabel.id);
    const a = decideBotAction(g, mabel.id, av);
    assert.equal(a.kind, 'fold', 'Mabel folds 72o to a 4x raise');
  }
  // aces: Gus (loose but any profile) must not fold AA
  h.cards[gus.id] = ['As', 'Ah'];
  if (h.acting === gus.id || true) {
    // synthesize: directly ask decision as if Gus faces the raise
    const av2 = { yourTurn: true, owe: 30, stack: gus.stack, minRaise: 30, canFold: true, canCall: true, callAmt: 30, canRaise: true, minRaiseTo: 70, maxRaiseTo: gus.stack + (h.streetBets[gus.id] || 0) };
    const a2 = decideBotAction(g, gus.id, av2);
    assert.ok(a2.kind === 'raise' || a2.kind === 'allin' || a2.kind === 'call', 'never folds AA');
    for (let i = 0; i < 20; i++) {
      const a3 = decideBotAction(g, gus.id, av2);
      assert.notEqual(a3.kind, 'fold');
    }
  }
});

test('monsters do not fold postflop to ordinary bets', () => {
  const g = createGame('FIX2', { sb: 5, bb: 10, stack: 1000 });
  const host = join(g, { name: 'Host' }).player;
  const b = addBot(g, host.id).player;
  host.sittingOut = true;
  const c = addBot(g, host.id).player;
  startHand(g, host.id);
  const h = g.hand;
  // give bot a flopped flush
  h.community = ['2s', '7s', '9s'];
  h.street = 'flop';
  h.cards[b.id] = ['As', 'Ks'];
  const av = { yourTurn: true, owe: 50, stack: 900, minRaise: 50, canFold: true, canCall: true, callAmt: 50, canRaise: true, minRaiseTo: 100, maxRaiseTo: 900 };
  for (let i = 0; i < 30; i++) {
    const a = decideBotAction(g, b.id, av);
    assert.ok(a.kind === 'call' || a.kind === 'raise' || a.kind === 'allin', `nut flush never folds (got ${a.kind})`);
  }
});
