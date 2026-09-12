import WebSocket from 'ws';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const WSBASE = BASE.replace('https://', 'wss://').replace('http://', 'ws://');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROTOCOL_VERSION = 2;
let actionNo = 0;

async function mkClient(code, name) {
  const c = {
    name, id: null, token: null, state: null, log: [],
    ws: new WebSocket(`${WSBASE}/ws/${code}`, { origin: BASE }),
    waiters: [],
  };
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'welcome') { c.id = m.playerId; c.token = m.token; }
    if (m.t === 'state') c.state = m.state;
    if (m.t === 'error') c.log.push('ERR: ' + m.msg);
    c.waiters.forEach((w) => w());
  });
  await new Promise((res, rej) => { c.ws.on('open', res); c.ws.on('error', rej); });
  c.send = (o) => {
    const m = { ...o, protocolVersion: PROTOCOL_VERSION };
    if (m.t === 'action') { m.handNum = c.state.hand.num; m.expectedSeq = c.state.hand.actionSeq; m.actionId = `test-act-${++actionNo}`; }
    c.ws.send(JSON.stringify(m));
  };
  c.send({ t: 'join', name });
  await until(c, () => c.id && c.state);
  return c;
}
function until(c, pred, ms = 8000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = pred(); } catch {}
      if (ok) return res();
      if (Date.now() - t0 > ms) return rej(new Error(`timeout waiting (${c.name})`));
    };
    c.waiters.push(tick);
    tick();
  });
}

const res = await fetch(BASE + '/api/rooms', { method: 'POST' });
const { code } = await res.json();
console.log('room code:', code);
assert.match(code, /^[A-Z2-9]{4}$/);

const a = await mkClient(code, 'Alice');
const b = await mkClient(code, 'Bob');
const c3 = await mkClient(code, 'Cleo');
await until(a, () => a.state.players.length === 3);
assert.equal(a.state.players.length, 3);
await until(a, () => a.state.hostId === a.id);
console.log('3 players joined, host is Alice');

// config change by non-host should error
b.send({ t: 'config', sb: 25, bb: 50 });
await sleep(300);
assert.ok(b.log.some((l) => l.includes('host')), 'non-host config rejected');
// host sets config
a.send({ t: 'config', sb: 5, bb: 10, stack: 1000 });
await until(a, () => a.state.config.bb === 10);
console.log('config set by host');

a.send({ t: 'start' });
await until(a, () => a.state.status === 'playing');
await until(b, () => b.state.status === 'playing');
await until(c3, () => c3.state.status === 'playing');
console.log('hand started. street:', a.state.hand.street, 'pot:', a.state.hand.pot);

// verify hole card privacy in states
const avA = a.state.players.find((p) => p.id === a.id);
const bvA = a.state.players.find((p) => p.id === b.id);
assert.ok(Array.isArray(avA.cards), 'I can see my cards');
assert.equal(bvA.cards, null, 'opponent cards hidden');

// scripted hand: call/check everything to showdown
let steps = 0;
while (a.state.status === 'playing' && steps++ < 400) {
  const acting = a.state.hand.acting;
  const client = [a, b, c3].find((x) => x.id === acting);
  const acts = client.state.actions;
  assert.ok(acts.yourTurn, `${client.name} sees yourTurn`);
  if (acts.owe > 0) client.send({ t: 'action', kind: 'call' });
  else client.send({ t: 'action', kind: 'check' });
  await until(a, () => a.state.hand.acting !== acting || a.state.status !== 'playing', 4000).catch(() => {});
  await sleep(40);
}
await until(a, () => a.state.status === 'between');
console.log('hand complete:', JSON.stringify(a.state.hand.result).slice(0, 300));

const total = a.state.players.reduce((s, p) => s + p.stack, 0);
assert.equal(total, 3000, 'chips conserved');
console.log('chip conservation OK (3000)');

// reconnect: close b, rejoin with token
const bTok = b.token, bId = b.id;
b.ws.close();
await sleep(300);
const b2 = await mkClient(code, 'Bob');
b2.ws.close();
await sleep(200);
// manual rejoin with token
const bw = new WebSocket(`${WSBASE}/ws/${code}`, { origin: BASE });
await new Promise((r) => bw.on('open', r));
bw.send(JSON.stringify({ t: 'join', protocolVersion: PROTOCOL_VERSION, name: 'Bob', token: bTok }));
const rejoined = await new Promise((res) => bw.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.t === 'welcome') res(m); }));
assert.equal(rejoined.playerId, bId, 'reclaim same seat');
assert.equal(rejoined.rejoined, true);
console.log('reconnect/reclaim OK');
bw.close();

// next hand
a.send({ t: 'start' });
await until(a, () => a.state.status === 'playing' && a.state.handNum === 2);
console.log('hand 2 started OK');

console.log('\nALL E2E CHECKS PASSED');
process.exit(0);
