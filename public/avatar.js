// Pocket Poker avatar renderer - deterministic monochrome cartoon heads.
// Pure shapes, no text, no external assets. UMD: attaches PocketAvatar.
(function (root) {
  'use strict';

  // Component counts. MUST stay in sync with src/avatar.js AVATAR_COUNTS
  // (enforced by test/avatar.test.mjs). s = style (0 male, 1 female);
  // hair indexes into a per-style set.
  const COUNTS = { s: 2, t: 5, f: 4, e: 8, b: 6, m: 8, h: 8, g: 5 };
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

  // Specs saved before the style pick existed carry no s; they read as male.
  function norm(a) {
    if (!a || typeof a !== 'object') return a;
    if (a.s === undefined) return { ...a, s: 0 };
    return a;
  }

  function isValid(a) {
    a = norm(a);
    if (!a || typeof a !== 'object') return false;
    for (const k of Object.keys(COUNTS)) {
      if (!Number.isInteger(a[k]) || a[k] < 0 || a[k] >= COUNTS[k]) return false;
    }
    return true;
  }

  // Deterministic per-face phase so a table full of avatars never bobs or
  // blinks in lockstep.
  function phase(a) {
    return ((a.s * 23 + a.t * 7 + a.f * 5 + a.e * 3 + a.b * 11 + a.m * 13 + a.h * 17 + a.g * 19) % 48) / 10;
  }

  // ---- shapes (64x64 viewBox, head centered ~32,36) ----
  // Cartoon sticker look: bold ink outline around the face, soft blush,
  // a button nose, big expressive features, lashes on the female style.
  function faceSvg(f, fill, ik) {
    const s = ` stroke="${ik}" stroke-width="2.2" stroke-linejoin="round"`;
    switch (f) {
      case 1: return `<ellipse cx="32" cy="36" rx="19" ry="23" fill="${fill}"${s}/>`;
      case 2: return `<ellipse cx="32" cy="37" rx="23" ry="19.5" fill="${fill}"${s}/>`;
      case 3: return `<rect x="11" y="15" width="42" height="43" rx="16" fill="${fill}"${s}/>`;
      default: return `<circle cx="32" cy="36" r="21.5" fill="${fill}"${s}/>`;
    }
  }

  function blushSvg(ik) {
    return `<ellipse cx="20" cy="44.5" rx="3.2" ry="2" fill="${ik}" opacity="0.14"/>` +
           `<ellipse cx="44" cy="44.5" rx="3.2" ry="2" fill="${ik}" opacity="0.14"/>`;
  }

  function noseSvg(ik) {
    return `<path d="M30.4 41 Q32 42.9 33.6 41" stroke="${ik}" stroke-width="1.7" fill="none" stroke-linecap="round"/>`;
  }

  // Open-eye variants get lashes on the female style.
  function lashesSvg(e, ik) {
    const L = [];
    const left = e !== 5, right = true; // wink: open eye only
    if (left) L.push(`<path d="M20.6 33.4 L18.7 31.7 M22.4 32.4 L21.5 30.2" stroke="${ik}" stroke-width="1.4" stroke-linecap="round"/>`);
    if (right) L.push(`<path d="M43.4 33.4 L45.3 31.7 M41.6 32.4 L42.5 30.2" stroke="${ik}" stroke-width="1.4" stroke-linecap="round"/>`);
    return L.join('');
  }
  const LASHABLE = { 0: 1, 1: 1, 4: 1, 5: 1, 7: 1 };

  function eyesSvg(e, ik, toneFill, fem) {
    const lashes = fem && LASHABLE[e] ? lashesSvg(e, ik) : '';
    switch (e) {
      case 1: // big shiny
        return lashes +
               `<circle cx="24" cy="37" r="4.2" fill="${ik}"/><circle cx="40" cy="37" r="4.2" fill="${ik}"/>` +
               `<circle cx="22.7" cy="35.4" r="1.5" fill="${toneFill}"/><circle cx="38.7" cy="35.4" r="1.5" fill="${toneFill}"/>` +
               `<circle cx="25.6" cy="38.8" r="0.7" fill="${toneFill}"/><circle cx="41.6" cy="38.8" r="0.7" fill="${toneFill}"/>`;
      case 2: // happy closed arcs
        return `<path d="M20.8 37.5 Q24 33.6 27.2 37.5" stroke="${ik}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
               `<path d="M36.8 37.5 Q40 33.6 43.2 37.5" stroke="${ik}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
      case 3: // relaxed lines
        return `<path d="M21 37 L27 37" stroke="${ik}" stroke-width="2.6" stroke-linecap="round"/>` +
               `<path d="M37 37 L43 37" stroke="${ik}" stroke-width="2.6" stroke-linecap="round"/>`;
      case 4: // wide
        return lashes +
               `<circle cx="24" cy="37" r="5" fill="${ik}"/><circle cx="40" cy="37" r="5" fill="${ik}"/>` +
               `<circle cx="22.5" cy="35.2" r="1.7" fill="${toneFill}"/><circle cx="38.5" cy="35.2" r="1.7" fill="${toneFill}"/>`;
      case 5: // wink
        return lashes +
               `<circle cx="24" cy="37" r="3" fill="${ik}"/>` +
               `<circle cx="23.1" cy="35.9" r="1" fill="${toneFill}"/>` +
               `<path d="M36.8 37.5 Q40 33.6 43.2 37.5" stroke="${ik}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
      case 6: // sleepy content (soft u arcs)
        return `<path d="M20.8 35.6 Q24 39.2 27.2 35.6" stroke="${ik}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
               `<path d="M36.8 35.6 Q40 39.2 43.2 35.6" stroke="${ik}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
      case 7: { // starry sparkles
        const star = (cx, cy) =>
          `<path d="M${cx} ${cy - 4.4} L${cx + 1.3} ${cy - 1.3} L${cx + 4.4} ${cy} L${cx + 1.3} ${cy + 1.3} L${cx} ${cy + 4.4} L${cx - 1.3} ${cy + 1.3} L${cx - 4.4} ${cy} L${cx - 1.3} ${cy - 1.3} Z" fill="${ik}"/>`;
        return lashes + star(24, 37) + star(40, 37) +
               `<circle cx="24.9" cy="35.9" r="0.8" fill="${toneFill}"/><circle cx="40.9" cy="35.9" r="0.8" fill="${toneFill}"/>`;
      }
      default: // dots
        return lashes +
               `<circle cx="24" cy="37" r="2.9" fill="${ik}"/><circle cx="40" cy="37" r="2.9" fill="${ik}"/>`;
    }
  }

  function browsSvg(b, ik) {
    switch (b) {
      case 1: return `<path d="M20.5 28.6 L27 28.6" stroke="${ik}" stroke-width="2.1" stroke-linecap="round"/>` +
                     `<path d="M37 28.6 L43.5 28.6" stroke="${ik}" stroke-width="2.1" stroke-linecap="round"/>`;
      case 2: return `<path d="M20.5 29.6 Q23.8 26.6 27 28.6" stroke="${ik}" stroke-width="2.1" fill="none" stroke-linecap="round"/>` +
                     `<path d="M37 28.6 Q40.2 26.6 43.5 29.6" stroke="${ik}" stroke-width="2.1" fill="none" stroke-linecap="round"/>`;
      case 3: return `<path d="M20.5 27 L27 29.8" stroke="${ik}" stroke-width="2.1" stroke-linecap="round"/>` +
                     `<path d="M37 29.8 L43.5 27" stroke="${ik}" stroke-width="2.1" stroke-linecap="round"/>`;
      case 4: return `<path d="M20.5 28.6 L27 28.6" stroke="${ik}" stroke-width="3.4" stroke-linecap="round"/>` +
                     `<path d="M37 28.6 L43.5 28.6" stroke="${ik}" stroke-width="3.4" stroke-linecap="round"/>`;
      case 5: return `<path d="M20.5 27.2 Q23.8 29.9 27 29" stroke="${ik}" stroke-width="2.1" fill="none" stroke-linecap="round"/>` +
                     `<path d="M37 29 Q40.2 29.9 43.5 27.2" stroke="${ik}" stroke-width="2.1" fill="none" stroke-linecap="round"/>`;
      default: return '';
    }
  }

  function mouthSvg(m, ik, toneFill) {
    switch (m) {
      case 1: // grin, open with teeth
        return `<path d="M25 45.5 Q32 54.5 39 45.5 Q32 49 25 45.5 Z" fill="${ik}"/>` +
               `<path d="M27.2 46.4 Q32 48.4 36.8 46.4 L36.2 47.8 Q32 49.5 27.8 47.8 Z" fill="${toneFill}"/>`;
      case 2: return `<path d="M28.5 46.5 Q32 49.4 35.5 46.5" stroke="${ik}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
      case 3: return `<path d="M28 47 L36 47" stroke="${ik}" stroke-width="2.4" stroke-linecap="round"/>`;
      case 4: return `<ellipse cx="32" cy="47.6" rx="2.9" ry="3.4" fill="${ik}"/>`;
      case 5: return `<path d="M28 47.5 Q33 50 37.5 45.8" stroke="${ik}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
      case 6: // tongue out
        return `<path d="M26.5 45.8 Q32 51 37.5 45.8" stroke="${ik}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` +
               `<path d="M29.6 47.6 Q32 53.4 34.4 47.6 Q32 49.2 29.6 47.6 Z" fill="${toneFill}" stroke="${ik}" stroke-width="1.4" stroke-linejoin="round"/>`;
      case 7: // big open laugh with tongue
        return `<path d="M25.5 45.2 Q32 56.5 38.5 45.2 Q32 48.6 25.5 45.2 Z" fill="${ik}"/>` +
               `<path d="M28.4 49.4 Q32 52.8 35.6 49.4 Q32 51 28.4 49.4 Z" fill="${toneFill}"/>`;
      default: return `<path d="M26 46 Q32 50.6 38 46" stroke="${ik}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    }
  }

  // Male hair set.
  function hairSvgM(h, color) {
    switch (h) {
      case 1: // crop
        return `<path d="M12.5 34 C12.5 17.5 20 12 32 12 C44 12 51.5 17.5 51.5 34 C48.5 24 42 20.5 32 20.5 C22 20.5 15.5 24 12.5 34 Z" fill="${color}"/>`;
      case 2: // side part sweep
        return `<path d="M12.5 34 C12.5 17.5 20 12 32 12 C44 12 51.5 17.5 51.5 34 C49.5 24.5 44 20.5 36 20 L20 24.5 C15.8 26.5 13.5 29.5 12.5 34 Z" fill="${color}"/>`;
      case 3: // zigzag fringe
        return `<path d="M11.5 33 C11.5 15.5 21 11 32 11 C43 11 52.5 15.5 52.5 33 L48.4 26.2 L44.3 29.4 L40.2 25.8 L36.1 29 L32 25.4 L27.9 29 L23.8 25.8 L19.7 29.4 L15.6 26.2 Z" fill="${color}"/>`;
      case 4: { // curly bumps over a base cap
        const base = `<path d="M13.5 33 C13.5 16.5 22 12 32 12 C42 12 50.5 16.5 50.5 33 C47.5 25 42 21.5 32 21.5 C22 21.5 16.5 25 13.5 33 Z" fill="${color}"/>`;
        const bumps = [[14,26],[17.8,19],[24.4,13.8],[32,12],[39.6,13.8],[46.2,19],[50,26]]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.4" fill="${color}"/>`).join('');
        return base + bumps;
      }
      case 5: // spiky crown
        return `<path d="M12.5 33 L14.6 20.5 L19.8 26.2 L22.8 13.5 L28.8 23.2 L32.9 11 L37.9 22.8 L44 13 L46 24.2 L51.5 19.5 L51.5 33 C47.5 24 42 20.5 32 20.5 C22 20.5 16.5 24 12.5 33 Z" fill="${color}"/>`;
      case 6: // shaggy mop with scalloped fringe
        return `<path d="M11 41 C9.5 17 20 10.5 32 10.5 C44 10.5 54.5 17 53 41 C52.6 34 51 29.5 48.8 26.8 C48.4 30.6 46.6 33 44.2 33.8 C43.6 28.6 41 25.4 37.4 24.4 C36.6 28.2 34.6 30.4 32 30.4 C29.4 30.4 27.4 28.2 26.6 24.4 C23 25.4 20.4 28.6 19.8 33.8 C17.4 33 15.6 30.6 15.2 26.8 C13 29.5 11.4 34 11 41 Z" fill="${color}"/>`;
      case 7: // top knot bun
        return `<circle cx="32" cy="9.5" r="5.6" fill="${color}"/>` +
               `<path d="M12.5 34 C12.5 18.5 20 13.5 32 13.5 C44 13.5 51.5 18.5 51.5 34 C48.5 24.5 42 21 32 21 C22 21 15.5 24.5 12.5 34 Z" fill="${color}"/>`;
      default: return ''; // bald
    }
  }

  // Female hair set (same indexes, longer silhouettes).
  function hairSvgF(h, color) {
    switch (h) {
      case 1: // pixie crop
        return `<path d="M12.5 36 C12.5 17.5 20 11.5 32 11.5 C44 11.5 51.5 17.5 51.5 36 C50 27 46 22.5 40 21 C36 25 27 25.5 22 22.5 C17 25 14 29 12.5 36 Z" fill="${color}"/>`;
      case 2: // long with side part
        return `<path d="M11.5 52 C10 17 20 11 32 11 C44 11 54 17 52.5 52 C51.5 40 50.5 30 47 25 C44 21.5 39 20 35 19.8 L19 24.5 C14.5 27 12.5 33 11.5 52 Z" fill="${color}"/>` +
               `<path d="M35 19.8 L20 24.2 C22.5 21 28 19.5 35 19.8 Z" fill="${color}"/>`;
      case 3: // long with zigzag fringe
        return `<path d="M11 52 C9.5 15.5 20.5 10.5 32 10.5 C43.5 10.5 54.5 15.5 53 52 C52.2 38 51 30 48.4 26.2 L44.3 29.4 L40.2 25.8 L36.1 29 L32 25.4 L27.9 29 L23.8 25.8 L19.7 29.4 L15.6 26.2 C13 30 11.8 38 11 52 Z" fill="${color}"/>`;
      case 4: { // long curly
        const base = `<path d="M12 52 C10.5 16.5 21.5 11.5 32 11.5 C42.5 11.5 53.5 16.5 52 52 C51 40 49.5 28 46.5 23 C43 20.5 37.5 21 32 21 C26.5 21 21 20.5 17.5 23 C14.5 28 13 40 12 52 Z" fill="${color}"/>`;
        const bumps = [[12.5,30],[12,42],[15.5,20],[23.5,13.5],[32,11.8],[40.5,13.5],[48.5,20],[51.5,30],[52,42]]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.2" fill="${color}"/>`).join('');
        return base + bumps;
      }
      case 5: // bob, ends at the jaw
        return `<path d="M11.5 47 C10.5 16 20.5 11 32 11 C43.5 11 53.5 16 52.5 47 C50.5 44 49 44.5 47.5 46.5 C47.8 36 46.5 27 43.5 23.5 C39.5 21 36 21.5 32 21.5 C28 21.5 24.5 21 20.5 23.5 C17.5 27 16.2 36 16.5 46.5 C15 44.5 13.5 44 11.5 47 Z" fill="${color}"/>`;
      case 6: // high ponytail off the right
        return `<path d="M40 14 C46 10 52 12 53 18 C54 24 52 30 49 33 C50 26 48 21 44 19 Z" fill="${color}"/>` +
               `<path d="M12.5 34 C12.5 17.5 20 11.5 32 11.5 C44 11.5 51.5 17.5 51.5 34 C48.5 24 42 20.5 32 20.5 C22 20.5 15.5 24 12.5 34 Z" fill="${color}"/>`;
      case 7: { // pigtails
        const cap = `<path d="M12.5 34 C12.5 17.5 20 11.5 32 11.5 C44 11.5 51.5 17.5 51.5 34 C48.5 24 42 20.5 32 20.5 C22 20.5 15.5 24 12.5 34 Z" fill="${color}"/>`;
        return cap +
               `<ellipse cx="11" cy="40" rx="5" ry="9" fill="${color}" transform="rotate(12 11 40)"/>` +
               `<ellipse cx="53" cy="40" rx="5" ry="9" fill="${color}" transform="rotate(-12 53 40)"/>`;
      }
      default: return ''; // bald
    }
  }

  function glassesSvg(g, ik) {
    switch (g) {
      case 1: // round
        return `<circle cx="24" cy="37" r="6.6" stroke="${ik}" stroke-width="2.1" fill="none"/>` +
               `<circle cx="40" cy="37" r="6.6" stroke="${ik}" stroke-width="2.1" fill="none"/>` +
               `<path d="M30.6 37 L33.4 37" stroke="${ik}" stroke-width="2.1" stroke-linecap="round"/>` +
               `<path d="M17.4 36 L12.8 34.6 M46.6 36 L51.2 34.6" stroke="${ik}" stroke-width="2.1" stroke-linecap="round"/>`;
      case 2: // square
        return `<rect x="16.8" y="30.8" width="14.4" height="12.4" rx="3.2" stroke="${ik}" stroke-width="2.1" fill="none"/>` +
               `<rect x="32.8" y="30.8" width="14.4" height="12.4" rx="3.2" stroke="${ik}" stroke-width="2.1" fill="none"/>` +
               `<path d="M31.2 36 L32.8 36" stroke="${ik}" stroke-width="2.1" stroke-linecap="round"/>`;
      case 3: // shades
        return `<rect x="16.3" y="30.8" width="15.4" height="12.4" rx="4.2" fill="#101014" stroke="${ik}" stroke-width="1.5"/>` +
               `<rect x="32.3" y="30.8" width="15.4" height="12.4" rx="4.2" fill="#101014" stroke="${ik}" stroke-width="1.5"/>` +
               `<path d="M31.7 34 L32.3 34" stroke="${ik}" stroke-width="2.1" stroke-linecap="round"/>`;
      case 4: { // heart frames
        const heart = (cx) =>
          `<path d="M${cx} 33.6 C${cx - 2.2} 30.8 ${cx - 6} 32 ${cx - 6} 35.4 C${cx - 6} 38.8 ${cx} 42.4 ${cx} 42.4 C${cx} 42.4 ${cx + 6} 38.8 ${cx + 6} 35.4 C${cx + 6} 32 ${cx + 2.2} 30.8 ${cx} 33.6 Z" stroke="${ik}" stroke-width="2" fill="none" stroke-linejoin="round"/>`;
        return heart(23.5) + heart(40.5) +
               `<path d="M29.6 35.6 L34.4 35.6" stroke="${ik}" stroke-width="2" stroke-linecap="round"/>`;
      }
      default: return '';
    }
  }

  // Full SVG markup for an avatar. opts: {bg: circle background color}
  function svg(a, opts) {
    a = norm(a);
    if (!isValid(a)) a = defaultAvatar('player');
    const fem = a.s === 1;
    const toneFill = TONES[a.t];
    const ik = ink(a.t);
    const bg = opts && opts.bg;
    const d = phase(a).toFixed(1);
    const ears = `<circle cx="12" cy="38.5" r="3.8" fill="${toneFill}"/><circle cx="52" cy="38.5" r="3.8" fill="${toneFill}"/>`;
    return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
      (bg ? `<circle cx="32" cy="32" r="32" fill="${bg}"/>` : '') +
      ears +
      faceSvg(a.f, toneFill, ik) +
      blushSvg(ik) +
      (fem ? hairSvgF(a.h, ik) : hairSvgM(a.h, ik)) +
      browsSvg(a.b, ik) +
      `<g class="av-eyes" style="animation-delay:-${d}s">` + eyesSvg(a.e, ik, toneFill, fem) + `</g>` +
      noseSvg(ik) +
      glassesSvg(a.g, ik) +
      mouthSvg(a.m, ik, toneFill) +
      `</svg>`;
  }

  root.PocketAvatar = { COUNTS, TONES, defaultAvatar, shuffleAvatar, isValid, norm, phase, svg };
})(typeof window !== 'undefined' ? window : globalThis);
