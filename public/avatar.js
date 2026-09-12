// Pocket Poker avatar renderer - deterministic monochrome SVG heads.
// Pure shapes, no text, no external assets. UMD: attaches PocketAvatar.
(function (root) {
  'use strict';

  // Component counts. MUST stay in sync with src/avatar.js AVATAR_COUNTS
  // (enforced by test/avatar.test.mjs).
  const COUNTS = { t: 5, f: 4, e: 6, b: 5, m: 6, h: 6, g: 4 };
  const TONES = ['#f0f0f3', '#d4d4db', '#acacb6', '#7d7d89', '#565662'];

  function ink(tone) { return tone <= 2 ? '#17171c' : '#f4f4f6'; }

  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // Deterministic default avatar from a name, so every player has a face
  // even before they ever open the maker.
  function defaultAvatar(name) {
    let h = fnv1a(String(name || 'player'));
    const pick = (n) => { const v = h % n; h = (h / n) | 0; return v; };
    const a = {};
    for (const k of Object.keys(COUNTS)) a[k] = pick(COUNTS[k]);
    return a;
  }

  function shuffleAvatar(rand) {
    const r = rand || Math.random;
    const a = {};
    for (const k of Object.keys(COUNTS)) a[k] = Math.floor(r() * COUNTS[k]);
    return a;
  }

  function isValid(a) {
    if (!a || typeof a !== 'object') return false;
    for (const k of Object.keys(COUNTS)) {
      if (!Number.isInteger(a[k]) || a[k] < 0 || a[k] >= COUNTS[k]) return false;
    }
    return true;
  }

  // ---- shapes (64x64 viewBox) ----
  function faceSvg(f, fill) {
    switch (f) {
      case 1: return `<ellipse cx="32" cy="36" rx="18.5" ry="22" fill="${fill}"/>`;
      case 2: return `<ellipse cx="32" cy="37" rx="22" ry="19" fill="${fill}"/>`;
      case 3: return `<rect x="13" y="16" width="38" height="41" rx="15" fill="${fill}"/>`;
      default: return `<circle cx="32" cy="36" r="20" fill="${fill}"/>`;
    }
  }

  function eyesSvg(e, ik, toneFill) {
    switch (e) {
      case 1: // round with highlight
        return `<circle cx="24" cy="37" r="3.4" fill="${ik}"/><circle cx="40" cy="37" r="3.4" fill="${ik}"/>` +
               `<circle cx="23" cy="36" r="1.1" fill="${toneFill}"/><circle cx="39" cy="36" r="1.1" fill="${toneFill}"/>`;
      case 2: // happy closed arcs
        return `<path d="M21 37.5 Q24 33.8 27 37.5" stroke="${ik}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` +
               `<path d="M37 37.5 Q40 33.8 43 37.5" stroke="${ik}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
      case 3: // relaxed lines
        return `<path d="M21 37 L27 37" stroke="${ik}" stroke-width="2.4" stroke-linecap="round"/>` +
               `<path d="M37 37 L43 37" stroke="${ik}" stroke-width="2.4" stroke-linecap="round"/>`;
      case 4: // wide
        return `<circle cx="24" cy="37" r="4" fill="${ik}"/><circle cx="40" cy="37" r="4" fill="${ik}"/>` +
               `<circle cx="22.8" cy="35.6" r="1.4" fill="${toneFill}"/><circle cx="38.8" cy="35.6" r="1.4" fill="${toneFill}"/>`;
      case 5: // wink
        return `<circle cx="24" cy="37" r="2.7" fill="${ik}"/>` +
               `<path d="M37 37.5 Q40 33.8 43 37.5" stroke="${ik}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
      default: // dots
        return `<circle cx="24" cy="37" r="2.6" fill="${ik}"/><circle cx="40" cy="37" r="2.6" fill="${ik}"/>`;
    }
  }

  function browsSvg(b, ik) {
    switch (b) {
      case 1: return `<path d="M20.5 29 L27 29" stroke="${ik}" stroke-width="2" stroke-linecap="round"/>` +
                     `<path d="M37 29 L43.5 29" stroke="${ik}" stroke-width="2" stroke-linecap="round"/>`;
      case 2: return `<path d="M20.5 30 Q23.8 27 27 29" stroke="${ik}" stroke-width="2" fill="none" stroke-linecap="round"/>` +
                     `<path d="M37 29 Q40.2 27 43.5 30" stroke="${ik}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
      case 3: return `<path d="M20.5 27.5 L27 30" stroke="${ik}" stroke-width="2" stroke-linecap="round"/>` +
                     `<path d="M37 30 L43.5 27.5" stroke="${ik}" stroke-width="2" stroke-linecap="round"/>`;
      case 4: return `<path d="M20.5 29 L27 29" stroke="${ik}" stroke-width="3.2" stroke-linecap="round"/>` +
                     `<path d="M37 29 L43.5 29" stroke="${ik}" stroke-width="3.2" stroke-linecap="round"/>`;
      default: return '';
    }
  }

  function mouthSvg(m, ik, toneFill) {
    switch (m) {
      case 1: // grin, open with teeth
        return `<path d="M25.5 45.5 Q32 54 38.5 45.5 Q32 48.5 25.5 45.5 Z" fill="${ik}"/>` +
               `<path d="M27.4 46.3 Q32 48.2 36.6 46.3 L36 47.6 Q32 49.2 28 47.6 Z" fill="${toneFill}"/>`;
      case 2: return `<path d="M28.5 46.5 Q32 49.2 35.5 46.5" stroke="${ik}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
      case 3: return `<path d="M28 47 L36 47" stroke="${ik}" stroke-width="2.2" stroke-linecap="round"/>`;
      case 4: return `<ellipse cx="32" cy="47.5" rx="2.8" ry="3.2" fill="${ik}"/>`;
      case 5: return `<path d="M28 47.5 Q33 49.8 37.5 45.8" stroke="${ik}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
      default: return `<path d="M26 46 Q32 50.5 38 46" stroke="${ik}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
    }
  }

  function hairSvg(h, color) {
    switch (h) {
      case 1: // crop
        return `<path d="M13 34 C13 18 20 12.5 32 12.5 C44 12.5 51 18 51 34 C48 24 42 21 32 21 C22 21 16 24 13 34 Z" fill="${color}"/>`;
      case 2: // side part sweep
        return `<path d="M13 34 C13 18 20 12.5 32 12.5 C44 12.5 51 18 51 34 C49 25 44 21 36 20.5 L20 25 C16 27 14 30 13 34 Z" fill="${color}"/>`;
      case 3: // zigzag fringe
        return `<path d="M12 33 C12 16 21 11.5 32 11.5 C43 11.5 52 16 52 33 L48 26.5 L44 29.5 L40 26 L36 29 L32 25.5 L28 29 L24 26 L20 29.5 L16 26.5 Z" fill="${color}"/>`;
      case 4: { // curly bumps over a base cap
        const base = `<path d="M14 33 C14 17 22 12.5 32 12.5 C42 12.5 50 17 50 33 C47 25 42 22 32 22 C22 22 17 25 14 33 Z" fill="${color}"/>`;
        const bumps = [[14.5,26],[18,19.5],[24.5,14.5],[32,12.8],[39.5,14.5],[46,19.5],[49.5,26]]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.2" fill="${color}"/>`).join('');
        return base + bumps;
      }
      case 5: // spiky crown
        return `<path d="M13 33 L15 21 L20 26.5 L23 14 L29 23.5 L33 11.5 L38 23 L44 13.5 L46 24.5 L51 20 L51 33 C47 24 42 21 32 21 C22 21 17 24 13 33 Z" fill="${color}"/>`;
      default: return ''; // bald
    }
  }

  function glassesSvg(g, ik) {
    switch (g) {
      case 1: // round
        return `<circle cx="24" cy="37" r="6.5" stroke="${ik}" stroke-width="2" fill="none"/>` +
               `<circle cx="40" cy="37" r="6.5" stroke="${ik}" stroke-width="2" fill="none"/>` +
               `<path d="M30.5 37 L33.5 37" stroke="${ik}" stroke-width="2" stroke-linecap="round"/>` +
               `<path d="M17.5 36 L13 34.5 M46.5 36 L51 34.5" stroke="${ik}" stroke-width="2" stroke-linecap="round"/>`;
      case 2: // square
        return `<rect x="17" y="31" width="14" height="12" rx="3" stroke="${ik}" stroke-width="2" fill="none"/>` +
               `<rect x="33" y="31" width="14" height="12" rx="3" stroke="${ik}" stroke-width="2" fill="none"/>` +
               `<path d="M31 36 L33 36" stroke="${ik}" stroke-width="2" stroke-linecap="round"/>`;
      case 3: // shades
        return `<rect x="16.5" y="31" width="15" height="12" rx="4" fill="#101014" stroke="${ik}" stroke-width="1.4"/>` +
               `<rect x="32.5" y="31" width="15" height="12" rx="4" fill="#101014" stroke="${ik}" stroke-width="1.4"/>` +
               `<path d="M31.5 34 L32.5 34" stroke="${ik}" stroke-width="2" stroke-linecap="round"/>`;
      default: return '';
    }
  }

  // Full SVG markup for an avatar. opts: {bg: circle background color}
  function svg(a, opts) {
    if (!isValid(a)) a = defaultAvatar('player');
    const toneFill = TONES[a.t];
    const ik = ink(a.t);
    const bg = opts && opts.bg;
    const ears = `<circle cx="12.5" cy="38" r="3.6" fill="${toneFill}"/><circle cx="51.5" cy="38" r="3.6" fill="${toneFill}"/>`;
    return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
      (bg ? `<circle cx="32" cy="32" r="32" fill="${bg}"/>` : '') +
      ears +
      faceSvg(a.f, toneFill) +
      hairSvg(a.h, ik) +
      browsSvg(a.b, ik) +
      eyesSvg(a.e, ik, toneFill) +
      glassesSvg(a.g, ik) +
      mouthSvg(a.m, ik, toneFill) +
      `</svg>`;
  }

  root.PocketAvatar = { COUNTS, TONES, defaultAvatar, shuffleAvatar, isValid, svg };
})(typeof window !== 'undefined' ? window : globalThis);
