// Avatar spec validation - server side. Counts MUST stay in sync with
// public/avatar.js COUNTS (enforced by test/avatar.test.mjs).
// s = style (0 male, 1 female). Specs saved before the style pick carry no
// s; they canonicalize to s:0 (male) so old saved avatars keep working.
export const AVATAR_COUNTS = { s: 2, t: 5, f: 4, e: 8, b: 6, m: 8, h: 8, g: 5 };

// Returns a canonical avatar spec, or null when malformed.
export function sanitizeAvatar(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const out = {};
  for (const k of Object.keys(AVATAR_COUNTS)) {
    let v = a[k];
    if (v === undefined && k === 's') v = 0; // legacy spec without style
    if (!Number.isInteger(v) || v < 0 || v >= AVATAR_COUNTS[k]) return null;
    out[k] = v;
  }
  return out;
}
