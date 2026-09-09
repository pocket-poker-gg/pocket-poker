(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SUIT_COLOR = { h: 'red', d: 'red', s: 'black', c: 'black' };

  let ws = null;
  let roomCode = null;
  let myId = null;
  let myToken = null;
  let lastState = null;
  let lastLogN = 0;
  let reconnectTimer = null;
  let reconnectDelay = 800;
  let ringTimer = null;
  let intentionalClose = false;

  const params = new URLSearchParams(location.search);
  const urlRoom = (params.get('room') || '').toUpperCase();

  // ---------- helpers ----------
  const tokenKey = (code) => 'pp_token_' + code;
  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 2) box.firstChild.remove();
    setTimeout(() => el.remove(), 2400);
  }

  function cardEl(card, mini) {
    const el = document.createElement('div');
    el.className = 'pcard' + (mini ? ' mini' : '');
    if (!card) { el.classList.add('back'); return el; }
    const r = card[0], s = card[1];
    if (SUIT_COLOR[s] === 'red') el.classList.add('red');
    el.innerHTML = `<div class="rank">${r === 'T' ? '10' : r}</div><div class="center">${SUIT_GLYPH[s]}</div><div class="suit">${SUIT_GLYPH[s]}</div>`;
    return el;
  }

  // ---------- connection ----------
  function connect(code, name) {
    roomCode = code;
    myToken = localStorage.getItem(tokenKey(code));
    intentionalClose = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws/${code}`);
    ws.onopen = () => {
      reconnectDelay = 800;
      hide('connOverlay');
      ws.send(JSON.stringify({ t: 'join', name, token: myToken }));
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'welcome') {
        myId = msg.playerId;
        myToken = msg.token;
        localStorage.setItem(tokenKey(code), myToken);
        if (name) localStorage.setItem('pp_name', name);
        history.replaceState(null, '', '/?room=' + code);
        show('table'); hide('home');
      } else if (msg.t === 'state') {
        render(msg.state);
      } else if (msg.t === 'error') {
        toast(msg.msg);
      }
    };
    ws.onclose = () => {
      if (intentionalClose) return;
      show('connOverlay');
      reconnectTimer = setTimeout(() => connect(code, localStorage.getItem('pp_name') || ''), reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.6, 8000);
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  function sendMsg(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  // ---------- seat geometry ----------
  function seatPos(slot, total) {
    if (slot === 0) return { x: 50, y: 82 };
    const m = total - 1;
    const theta = ((180 + ((slot) * 180) / (m + 1)) * Math.PI) / 180;
    return { x: 50 + 43 * Math.cos(theta), y: 44 + 26 * Math.sin(theta) };
  }

  // ---------- render ----------
  function render(st) {
    lastState = st;
    myId = st.you;
    $('codeLabel').textContent = st.code;
    $('shareCode').textContent = st.code;

    // lobby vs game
    if (st.status === 'lobby') { show('lobby'); } else { hide('lobby'); }
    renderLobby(st);

    // pot
    if (st.hand && st.hand.pot > 0 && st.status === 'playing') {
      show('potChip'); $('potVal').textContent = fmt(st.hand.pot);
    } else hide('potChip');

    // community
    const com = $('community');
    com.innerHTML = '';
    if (st.hand) {
      for (const c of st.hand.community) com.appendChild(cardEl(c));
      const sl = $('streetLabel');
      if (st.status === 'playing' && st.hand.street !== 'preflop') {
        sl.textContent = st.hand.street; sl.classList.remove('hidden');
      } else sl.classList.add('hidden');
    }

    renderSeats(st);
    renderMe(st);
    renderBetween(st);
    renderActions(st);

    // toasts from log
    for (const e of st.log) {
      if (e.n > lastLogN) { lastLogN = e.n; if (myId) toast(e.msg); }
    }
    if (st.log.length) lastLogN = Math.max(lastLogN, st.log[st.log.length - 1].n);
  }

  function renderSeats(st) {
    const seatsEl = $('seats');
    seatsEl.innerHTML = '';
    const players = st.players;
    const myIdx = Math.max(0, players.findIndex((p) => p.id === myId));
    const ordered = players.slice(myIdx).concat(players.slice(0, myIdx));
    ordered.forEach((p, i) => {
      if (p.id === myId) return; // self rendered in meArea
      const pos = seatPos(i, players.length);
      const el = document.createElement('div');
      el.className = 'seat' + (p.folded ? ' folded' : '') + (p.isActing ? ' acting' : '') + (p.connected ? '' : ' offline');
      el.style.left = pos.x + '%';
      el.style.top = pos.y + '%';
      let hole = '';
      const inGame = p.inHand && st.status !== 'lobby';
      if (inGame) {
        hole = '<div class="hole">';
        if (p.cards) for (const c of p.cards) hole += cardHtml(c, true);
        else if (!p.folded) hole += cardHtml(null, true) + cardHtml(null, true);
        hole += '</div>';
      }
      el.innerHTML = `
        ${p.isActing && st.hand && st.hand.turnDeadline ? '<div class="turn-ring"><i></i></div>' : ''}
        ${hole}
        <div class="avatar">
          ${p.isDealer ? '<div class="dealer-btn">D</div>' : ''}
          <div class="sname">${escapeHtml(p.name)}${p.isBot ? '<span class="bottag">bot</span>' : ''}</div>
          <div class="sstack">${fmt(p.stack)}</div>
        </div>
        ${p.bet > 0 && st.status === 'playing' ? `<div class="bet-chip">${fmt(p.bet)}</div>` : ''}
      `;
      if (p.cards) {
        const holeEl = el.querySelector('.hole');
        if (holeEl) { holeEl.innerHTML = ''; for (const c of p.cards) holeEl.appendChild(cardEl(c, true)); }
      }
      seatsEl.appendChild(el);
    });
    // turn ring countdown
    if (ringTimer) clearInterval(ringTimer);
    if (st.hand && st.hand.turnDeadline && st.status === 'playing') {
      const deadline = st.hand.turnDeadline;
      const total = 60000;
      ringTimer = setInterval(() => {
        const left = Math.max(0, deadline - Date.now());
        document.querySelectorAll('.turn-ring i').forEach((i) => (i.style.width = (left / total) * 100 + '%'));
        const myRing = $('meRing');
        if (myRing) myRing.style.width = (left / total) * 100 + '%';
      }, 250);
    }
  }
  function cardHtml() { return ''; } // cards appended via cardEl after

  function renderMe(st) {
    const me = st.players.find((p) => p.id === myId);
    if (!me) return;
    const mc = $('myCards');
    mc.innerHTML = '';
    if (me.cards) for (const c of me.cards) mc.appendChild(cardEl(c));
    $('meInfo').classList.remove('hidden');
    $('meName').textContent = me.name;
    $('meStack').textContent = fmt(me.stack);
  }

  function renderActions(st) {
    const a = st.actions;
    const bar = $('actionBar');
    if (!a || !a.yourTurn) { bar.classList.add('hidden'); hide('raiseSheet'); return; }
    bar.classList.remove('hidden');
    const fold = $('foldBtn'), call = $('callBtn'), raise = $('raiseBtn');
    if (a.owe > 0) {
      fold.classList.remove('hidden');
      call.textContent = `Call ${fmt(a.callAmt)}`;
      raise.textContent = a.canRaise ? 'Raise' : 'All in';
    } else {
      fold.classList.add('hidden');
      call.textContent = 'Check';
      raise.textContent = a.canBet ? 'Bet' : a.canRaise ? 'Raise' : 'All in';
    }
    call.onclick = () => { sendMsg({ t: 'action', kind: a.owe > 0 ? 'call' : 'check' }); hide('raiseSheet'); };
    fold.onclick = () => { sendMsg({ t: 'action', kind: 'fold' }); hide('raiseSheet'); };
    raise.onclick = () => {
      if (!a.canRaise && !a.canBet) { sendMsg({ t: 'action', kind: 'allin' }); return; }
      openRaiseSheet(st, a);
    };
  }

  function openRaiseSheet(st, a) {
    const sheet = $('raiseSheet');
    sheet.classList.remove('hidden');
    const range = $('raiseRange');
    const min = a.canBet ? a.minBet : a.minRaiseTo;
    const max = a.canBet ? a.maxBet : a.maxRaiseTo;
    range.min = min; range.max = max; range.value = min;
    range.step = st.config.sb;
    const val = $('raiseVal');
    const upd = () => (val.textContent = fmt(range.value));
    range.oninput = upd; upd();
    $('raiseConfirm').textContent = Number(range.value) >= max ? 'All in' : (a.canBet ? 'Bet' : 'Raise');
    range.onchange = () => ($('raiseConfirm').textContent = Number(range.value) >= max ? 'All in' : (a.canBet ? 'Bet' : 'Raise'));
    document.querySelectorAll('.qbtn').forEach((b) => {
      b.onclick = () => {
        const q = b.dataset.q;
        if (q === 'min') range.value = min;
        else if (q === 'allin') range.value = max;
        else if (q === 'pot') {
          const pot = (st.hand ? st.hand.pot : 0) + (a.owe || 0);
          range.value = Math.max(min, Math.min(max, pot));
        }
        upd();
        $('raiseConfirm').textContent = Number(range.value) >= max ? 'All in' : (a.canBet ? 'Bet' : 'Raise');
      };
    });
    $('raiseConfirm').onclick = () => {
      const v = Number(range.value);
      if (v >= max) sendMsg({ t: 'action', kind: 'allin' });
      else sendMsg({ t: 'action', kind: a.canBet ? 'bet' : 'raise', amount: v });
      hide('raiseSheet');
    };
    $('raiseClose').onclick = () => hide('raiseSheet');
  }

  function renderLobby(st) {
    if (st.status !== 'lobby') return;
    const ul = $('lobbyPlayers');
    ul.innerHTML = '';
    for (const p of st.players) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="dot${p.connected ? '' : ' off'}"></span>
        <span class="who">${escapeHtml(p.name)}</span>
        ${p.isHost ? '<span class="badge">host</span>' : ''}
        ${p.isBot ? '<span class="badge bot">bot</span>' : ''}
        ${st.hostId === myId && p.id !== myId ? '<button class="kick" title="Remove">&times;</button>' : ''}
      `;
      const kickBtn = li.querySelector('.kick');
      if (kickBtn) kickBtn.onclick = () => sendMsg({ t: 'kick', playerId: p.id });
      ul.appendChild(li);
    }
    const isHost = st.hostId === myId;
    $('addBotBtn').classList.toggle('hidden', !(isHost && st.players.length < 9));
    $('hostSettings').classList.toggle('hidden', !isHost);
    const startBtn = $('startBtn');
    startBtn.classList.toggle('hidden', !isHost);
    startBtn.disabled = st.players.length < 2;
    startBtn.textContent = st.handNum > 0 ? 'Deal again' : 'Deal the first hand';
    $('lobbyHint').textContent = isHost
      ? (st.players.length < 2 ? 'Add a bot, or wait for a friend to join.' : '')
      : 'Waiting for the host to deal.';

    // settings segs reflect config
    if (isHost) {
      document.querySelectorAll('#blindsSeg button').forEach((b) => {
        b.classList.toggle('on', b.dataset.b === st.config.sb + '/' + st.config.bb);
        b.onclick = () => {
          const [sb, bb] = b.dataset.b.split('/').map(Number);
          sendMsg({ t: 'config', sb, bb });
        };
      });
      document.querySelectorAll('#stackSeg button').forEach((b) => {
        b.classList.toggle('on', Number(b.dataset.s) === st.config.stack);
        b.onclick = () => sendMsg({ t: 'config', stack: Number(b.dataset.s) });
      });
    }
  }

  function renderBetween(st) {
    const bar = $('betweenBar');
    if (st.status !== 'between' || !st.hand || !st.hand.result) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const r = st.hand.result;
    let html = '';
    if (r.type === 'uncontested') {
      const w = r.winners[0];
      html = `<span class="win-amt">${escapeHtml(w.name)}</span> takes <span class="win-amt">${fmt(w.amount)}</span>`;
    } else {
      html = r.pots.map((pot, i) =>
        pot.winners.map((w) =>
          `<span class="win-amt">${escapeHtml(w.name)}</span> wins <span class="win-amt">${fmt(w.amount)}</span><span class="win-hand">${escapeHtml(w.hand)}${pot.winners.length > 1 ? ' - split pot' : ''}</span>`
        ).join('')
      ).join('');
    }
    $('resultText').innerHTML = html;
    const isHost = st.hostId === myId;
    $('nextHandBtn').classList.toggle('hidden', !isHost);
    const me = st.players.find((p) => p.id === myId);
    const canRebuy = me && me.stack < st.config.stack;
    $('rebuyBtn').classList.toggle('hidden', !canRebuy);
    if (!isHost && !canRebuy) $('resultText').innerHTML += '<span class="win-hand">waiting for host…</span>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- share ----------
  async function shareRoom() {
    const url = `${location.origin}/?room=${roomCode}`;
    const data = { title: 'Pocket Poker', text: `Poker? Table code ${roomCode}`, url };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      throw 0;
    } catch {
      try { await navigator.clipboard.writeText(url); toast('Invite link copied'); }
      catch { toast(`Code: ${roomCode}`); }
    }
  }

  // ---------- wire up ----------
  $('createBtn').onclick = async () => {
    const name = $('nameInput').value.trim() || 'Player';
    $('createBtn').disabled = true;
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const { code } = await res.json();
      connect(code, name);
    } catch { toast('Could not create table'); }
    $('createBtn').disabled = false;
  };
  $('joinForm').onsubmit = (e) => {
    e.preventDefault();
    const name = $('nameInput').value.trim() || 'Player';
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) return toast('Enter the 4-letter code');
    connect(code, name);
  };
  $('codeChip').onclick = shareRoom;
  $('shareBtn').onclick = shareRoom;
  $('menuShare').onclick = () => { hide('menuSheet'); shareRoom(); };
  $('menuBtn').onclick = () => {
    if (!lastState) return;
    const isHost = lastState.hostId === myId;
    const me = lastState.players.find((p) => p.id === myId);
    $('menuRestart').classList.toggle('hidden', !isHost);
    $('menuRebuy').classList.toggle('hidden', !(lastState.status !== 'playing' && me && me.stack < lastState.config.stack));
    show('menuSheet');
  };
  $('menuClose').onclick = () => hide('menuSheet');
  $('menuRestart').onclick = () => { sendMsg({ t: 'restart' }); hide('menuSheet'); };
  $('menuRebuy').onclick = () => { sendMsg({ t: 'rebuy' }); hide('menuSheet'); };
  $('menuLeave').onclick = () => {
    intentionalClose = true;
    try { ws && ws.close(); } catch {}
    if (roomCode) localStorage.removeItem(tokenKey(roomCode));
    location.href = '/';
  };
  $('addBotBtn').onclick = () => sendMsg({ t: 'add_bot' });
  $('startBtn').onclick = () => sendMsg({ t: 'start' });
  $('nextHandBtn').onclick = () => sendMsg({ t: 'start' });
  $('rebuyBtn').onclick = () => sendMsg({ t: 'rebuy' });

  // ---------- boot ----------
  const savedName = localStorage.getItem('pp_name');
  if (savedName) $('nameInput').value = savedName;
  if (urlRoom && urlRoom.length === 4) {
    const tok = localStorage.getItem(tokenKey(urlRoom));
    if (tok && savedName) {
      // auto-rejoin
      show('table'); hide('home'); show('connOverlay');
      connect(urlRoom, savedName);
    } else {
      $('codeInput').value = urlRoom;
      $('nameInput').focus();
    }
  }
})();
