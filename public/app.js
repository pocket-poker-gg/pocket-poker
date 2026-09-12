(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const PROTOCOL_VERSION = 2;
  const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SUIT_COLOR = { h: 'red', d: 'red', s: 'black', c: 'black' };
  const CHIP = '<svg class="chipglyph" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3.4"/><path d="M12 3.8v3M12 17.2v3M3.8 12h3M17.2 12h3"/></svg>';

  let ws = null;
  let roomCode = null;
  let myId = null;
  let myToken = null;
  let lastState = null;
  let prevState = null;
  let suppressFx = true;
  let lastLogN = 0;
  let reconnectTimer = null;
  let reconnectDelay = 800;
  let ringTimer = null;
  let intentionalClose = false;
  let myTurnWas = false;
  const feedQueue = [];
  let feedBusy = false;

  const params = new URLSearchParams(location.search);
  const urlRoom = (params.get('room') || '').toUpperCase();

  // ---------- helpers ----------
  const tokenKey = (code) => 'pp_token_' + code;
  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- feed (single-line event capsule) ----------
  function prettyLog(msg) {
    return String(msg).replace(/\b([2-9TJQKA])([sdhc])\b/g, (m, r, s) => (r === 'T' ? '10' : r) + SUIT_GLYPH[s]);
  }
  function feedPush(msg, isErr) {
    msg = prettyLog(msg);
    feedQueue.push({ msg, isErr });
    if (!feedBusy) feedNext();
  }
  function feedNext() {
    const item = feedQueue.shift();
    const feed = $('feed');
    if (!item) { feedBusy = false; feed.classList.remove('on'); setTimeout(() => { if (!feedBusy) feed.classList.add('hidden'); }, 260); return; }
    feedBusy = true;
    feed.classList.remove('hidden');
    feed.classList.toggle('err', !!item.isErr);
    feed.classList.remove('on');
    $('feedText').textContent = item.msg;
    requestAnimationFrame(() => requestAnimationFrame(() => feed.classList.add('on')));
    setTimeout(feedNext, item.isErr ? 2200 : 1500);
  }

  // ---------- cards ----------
  function cardEl(card, opts = {}) {
    const el = document.createElement('div');
    el.className = 'pcard' + (opts.mini ? ' mini' : '') + (opts.cls ? ' ' + opts.cls : '');
    if (opts.delay) el.style.setProperty('--d', opts.delay + 's');
    if (opts.fy != null) el.style.setProperty('--fy', opts.fy + 'px');
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
      ws.send(JSON.stringify({ t: 'join', protocolVersion: PROTOCOL_VERSION, name, token: myToken }));
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.protocolVersion && msg.protocolVersion !== PROTOCOL_VERSION) { feedPush('Pocket Poker updated - reload to continue', true); return; }
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
        feedPush(msg.msg, true);
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
    if (!ws || ws.readyState !== 1 || !lastState) return;
    const envelope = { ...obj, protocolVersion: PROTOCOL_VERSION };
    if (obj.t === 'action') {
      envelope.handNum = lastState.hand?.num;
      envelope.expectedSeq = lastState.hand?.actionSeq;
      envelope.actionId = crypto.randomUUID();
    }
    ws.send(JSON.stringify(envelope));
  }

  // ---------- seat geometry ----------
  // hand-tuned layouts: slot 0 is me (bottom center); opponents run
  // clockwise from lower-left, over the top, down the right side
  const SEAT_LAYOUTS = {
    1: [{ x: 50, y: 16 }],
    2: [{ x: 27, y: 21 }, { x: 73, y: 21 }],
    3: [{ x: 17, y: 30 }, { x: 50, y: 15.5 }, { x: 83, y: 30 }],
    4: [{ x: 14, y: 38 }, { x: 27, y: 17.5 }, { x: 73, y: 17.5 }, { x: 86, y: 38 }],
    5: [{ x: 12, y: 44 }, { x: 21, y: 21 }, { x: 50, y: 15 }, { x: 79, y: 21 }, { x: 88, y: 44 }],
    6: [{ x: 11.5, y: 48 }, { x: 17, y: 27 }, { x: 34, y: 15.5 }, { x: 66, y: 15.5 }, { x: 83, y: 27 }, { x: 88.5, y: 48 }],
    7: [{ x: 11, y: 51 }, { x: 14, y: 33 }, { x: 25, y: 17.5 }, { x: 50, y: 14.5 }, { x: 75, y: 17.5 }, { x: 86, y: 33 }, { x: 88.5, y: 51 }],
    8: [{ x: 11, y: 53 }, { x: 12.5, y: 36 }, { x: 20, y: 19.5 }, { x: 34, y: 14.5 }, { x: 66, y: 14.5 }, { x: 80, y: 19.5 }, { x: 87.5, y: 36 }, { x: 88.5, y: 53 }],
  };
  function seatPos(slot, total) {
    if (slot === 0) return { x: 50, y: 82 };
    const m = total - 1;
    const layout = SEAT_LAYOUTS[Math.min(8, m)];
    return layout[Math.min(slot - 1, layout.length - 1)];
  }

  // direction vector (px) from a % position toward table center (50, 44.5)
  function dirToCenter(pos) {
    const felt = $('felt');
    const W = felt.clientWidth, H = felt.clientHeight;
    const cx = 50, cy = 44.5;
    const dx = (cx - pos.x) / 100 * W, dy = (cy - pos.y) / 100 * H;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  // ---------- diffing ----------
  function computeDiff(prev, cur) {
    const d = { newHand: false, prevCommunity: 0, sweptPids: [], handEnded: false, revealedNow: false, winnerIds: new Set(), myTurnNow: false };
    const ph = prev && prev.hand, ch = cur.hand;
    d.newHand = !!(ch && (!ph || ph.num !== ch.num));
    if (ch && ph && ph.num === ch.num) d.prevCommunity = ph.community.length;
    d.handEnded = !!(prev && prev.status === 'playing' && cur.status === 'between');
    d.revealedNow = !!(ch && ch.revealed && !(ph && ph.revealed));
    if (ph && ch && ph.num === ch.num) {
      for (const p of cur.players) {
        const pp = prev.players.find((x) => x.id === p.id);
        if (pp && pp.bet > 0 && p.bet < pp.bet) d.sweptPids.push(p.id);
      }
    }
    if (cur.status === 'between' && ch && ch.result) {
      const r = ch.result;
      if (r.type === 'uncontested') d.winnerIds.add(r.winners[0].id);
      else for (const pot of r.pots) for (const w of pot.winners) d.winnerIds.add(w.id);
    }
    d.myTurnNow = !!(cur.actions && cur.actions.yourTurn && !myTurnWas);
    return d;
  }

  // ---------- render ----------
  function render(st) {
    // capture pre-rebuild rects for fx
    const oldBets = {};
    document.querySelectorAll('.seat .bet').forEach((el) => {
      oldBets[el.dataset.pid] = el.getBoundingClientRect();
    });
    const oldPotRect = !$('potLine').classList.contains('hidden') ? $('potPill').getBoundingClientRect() : null;

    const diff = computeDiff(prevState, st);
    lastState = st;
    myId = st.you;
    $('codeLabel').textContent = st.code;
    $('shareCode').textContent = st.code;

    if (st.status === 'lobby') { show('lobby'); } else { hide('lobby'); }
    renderLobby(st);

    // pot line
    const potLine = $('potLine');
    if (st.hand && st.hand.pot > 0 && st.status === 'playing') {
      potLine.classList.remove('hidden');
      $('potVal').textContent = fmt(st.hand.pot);
      const sl = $('streetLabel');
      sl.textContent = (st.status === 'playing' && st.hand.street !== 'preflop') ? st.hand.street : '';
    } else potLine.classList.add('hidden');

    // community
    const com = $('community');
    com.innerHTML = '';
    if (st.hand) {
      st.hand.community.forEach((c, i) => {
        const isNew = i >= diff.prevCommunity && !suppressFx;
        com.appendChild(cardEl(c, isNew ? { cls: 'new', delay: (i - diff.prevCommunity) * 0.09, fy: -64 } : {}));
      });
    }

    renderSeats(st, diff);
    renderMe(st, diff);
    renderBetween(st, diff);
    renderActions(st, diff);

    // feed from log
    for (const e of st.log) {
      if (e.n > lastLogN) { lastLogN = e.n; if (myId && !suppressFx) feedPush(e.msg); }
    }
    if (st.log.length) lastLogN = Math.max(lastLogN, st.log[st.log.length - 1].n);

    myTurnWas = !!(st.actions && st.actions.yourTurn);
    suppressFx = false;
    prevState = st;
    requestAnimationFrame(() => runFx(diff, oldBets, oldPotRect, st));
  }

  function renderSeats(st, diff) {
    const seatsEl = $('seats');
    seatsEl.innerHTML = '';
    const players = st.players;
    const myIdx = Math.max(0, players.findIndex((p) => p.id === myId));
    const ordered = players.slice(myIdx).concat(players.slice(0, myIdx));
    ordered.forEach((p, i) => {
      if (p.id === myId) return;
      const pos = seatPos(i, players.length);
      const dir = dirToCenter(pos);
      const el = document.createElement('div');
      el.className = 'seat'
        + (p.folded ? ' folded' : '')
        + (p.isActing ? ' acting' : '')
        + (p.connected ? '' : ' offline')
        + (diff.winnerIds.has(p.id) ? ' winner' : '');
      el.style.left = pos.x + '%';
      el.style.top = pos.y + '%';

      const pill = document.createElement('div');
      pill.className = 'pill';
      pill.innerHTML = `
        <div class="nm">${escapeHtml(p.name)}${p.isBot ? '<span class="bottag">bot</span>' : ''}</div>
        <div class="st${p.allin && !p.folded && st.status === 'playing' ? ' allin' : ''}">${p.allin && !p.folded && st.status === 'playing' ? 'ALL IN' : fmt(p.stack)}</div>
      `;
      if (p.isActing && st.hand && st.hand.turnDeadline && st.status === 'playing') {
        pill.insertAdjacentHTML('afterbegin', '<div class="timerbar"><i></i></div>');
      }
      el.appendChild(pill);

      // hole cards, offset toward table center
      const inGame = p.inHand && st.status !== 'lobby' && !p.folded;
      if (inGame) {
        const hole = document.createElement('div');
        hole.className = 'hole';
        const hd = 60 + 26 * Math.abs(dir.x);
        hole.style.left = '50%';
        hole.style.top = '50%';
        hole.style.transform = `translate(-50%,-50%) translate(${(dir.x * hd).toFixed(1)}px, ${(dir.y * hd).toFixed(1)}px)`;
        if (p.cards) {
          p.cards.forEach((c, ci) => {
            const cls = diff.revealedNow && !suppressFx ? 'reveal' : '';
            const win = diff.winnerIds.has(p.id);
            const dead = st.hand && st.hand.revealed && !win && st.status === 'between';
            hole.appendChild(cardEl(c, { mini: true, cls: cls + (win ? ' win' : '') + (dead ? ' dead' : ''), delay: ci * 0.12 }));
          });
        } else {
          hole.appendChild(cardEl(null, { mini: true, cls: diff.newHand && !suppressFx ? 'new' : '', delay: 0.05 + i * 0.05, fy: -30 }));
          hole.appendChild(cardEl(null, { mini: true, cls: diff.newHand && !suppressFx ? 'new' : '', delay: 0.1 + i * 0.05, fy: -30 }));
        }
        el.appendChild(hole);
      }

      // dealer button, offset toward center
      if (p.isDealer && st.status !== 'lobby') {
        const db = document.createElement('div');
        db.className = 'dbtn';
        db.textContent = 'D';
        const dd = 36, pp = 26;
        db.style.left = '50%';
        db.style.top = '50%';
        db.style.transform = `translate(-50%,-50%) translate(${(dir.x * dd - dir.y * pp).toFixed(1)}px, ${(dir.y * dd + dir.x * pp).toFixed(1)}px)`;
        el.appendChild(db);
      }

      // bet bubble, offset toward center
      if (p.bet > 0 && st.status === 'playing') {
        const bet = document.createElement('div');
        const prevP = prevState && prevState.players.find((x) => x.id === p.id);
        const isNewBet = !prevP || prevP.bet !== p.bet;
        bet.className = 'bet' + (isNewBet && !suppressFx ? ' new' : '');
        bet.dataset.pid = p.id;
        bet.innerHTML = `${CHIP}<span>${fmt(p.bet)}</span>`;
        const bd = 100 + 24 * Math.abs(dir.x);
        bet.style.left = '50%';
        bet.style.top = '50%';
        bet.style.transform = `translate(-50%,-50%) translate(${(dir.x * bd).toFixed(1)}px, ${(dir.y * bd).toFixed(1)}px)`;
        el.appendChild(bet);
      }

      seatsEl.appendChild(el);
    });

    // turn timers
    if (ringTimer) clearInterval(ringTimer);
    ringTimer = null;
    if (st.hand && st.hand.turnDeadline && st.status === 'playing') {
      const deadline = st.hand.turnDeadline;
      const total = 60000;
      ringTimer = setInterval(() => {
        const left = Math.max(0, deadline - Date.now());
        const pct = (left / total) * 100;
        document.querySelectorAll('.seat .timerbar i').forEach((i) => (i.style.width = pct + '%'));
        const mine = $('meTimerFill');
        if (mine) mine.style.width = pct + '%';
        if (left <= 0 && ringTimer) { clearInterval(ringTimer); ringTimer = null; }
      }, 200);
    }
  }

  function renderMe(st, diff) {
    const me = st.players.find((p) => p.id === myId);
    if (!me) return;
    const mc = $('myCards');
    mc.innerHTML = '';
    if (me.cards) {
      me.cards.forEach((c, i) => {
        const win = diff.winnerIds.has(myId);
        mc.appendChild(cardEl(c, {
          cls: (diff.newHand && !suppressFx ? 'new' : '') + (win && st.status === 'between' ? ' win' : ''),
          delay: 0.06 + i * 0.09,
          fy: -140,
        }));
      });
    }
    $('meInfo').classList.remove('hidden');
    $('meName').textContent = me.name;
    $('meStack').textContent = fmt(me.stack);
    // my turn timer track
    const showMine = st.actions && st.actions.yourTurn && st.hand && st.hand.turnDeadline && st.status === 'playing';
    $('meTimer').classList.toggle('hidden', !showMine);
  }

  function renderActions(st, diff) {
    const a = st.actions;
    const bar = $('actionBar');
    if (!a || !a.yourTurn) { bar.classList.add('hidden'); hide('raiseSheet'); return; }
    bar.classList.remove('hidden');
    if (diff.myTurnNow && !suppressFx) {
      bar.classList.remove('enter');
      void bar.offsetWidth;
      bar.classList.add('enter');
    }
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
    call.onclick = () => { sendMsg({ t: 'action', kind: a.owe > 0 ? 'call' : 'check' }); hide('raiseSheet'); bar.classList.remove('hidden'); };
    fold.onclick = () => { sendMsg({ t: 'action', kind: 'fold' }); hide('raiseSheet'); };
    raise.onclick = () => {
      if (!a.canRaise && !a.canBet) { sendMsg({ t: 'action', kind: 'allin' }); return; }
      openRaiseSheet(st, a);
    };
  }

  function openRaiseSheet(st, a) {
    const sheet = $('raiseSheet');
    sheet.classList.remove('hidden');
    $('actionBar').classList.add('hidden');
    $('raiseCap').textContent = a.canBet ? 'Bet' : 'Raise to';
    const range = $('raiseRange');
    const min = a.canBet ? a.minBet : a.minRaiseTo;
    const max = a.canBet ? a.maxBet : a.maxRaiseTo;
    range.min = min; range.max = max; range.value = min;
    range.step = st.config.sb;
    $('raiseMin').textContent = fmt(min);
    $('raiseMax').textContent = fmt(max);
    const val = $('raiseVal');
    const confirm = $('raiseConfirm');
    const upd = () => {
      const v = Number(range.value);
      val.textContent = fmt(v);
      confirm.textContent = v >= max ? `All in · ${fmt(v)}` : `${a.canBet ? 'Bet' : 'Raise to'} ${fmt(v)}`;
    };
    range.oninput = upd; upd();
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
      };
    });
    confirm.onclick = () => {
      const v = Number(range.value);
      if (v >= max) sendMsg({ t: 'action', kind: 'allin' });
      else sendMsg({ t: 'action', kind: a.canBet ? 'bet' : 'raise', amount: v });
      hide('raiseSheet');
    };
    $('raiseClose').onclick = () => { hide('raiseSheet'); $('actionBar').classList.remove('hidden'); };
  }

  function renderLobby(st) {
    if (st.status !== 'lobby') return;
    const ul = $('lobbyPlayers');
    ul.innerHTML = '';
    st.players.forEach((p, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--d', (i * 0.04) + 's');
      li.className = 'rise';
      li.innerHTML = `
        <span class="dot${p.connected ? '' : ' off'}"></span>
        <span class="who">${escapeHtml(p.name)}</span>
        ${p.isHost ? '<span class="badge">host</span>' : ''}
        ${p.isBot ? '<span class="badge">bot</span>' : ''}
        ${st.hostId === myId && p.id !== myId ? '<button class="kick" title="Remove" aria-label="Remove">&times;</button>' : ''}
      `;
      const kickBtn = li.querySelector('.kick');
      if (kickBtn) kickBtn.onclick = () => sendMsg({ t: 'kick', playerId: p.id });
      ul.appendChild(li);
    });
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

  function renderBetween(st, diff) {
    const bar = $('betweenBar');
    if (st.status !== 'between' || !st.hand || !st.hand.result) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const r = st.hand.result;
    let html = '';
    if (r.type === 'uncontested') {
      const w = r.winners[0];
      html = `<span class="win-amt">${escapeHtml(w.name)}</span> takes the pot of <span class="win-amt" data-amt="${w.amount}">${fmt(w.amount)}</span>`;
    } else {
      const sig = (pot) => pot.winners.map((w) => w.id + w.hand).sort().join('|');
      const allSame = r.pots.every((pot) => sig(pot) === sig(r.pots[0]));
      if (allSame) {
        const merged = {};
        for (const pot of r.pots) for (const w of pot.winners) {
          const k = w.id + '|' + w.hand;
          merged[k] = merged[k] || { name: w.name, hand: w.hand, amount: 0, split: pot.winners.length > 1 };
          merged[k].amount += w.amount;
        }
        html = Object.values(merged).map((w) =>
          `<span class="win-amt">${escapeHtml(w.name)}</span> wins <span class="win-amt" data-amt="${w.amount}">${fmt(w.amount)}</span><span class="win-hand">${escapeHtml(w.hand)}${w.split ? ' · split pot' : ''}</span>`
        ).join('');
      } else {
        html = r.pots.map((pot, i) =>
          (r.pots.length > 1 ? `<span class="win-hand">${i === 0 ? 'Main pot' : 'Side pot'}</span>` : '') +
          pot.winners.map((w) =>
            `<span class="win-amt">${escapeHtml(w.name)}</span> wins <span class="win-amt" data-amt="${w.amount}">${fmt(w.amount)}</span><span class="win-hand">${escapeHtml(w.hand)}${pot.winners.length > 1 ? ' · split pot' : ''}</span>`
          ).join('')
        ).join('');
      }
    }
    const isHost = st.hostId === myId;
    const me = st.players.find((p) => p.id === myId);
    const canRebuy = me && me.stack < st.config.stack;
    if (!isHost && !canRebuy) html += '<span class="win-hand">Waiting for the host&hellip;</span>';
    $('resultText').innerHTML = html;
    $('nextHandBtn').classList.toggle('hidden', !isHost);
    $('rebuyBtn').classList.toggle('hidden', !canRebuy);
    if (diff.handEnded && !suppressFx) {
      document.querySelectorAll('#resultText [data-amt]').forEach((el) => countUp(el, Number(el.dataset.amt)));
    }
  }

  function countUp(el, target) {
    const t0 = performance.now();
    const dur = 550;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(target * e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- fx layer ----------
  function runFx(diff, oldBets, oldPotRect, st) {
    if (suppressFx) return;
    const fx = $('fx');
    // chips swept to pot
    if (diff.sweptPids.length && st.hand) {
      const potRect = $('potPill').getBoundingClientRect();
      const feltRect = $('felt').getBoundingClientRect();
      for (const pid of diff.sweptPids) {
        const r = oldBets[pid];
        if (!r) continue;
        flyChip(fx, r, potRect, feltRect, 380);
      }
      pop($('potPill'));
    }
    // pot collected by winner(s)
    if (diff.handEnded && diff.winnerIds.size && oldPotRect) {
      const feltRect = $('felt').getBoundingClientRect();
      let target = null;
      const seats = document.querySelectorAll('.seat.winner .pill');
      if (seats.length) target = seats[0].getBoundingClientRect();
      else if (diff.winnerIds.has(st.you)) target = $('meInfo').getBoundingClientRect();
      if (target) flyChip(fx, oldPotRect, target, feltRect, 460);
    }
  }

  function flyChip(fxLayer, fromRect, toRect, feltRect, dur) {
    const el = document.createElement('div');
    el.className = 'fx-chip';
    el.innerHTML = CHIP;
    const x0 = fromRect.left + fromRect.width / 2 - feltRect.left;
    const y0 = fromRect.top + fromRect.height / 2 - feltRect.top;
    const x1 = toRect.left + toRect.width / 2 - feltRect.left;
    const y1 = toRect.top + toRect.height / 2 - feltRect.top;
    el.style.left = x0 + 'px';
    el.style.top = y0 + 'px';
    el.style.transform = 'translate(-50%,-50%)';
    fxLayer.appendChild(el);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${(x1 - x0).toFixed(1)}px), calc(-50% + ${(y1 - y0).toFixed(1)}px)) scale(0.55)`, opacity: 0.9 },
    ], { duration: dur, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)', fill: 'forwards' }).onfinish = () => el.remove();
  }

  function pop(el) {
    el.animate([
      { transform: 'scale(1)' },
      { transform: 'scale(1.14)' },
      { transform: 'scale(1)' },
    ], { duration: 260, easing: 'ease-out' });
  }

  // ---------- share ----------
  async function shareRoom() {
    const url = `${location.origin}/?room=${roomCode}`;
    const data = {
      title: `Pocket Poker · Table ${roomCode}`,
      text: `You’re invited to my Pocket Poker table ${roomCode}. Take your seat.`,
      url,
    };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      throw 0;
    } catch {
      try { await navigator.clipboard.writeText(url); feedPush('Invite link copied'); }
      catch { feedPush(`Code: ${roomCode}`); }
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
    } catch { feedPush('Could not create table', true); }
    $('createBtn').disabled = false;
  };
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('createBtn').click(); });
  $('joinForm').onsubmit = (e) => {
    e.preventDefault();
    const name = $('nameInput').value.trim() || 'Player';
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) return feedPush('Enter the 4-letter code', true);
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
      show('table'); hide('home'); show('connOverlay');
      connect(urlRoom, savedName);
    } else {
      $('codeInput').value = urlRoom;
      $('nameInput').focus();
    }
  }
})();
