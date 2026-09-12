// End-to-end bot test against a running server (wrangler dev locally, or production).
// BASE env var selects the target. Verifies: host adds bots, bots join with
// profiles, hands play to completion with bots acting inside the turn timer,
// no degenerate behavior in the log, kick works, chips conserved.
import WebSocket from 'ws';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const WSBASE = BASE.replace('https://', 'wss://').replace('http://', 'ws://');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROTOCOL_VERSION = 2; let actionNo = 0;

async function mkClient(code, name) {
  const c = { name, id: null, token: null, state: null, log: [], states: [], ws: new WebSocket(`${WSBASE}/ws/${code}`), waiters: [] };
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'welcome') { c.id = m.playerId; c.token = m.token; }
    if (m.t === 'state') { c.state = m.state; c.states.push({ at: Date.now(), st: m.state }); }
    if (m.t === 'error') c.log.push('ERR: ' + m.msg);
    c.waiters.forEach((w) => w());
  });
  await new Promise((res, rej) => { c.ws.on('open', res); c.ws.on('error', rej); });
  c.send = (o) => { const m={...o,protocolVersion:PROTOCOL_VERSION}; if(m.t==='action'){m.handNum=c.state.hand.num;m.expectedSeq=c.state.hand.actionSeq;m.actionId=`bot-act-${++actionNo}`;} c.ws.send(JSON.stringify(m)); };
  c.send({ t: 'join', name });
  await until(c, () => c.id && c.state);
  return c;
}
function until(c, pred, ms = 30000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      let ok = false;
      try { ok = pred(); } catch {}
      if (ok) { clearInterval(iv); return res(); }
      if (Date.now() - t0 > ms) { clearInterval(iv); return rej(new Error(`timeout waiting (${c.name})`)); }
    }, 100);
  });
}

const res = await fetch(BASE + '/api/rooms', { method: 'POST' });
const { code } = await res.json();
console.log('room:', code);

const host = await mkClient(code, 'Host');
host.send({ t: 'add_bot' });
await until(host, () => host.state.players.some((p) => p.isBot));
host.send({ t: 'add_bot' });
host.send({ t: 'add_bot' });
await until(host, () => host.state.players.filter((p) => p.isBot).length === 3);
const bots = host.state.players.filter((p) => p.isBot);
console.log('bots joined:', bots.map((b) => b.name).join(', '));
assert.deepEqual(bots.map((b) => b.name), ['Aria', 'Gus', 'Mabel']);
assert.ok(bots.every((b) => b.isBot && b.connected));

// start a hand; human just calls/checks along
host.send({ t: 'start' });
await until(host, () => host.state.status === 'playing');
console.log('hand 1 started');

const botActTimes = []; // ms between a bot becoming actor and the act landing
let lastActor = null, lastActorAt = 0;
const t0 = Date.now();
let botDecisions = 0;
let turnSeq = 0; // bumps on every actor change: a player can act twice on one street
const sentTurns = new Set(); // send at most one action per distinct turn
while (Date.now() - t0 < 240000) {
  const st = host.state;
  if (st.status === 'between') break;
  if (st.hand && st.hand.acting !== lastActor) {
    turnSeq++;
    if (lastActor && bots.some((b) => b.id === lastActor)) {
      botActTimes.push(Date.now() - lastActorAt);
      botDecisions++;
    }
    lastActor = st.hand.acting;
    lastActorAt = Date.now();
  }
  if (st.actions?.yourTurn && !sentTurns.has(turnSeq)) {
    sentTurns.add(turnSeq);
    const a = st.actions;
    host.send({ t: 'action', kind: a.owe > 0 ? 'call' : 'check' });
    await sleep(150);
  }
  await sleep(60);
}
await until(host, () => host.state.status === 'between');
console.log('hand 1 complete:', JSON.stringify(host.state.hand.result).slice(0, 200));
assert.ok(botDecisions >= 2, `bots made decisions (${botDecisions})`);
const slowest = Math.max(...botActTimes);
assert.ok(slowest < 30000, `slowest bot act ${slowest}ms well inside 60s timer`);
console.log(`bot acts: ${botDecisions}, think times ${Math.min(...botActTimes)}-${slowest}ms`);

const allLog = host.state.log.map((e) => e.msg).join(' | ');
assert.ok(!allLog.includes('timed out'), 'no bot timed out');
let total = host.state.players.reduce((s, p) => s + p.stack, 0);
assert.equal(total, 4000, 'chips conserved after hand 1');
console.log('no timeouts, chips conserved (4000)');

// play two more hands to test continuation + bot rebuys
for (let handN = 2; handN <= 3; handN++) {
  host.send({ t: 'start' });
  await until(host, () => host.state.status === 'playing');
  const t1 = Date.now();
  let lastActor2 = null;
  while (Date.now() - t1 < 240000) {
    const st = host.state;
    if (st.status === 'between') break;
    if (st.hand && st.hand.acting !== lastActor2) { turnSeq++; lastActor2 = st.hand.acting; }
    if (st.actions?.yourTurn && !sentTurns.has(turnSeq)) {
      sentTurns.add(turnSeq);
      const a = st.actions;
      // mix in a fold sometimes so hands vary
      host.send({ t: 'action', kind: handN === 3 && a.canFold ? 'fold' : a.owe > 0 ? 'call' : 'check' });
      await sleep(150);
    }
    await sleep(60);
  }
  await until(host, () => host.state.status === 'between');
  console.log(`hand ${handN} complete:`, JSON.stringify(host.state.hand.result).slice(0, 160));
}
const logAll = host.state.log.map((e) => e.msg).join(' | ');
assert.ok(!logAll.includes('timed out'), 'no timeouts across 3 hands');

// kick a bot between hands
const victim = host.state.players.find((p) => p.isBot);
host.send({ t: 'kick', playerId: victim.id });
await until(host, () => !host.state.players.some((p) => p.id === victim.id));
console.log('bot kick OK:', victim.name, 'removed');
assert.equal(host.state.hostId, host.id, 'host unchanged');

// error log must be clean
assert.deepEqual(host.log, [], 'no server errors');
console.log('\nALL BOT E2E CHECKS PASSED');
process.exit(0);
