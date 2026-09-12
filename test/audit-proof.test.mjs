import { test } from 'node:test';
import assert from 'node:assert/strict';
import pokersolver from 'pokersolver';
import { createGame, join, startHand, act, availableActions, publicState, potTotal, setTestDeck, settleShowdownForTest, describeCurrentHand, GameError } from '../src/engine.js';
const { Hand } = pokersolver;
const deck = [...'cdhs'].flatMap((s) => [...'23456789TJQKA'].map((r) => r + s));

function game(stacks) {
  const g = createGame('TEST', { sb: 5, bb: 10, stack: 1000 });
  const ids = stacks.map((stack, i) => { const p = join(g, { name: `P${i}` }).player; p.stack = stack; return p.id; });
  return { g, ids };
}
function total(g) { return g.players.reduce((n,p)=>n+p.stack,0) + (g.status === 'playing' ? potTotal(g.hand) : 0); }
function legal(av) {
  if (av.owe > 0) return av.canRaise && Math.random() < .18 ? {kind:'raise',amount:av.minRaiseTo} : Math.random()<.22 ? {kind:'fold'} : {kind:'call'};
  return av.canBet && Math.random()<.22 ? {kind:'bet',amount:av.minBet} : {kind:'check'};
}

test('best-current-hand summary is correct from preflop through river', () => {
  assert.equal(describeCurrentHand(['Ks', '7h']), 'K High');
  assert.equal(describeCurrentHand(['Ks', 'Kh']), "Pair of K's");
  assert.equal(describeCurrentHand(['Ks', '7h', '9c', '9h', 'Kd']), "Two Pair, K's & 9's");
  assert.equal(describeCurrentHand(['7s', '8s', '9s', 'Ts', 'Js']), 'Straight Flush, Js High');
  assert.equal(describeCurrentHand(['As', 'Kd', '2c', '3h', '4s', '9d', 'Tc']), 'A High');
});

test('best-current-hand summary is private to its player view', () => {
  const { g, ids } = game([1000, 1000]);
  startHand(g, ids[0]);
  const view = publicState(g, ids[0]);
  const mine = view.players.find((p) => p.id === ids[0]);
  const other = view.players.find((p) => p.id === ids[1]);
  assert.ok(mine.bestHand);
  assert.equal(other.bestHand, null);
});

test('golden evaluator vectors cover wheel, board play, counterfeit, flush and quads', () => {
  const win = (a,b,board) => Hand.winners([Hand.solve([...a,...board]), Hand.solve([...b,...board])]).length;
  assert.equal(Hand.solve(['As','2d','3c','4h','5s']).name, 'Straight');
  assert.equal(Hand.solve(['As','Ks','8s','4s','2s']).name, 'Flush');
  assert.equal(Hand.solve(['As','Ad','Ac','Ah','2s']).name, 'Four of a Kind');
  assert.equal(win(['2c','3d'], ['4c','5d'], ['As','Ks','Qs','Js','Ts']), 2, 'both play royal board');
  assert.equal(win(['As','2c'], ['Ks','Qc'], ['Ah','Kd','Kc','2d','2s']), 1, 'counterfeited two pair resolves by best five');
});

test('256-bit seat tokens, normalization, and payload privacy', () => {
  const g=createGame('TEST');
  const a=join(g,{name:'  José🎰<img>  '}); const b=join(g,{name:'Bob'});
  assert.match(a.token,/^[a-f0-9]{64}$/);
  assert.equal(g.players[0].name.length <= 16,true);
  startHand(g,a.player.id);
  const wire=JSON.stringify(publicState(g,a.player.id));
  assert.ok(wire.includes(g.hand.cards[a.player.id][0]));
  for (const card of g.hand.cards[b.player.id]) assert.ok(!wire.includes(card));
  for (const card of g.hand.deck) assert.ok(!wire.includes(`"${card}"`));
  assert.ok(!wire.includes(a.token));
});

test('adversarial actions fail closed without mutating chips', () => {
  const {g,ids}=game([1000,1000,1000]); startHand(g,ids[0]);
  const actor=g.hand.acting; const before=structuredClone(g);
  const other=ids.find(id=>id!==actor);
  for (const bad of [
    ()=>act(g,other,{kind:'call'}), ()=>act(g,actor,{kind:'check'}),
    ()=>act(g,actor,{kind:'raise',amount:-1}), ()=>act(g,actor,{kind:'raise',amount:Infinity}),
    ()=>act(g,actor,{kind:'raise',amount:10.5}), ()=>act(g,actor,{kind:'raise',amount:999999}),
    ()=>act(g,actor,{kind:'wat'}),
  ]) assert.throws(bad,GameError);
  assert.equal(total(g),total(before)); assert.equal(g.hand.acting,before.hand.acting);
});

test('property: 10,000 random legal hands preserve invariants', { timeout: 120000 }, () => {
  for(let run=0;run<2000;run++) {
    const n=2+(run%8); const initial=Array(n).fill(1000); const {g}=game(initial); const expected=n*1000;
    startHand(g,g.hostId); let guard=0;
    while(g.status==='playing' && guard++<1000) {
      const h=g.hand; const all=[...h.deck,...h.community,...Object.values(h.cards).flat()];
      assert.equal(new Set(all).size,all.length,'no duplicate cards'); assert.ok(h.community.length<=5);
      for(const [id,cards] of Object.entries(h.cards)){assert.equal(cards.length,2);assert.ok(!h.allin[id]||h.acting!==id);}
      assert.equal(total(g),expected); assert.ok(h.acting); act(g,h.acting,legal(availableActions(g,h.acting)));
    }
    assert.ok(guard<1000); assert.equal(total(g),expected); for(const p of g.players) assert.ok(p.stack>=0);
  }
});

test('heads-up button posts small blind and acts first preflop, last postflop', () => {
  const {g}=game([1000,1000]); startHand(g,g.hostId);
  const dealer=g.players.find(p=>p.id===g.hand.dealerId); const other=g.players.find(p=>p.id!==dealer.id);
  assert.equal(g.hand.streetBets[dealer.id],5); assert.equal(g.hand.streetBets[other.id],10); assert.equal(g.hand.acting,dealer.id);
  act(g,dealer.id,{kind:'call'}); act(g,other.id,{kind:'check'});
  assert.equal(g.hand.street,'flop'); assert.equal(g.hand.acting,other.id);
});

test('short all-in does not reopen a player who already acted', () => {
  const {g}=game([1000,25,1000]);
  // Make seats deterministic: dealer seat 2 => seat 0 first, seat 1 second, short BB seat 2.
  g.dealerSeat=1; startHand(g,g.hostId);
  const first=g.hand.acting;
  act(g,first,{kind:'raise',amount:20});
  const second=g.hand.acting; act(g,second,{kind:'call'});
  const short=g.hand.acting; assert.equal(g.players.find(p=>p.id===short).stack,15);
  act(g,short,{kind:'allin'}); // to 25, a short raise of 5 after a full raise of 10
  assert.ok([first,second].includes(g.hand.acting));
  assert.ok(!availableActions(g,g.hand.acting).canRaise);
});

test('regression E2F7: unmatched all-in excess is refunded, never reported as winnings', () => {
  // Exact screenshot economics: two 500 stacks; the losing player has 210 left.
  // Contributions are 290 vs 500, so only 580 is contested and 210 is returned.
  const {g,ids}=game([500,500]); startHand(g,g.hostId);
  const loser=ids[0], winner=ids[1];
  g.hand.contrib[loser]=290; g.hand.contrib[winner]=500;
  g.players.find(p=>p.id===loser).stack=210; g.players.find(p=>p.id===winner).stack=0;
  g.hand.cards[loser]=['6h','7d']; g.hand.cards[winner]=['7h','Ks'];
  g.hand.community=['3h','Qs','Kd','9c','9h']; g.hand.folded={};
  settleShowdownForTest(g);
  assert.deepEqual(g.hand.result.uncalledRefund,{id:winner,amount:210});
  assert.equal(g.hand.result.pots.length,1);
  assert.equal(g.hand.result.pots[0].amount,580,'only matched chips are winnings');
  assert.equal(g.hand.result.pots[0].winners[0].id,winner);
  assert.equal(g.hand.result.pots[0].winners[0].amount,580);
  assert.equal(g.players.find(p=>p.id===winner).stack,790,'final screenshot stack remains correct');
  assert.equal(g.players.find(p=>p.id===loser).stack,210);
});
