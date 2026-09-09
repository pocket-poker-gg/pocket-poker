import WebSocket from 'ws';
const code = process.argv[2];
const names = ['Sara', 'Mike', 'Jon'];
const clients = [];
for (const name of names) {
  const ws = new WebSocket(`wss://pocket-poker.pocket-poker-gg.workers.dev/ws/${code}`);
  const c = { name, id: null, state: null, ws };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'welcome') c.id = m.playerId;
    if (m.t === 'state') {
      c.state = m.state;
      // auto-play: call or check when it's our turn
      if (m.state.actions?.yourTurn) {
        const a = m.state.actions;
        setTimeout(() => {
          ws.send(JSON.stringify({ t: 'action', kind: a.owe > 0 ? 'call' : 'check' }));
        }, 700);
      }
    }
  });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'join', name }));
  await new Promise((r) => { const i = setInterval(() => { if (c.id) { clearInterval(i); r(); } }, 100); });
  clients.push(c);
  console.log(name, 'joined');
}
console.log('bots ready, playing automatically');
setInterval(() => {}, 1000);
