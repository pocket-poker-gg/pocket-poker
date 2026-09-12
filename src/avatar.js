// Avatar spec validation - server side. Counts MUST stay in sync with
// public/avatar.js COUNTS (enforced by test/avatar.test.mjs).
export const AVATAR_COUNTS = { t: 5, f: 4, e: 6, b: 5, m: 6, h: 6, g: 4 };

// Returns a canonical avatar spec, or null when malformed.
export function sanitizeAvatar(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const out = {};
  for (const k of Object.keys(AVATAR_COUNTS)) {
    const v = a[k];
    if (!Number.isInteger(v) || v < 0 || v >= AVATAR_COUNTS[k]) return null;
    out[k] = v;
  }
  return out;
}
