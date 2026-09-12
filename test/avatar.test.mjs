import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, join, setAvatar, publicState, GameError } from '../src/engine.js';
import { AVATAR_COUNTS, sanitizeAvatar } from '../src/avatar.js';

const GOOD = { s: 1, t: 2, f: 1, e: 3, b: 4, m: 5, h: 2, g: 1 };
const LEGACY = { t: 2, f: 1, e: 3, b: 4, m: 5, h: 2, g: 1 }; // pre-style spec

const clientSrc = readFileSync(new URL('../public/avatar.js', import.meta.url), 'utf8');
const client = (await import(
  'data:text/javascript,' + encodeURIComponent(clientSrc + '\nexport default globalThis.PocketAvatar;')
)).default;

test('server/client component counts stay in sync', () => {
  assert.deepEqual(client.COUNTS, AVATAR_COUNTS);
});

test('sanitizeAvatar accepts canonical specs, rejects malformed ones', () => {
  assert.deepEqual(sanitizeAvatar(GOOD), GOOD);
  assert.deepEqual(sanitizeAvatar(LEGACY), { s: 0, ...LEGACY }); // style defaults to male
  assert.equal(sanitizeAvatar({ ...GOOD, s: 2 }), null); // style out of range
  assert.equal(sanitizeAvatar(null), null);
  assert.equal(sanitizeAvatar('face'), null);
  assert.equal(sanitizeAvatar([1, 2, 3]), null);
  assert.equal(sanitizeAvatar({ ...GOOD, t: 5 }), null); // out of range
  assert.equal(sanitizeAvatar({ ...GOOD, t: -1 }), null);
  assert.equal(sanitizeAvatar({ ...GOOD, e: 2.5 }), null); // non-integer
  assert.equal(sanitizeAvatar({ ...GOOD, g: '1' }), null); // wrong type
  const partial = { ...GOOD };
  delete partial.h;
  assert.equal(sanitizeAvatar(partial), null); // missing key
});

test('join stores a valid avatar and publicState exposes it', () => {
  const g = createGame('TEST');
  const { player } = join(g, { name: 'Aria', avatar: GOOD });
  assert.deepEqual(player.avatar, GOOD);
  const ps = publicState(g, player.id);
  assert.deepEqual(ps.players.find((p) => p.id === player.id).avatar, GOOD);
});

test('join rejects an invalid avatar', () => {
  const g = createGame('TEST');
  assert.throws(() => join(g, { name: 'Aria', avatar: { ...GOOD, t: 99 } }), GameError);
  assert.equal(g.players.length, 0);
});

test('rejoin preserves avatar unless a new one is sent', () => {
  const g = createGame('TEST');
  const { player, token } = join(g, { name: 'Aria', avatar: GOOD });
  const next = { ...GOOD, h: 5 };
  const r1 = join(g, { name: 'Aria', token });
  assert.equal(r1.rejoined, true);
  assert.deepEqual(r1.player.avatar, GOOD); // no avatar sent: kept
  const r2 = join(g, { name: 'Aria', token, avatar: next });
  assert.deepEqual(r2.player.avatar, next); // new avatar sent: updated
});

test('setAvatar validates and updates', () => {
  const g = createGame('TEST');
  const { player } = join(g, { name: 'Aria' });
  assert.equal(player.avatar, null);
  setAvatar(g, player.id, GOOD);
  assert.deepEqual(publicState(g, player.id).players[0].avatar, GOOD);
  assert.throws(() => setAvatar(g, player.id, { ...GOOD, m: -1 }), GameError);
  assert.throws(() => setAvatar(g, 'nobody', GOOD), GameError);
});

test('client default avatars are deterministic, valid, and distinct', () => {
  const a1 = client.defaultAvatar('Gus');
  assert.deepEqual(client.defaultAvatar('Gus'), a1);
  assert.ok(client.isValid(a1));
  const names = ['Gus', 'Mabel', 'Ruby', 'Knuckles', 'Vera', 'Otis', 'Tarek', 'Sam'];
  const sigs = new Set(names.map((n) => JSON.stringify(client.defaultAvatar(n))));
  assert.ok(sigs.size >= names.length - 1, 'defaults should almost always differ');
});

test('client renders every component variant in both styles', () => {
  for (const style of [0, 1]) {
    for (const k of Object.keys(client.COUNTS)) {
      for (let v = 0; v < client.COUNTS[k]; v++) {
        const a = { s: style, t: 0, f: 0, e: 0, b: 0, m: 0, h: 0, g: 0, [k]: v };
        const s = client.svg(a);
        assert.ok(s.startsWith('<svg') && s.endsWith('</svg>'), `${k}=${v}`);
        assert.ok(s.includes('av-eyes'), `${k}=${v} carries the blink group`);
      }
    }
  }
});
