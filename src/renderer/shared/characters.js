// The characters that hold today's water. Each draws itself for a fill from
// 0 (no water today) to 1 (goal reached), and its mood follows the fill.
// The orb isn't here: it has its own markup in the water window.
const LINE = '#e2e8f0';
const WATER = '#38bdf8';
const WATER_TOP = '#7dd3fc';
const INK = '#0b1020';
const BODY = '#141b2e';
const GREEN = '#4ade80';
const PINK = '#fb7185';
const YELLOW = '#fde047';
const ORANGE = '#fb923c';

let nextId = 0;

const lerp = (a, b, t) => a + (b - a) * t;
const moodOf = (fill) => (fill < 0.25 ? 0 : fill < 0.75 ? 1 : 2);

// Things that move with the water get a data-span, so a sip can animate them.
function rising(span, fill, inner) {
  return `<g class="char-rise" data-span="${span}" transform="translate(0 ${-span * fill})">${inner}</g>`;
}

function waterIn(shapes, { x, y, w, h, low, high }, fill) {
  const id = `char-clip-${(nextId += 1)}`;
  const surface = y + h * (1 - low);
  const ripples = 'q10 -5 20 0 t20 0 '.repeat(Math.ceil((w + 120) / 40) + 1);
  const top = `M${x - 60} ${surface} ${ripples}`;
  const waves = `<g class="char-wave"><path d="${top} V${y + h * 2} H${x - 60} Z" fill="${WATER}"/><path d="${top}" fill="none" stroke="${WATER_TOP}" stroke-width="3"/></g>`;
  const span = h * (high - low);
  return {
    surface: surface - span * fill,
    span,
    markup: `<defs><clipPath id="${id}">${shapes}</clipPath></defs><g clip-path="url(#${id})">${rising(span, fill, waves)}</g>`,
  };
}

// One outline around overlapping shapes: thick strokes first, fill on top.
function silhouette(shapes) {
  return `<g fill="${LINE}" stroke="${LINE}" stroke-width="6" stroke-linejoin="round">${shapes}</g><g fill="${BODY}">${shapes}</g>`;
}

function eye(x, y, mood, color = LINE) {
  if (mood === 0) {
    return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
  return `<circle cx="${x}" cy="${y}" r="${mood === 1 ? 3 : 3.6}" fill="${color}"/>`;
}

function mouth(x, y, mood, color = LINE) {
  const d = [`M${x - 7} ${y + 4}q7 -8 14 0`, `M${x - 5} ${y}h10`, `M${x - 8} ${y - 2}q8 10 16 0`][mood];
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/>`;
}

function label(x, y, text, color) {
  return `<text x="${x}" y="${y}" text-anchor="middle" class="char-mono" font-size="12" font-weight="700" fill="${color}">${text}</text>`;
}

const JAR = '<rect x="28" y="22" width="104" height="124" rx="16"/>';

function duck(fill, { small, level }) {
  const mood = moodOf(fill);
  const water = waterIn(JAR, { x: 28, y: 22, w: 104, h: 124, low: 0.07, high: 0.58 }, fill);
  const x = 78;
  const y = 22 + 124 * (1 - 0.07) - 4;
  const face =
    mood === 0
      ? `<path d="M${x + 13} ${y - 26}l6 6M${x + 19} ${y - 26}l-6 6" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`
      : `<circle cx="${x + 17}" cy="${y - 23}" r="${mood === 1 ? 2.6 : 3.2}" fill="${INK}"/>`;
  const hat = level >= 1
    ? `<rect x="${x + 2}" y="${y - 35}" width="26" height="4" rx="2" fill="#7c3aed"/><path d="M${x + 6} ${y - 35}q9 -14 18 0z" fill="#a78bfa"/><circle cx="${x + 15}" cy="${y - 44}" r="2.6" fill="${PINK}"/>`
    : '';
  const shades = level >= 2 && mood > 0
    ? `<rect x="${x + 11}" y="${y - 27}" width="11" height="7" rx="2" fill="${INK}"/><rect x="${x + 22}" y="${y - 27}" width="6" height="7" rx="2" fill="${INK}"/>`
    : '';
  const bird = `<g class="char-bob"><ellipse cx="${x}" cy="${y}" rx="27" ry="15" fill="${YELLOW}"/><path d="M${x - 24} ${y - 8}q-11 -3 -9 -13q8 2 16 8z" fill="${YELLOW}"/><circle cx="${x + 15}" cy="${y - 21}" r="13" fill="${YELLOW}"/><path d="M${x + 26} ${y - 23}h13q0 8-13 7z" fill="${ORANGE}"/>${face}${shades}${hat}</g>`;
  let words = '';
  if (!small && mood === 0) words = label(80, 52, 'undefined', LINE);
  if (!small && mood === 2) words = label(80, 130, '// fixed', INK);
  return `<g fill="${BODY}">${JAR}</g>${water.markup}${words}${rising(water.span, fill, bird)}<rect x="28" y="22" width="104" height="124" rx="16" fill="none" stroke="${LINE}" stroke-width="3"/><rect x="22" y="14" width="116" height="11" rx="5" fill="${LINE}"/>`;
}

function coolant(fill, { level }) {
  const mood = moodOf(fill);
  const temp = Math.round(lerp(98, 38, fill));
  const pin = [PINK, LINE, '#5eead4'][mood];
  const pins = [52, 70, 90, 108]
    .map((k) => `<path d="M${k} 22v14M${k} 124v14M22 ${k}h14M124 ${k}h14" stroke="${pin}" stroke-width="5" stroke-linecap="round"/>`)
    .join('');
  const chip = '<rect x="36" y="36" width="88" height="88" rx="12"/>';
  const water = waterIn(chip, { x: 36, y: 36, w: 88, h: 88, low: 0.07, high: 0.84 }, fill);
  const face =
    mood === 2
      ? `<rect x="54" y="58" width="22" height="13" rx="4" fill="${INK}"/><rect x="84" y="58" width="22" height="13" rx="4" fill="${INK}"/><path d="M76 62h8" stroke="${INK}" stroke-width="3"/><path d="M71 82q9 8 18 0" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`
      : eye(66, 63, mood) + eye(94, 63, mood) + mouth(80, 80, mood);
  const sweat =
    mood === 0
      ? `<path class="char-drip" d="M136 20q-5 8 0 11q5 -3 0 -11z" fill="${WATER_TOP}"/><path class="char-drip char-later" d="M146 40q-5 8 0 11q5 -3 0 -11z" fill="${WATER_TOP}"/>`
      : '';
  const reading = `<text x="80" y="110" text-anchor="middle" class="char-mono" font-size="17" font-weight="700" fill="${mood === 0 ? '#fda4af' : '#fff'}">${temp}°</text>`;
  const fins = level >= 1
    ? `<rect x="44" y="17" width="72" height="7" rx="2" fill="#94a3b8"/>${[50, 62, 74, 86, 98, 110].map((k) => `<path d="M${k} 17v-13" stroke="#94a3b8" stroke-width="6" stroke-linecap="round"/>`).join('')}`
    : '';
  const blade = (turn) => `<path d="M0 0q-4 -9 0 -12q5 3 0 12z" fill="${LINE}" transform="rotate(${turn})"/>`;
  const fan = level >= 2
    ? `<g transform="translate(20 20)"><circle r="14" fill="${BODY}" stroke="${LINE}" stroke-width="2.5"/><g class="char-spin">${blade(0)}${blade(120)}${blade(240)}</g></g>`
    : '';
  return `${fins}${pins}${fan}<g fill="${BODY}">${chip}</g>${water.markup}<rect x="36" y="36" width="88" height="88" rx="12" fill="none" stroke="${LINE}" stroke-width="3"/>${face}${reading}${sweat}`;
}

function camel(fill, { level }) {
  const mood = moodOf(fill);
  const r = lerp(13, 31, fill);
  const humpY = lerp(74, 66, fill);
  // Two smaller humps with a clear dip between them, or it reads as one.
  const humps = level >= 2
    ? `<circle cx="42" cy="${humpY + 2}" r="${r * 0.68}"/><circle cx="80" cy="${humpY + 2}" r="${r * 0.68}"/>`
    : `<circle cx="62" cy="${humpY}" r="${r}"/>`;
  const shapes = `${humps}<rect x="22" y="72" width="88" height="36" rx="17"/><rect x="97" y="50" width="17" height="44" rx="8"/><rect x="97" y="32" width="48" height="27" rx="12"/><rect x="33" y="98" width="11" height="44" rx="5"/><rect x="88" y="98" width="11" height="44" rx="5"/>`;
  const water = waterIn(shapes, { x: 10, y: 34, w: 135, h: 110, low: 0.12, high: 0.8 }, fill);
  const ear = `<path d="M101 32l-4-9 9 5" fill="none" stroke="${LINE}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  const tail = `<path d="M22 84q-9 6-7 18" fill="none" stroke="${LINE}" stroke-width="3" stroke-linecap="round"/>`;
  const blanket = level >= 1
    ? `<rect x="46" y="78" width="40" height="17" rx="3" fill="${PINK}"/><path d="M46 84h40M46 89h40" stroke="${YELLOW}" stroke-width="2"/>`
    : '';
  return silhouette(shapes) + water.markup + blanket + eye(116, 42, mood) + mouth(131, 49, mood) + ear + tail;
}

function gulp(fill, { level }) {
  const mood = moodOf(fill);
  const bowl = '<circle cx="80" cy="84" r="60"/>';
  const water = waterIn(bowl, { x: 20, y: 24, w: 120, h: 120, low: 0.13, high: 0.82 }, fill);
  const tilt = mood === 0 ? -14 : mood === 1 ? 0 : -8;
  const face =
    mood === 0
      ? `<path d="M9 -8l6 6M15 -8l-6 6" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/><circle cx="24" cy="5" r="4" fill="${INK}"/>`
      : `<circle cx="12" cy="-5" r="${mood === 1 ? 3 : 3.6}" fill="${INK}"/><path d="M15 5q4 4 8 0" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
  const fishBody = `<g class="char-bob"><g transform="translate(84 120) rotate(${tilt})"><path d="M-22 0l-18 -12v24z" fill="${ORANGE}"/><ellipse rx="26" ry="16" fill="${ORANGE}"/><path d="M-4 -14q6 -10 14 -2z" fill="#f97316"/>${face}</g></g>`;
  const bubbles =
    mood > 0
      ? `<circle class="char-bubble" cx="116" cy="${water.surface + 40}" r="4" fill="none" stroke="#e0f2fe" stroke-width="2"/><circle class="char-bubble char-later" cx="106" cy="${water.surface + 40}" r="3" fill="none" stroke="#e0f2fe" stroke-width="2"/>`
      : '';
  const castle = level >= 1
    ? '<path d="M38 136v-24h5v5h5v-5h5v5h5v-5h5v24z" fill="#94a3b8"/><path d="M46 136v-8q4-4 8 0v8z" fill="#475569"/>'
    : '';
  const friend = level >= 2
    ? `<g class="char-bob"><g transform="translate(116 122) scale(-0.55 0.55)"><path d="M-22 0l-18 -12v24z" fill="#f9a8d4"/><ellipse rx="26" ry="16" fill="#f9a8d4"/><circle cx="12" cy="-5" r="4" fill="${INK}"/></g></g>`
    : '';
  return `<circle cx="80" cy="84" r="60" fill="${BODY}"/>${water.markup}${castle}${bubbles}${friend ? rising(30, fill, friend) : ''}${rising(40, fill, fishBody)}<circle cx="80" cy="84" r="60" fill="none" stroke="${LINE}" stroke-width="3"/><path d="M42 40q-10 12-13 28" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="4" stroke-linecap="round"/><rect x="44" y="18" width="72" height="11" rx="5" fill="${LINE}"/>`;
}

function flower(x, y, size) {
  const petals = [[-1, 0], [1, 0], [0, -1], [0, 1]]
    .map(([dx, dy]) => `<circle cx="${x + dx * size * 1.25}" cy="${y + dy * size * 1.25}" r="${size}" fill="${PINK}"/>`)
    .join('');
  return `${petals}<circle cx="${x}" cy="${y}" r="${size * 0.85}" fill="${YELLOW}"/>`;
}

function spike(fill, { level }) {
  const mood = moodOf(fill);
  const arms =
    mood === 0
      ? '<rect x="33" y="72" width="36" height="14" rx="7"/><rect x="33" y="72" width="14" height="36" rx="7"/><rect x="91" y="62" width="36" height="14" rx="7"/><rect x="113" y="62" width="14" height="36" rx="7"/>'
      : '<rect x="33" y="82" width="36" height="14" rx="7"/><rect x="33" y="52" width="14" height="44" rx="7"/><rect x="91" y="68" width="36" height="14" rx="7"/><rect x="113" y="38" width="14" height="44" rx="7"/>';
  const shapes = `<rect x="60" y="24" width="40" height="112" rx="20"/>${arms}`;
  const water = waterIn(shapes, { x: 30, y: 22, w: 100, h: 116, low: 0.08, high: 0.86 }, fill);
  // Blooms at the goal each day; from the second unlock the flower stays.
  const blooming = mood === 2 || level >= 2;
  const bud = `<circle cx="80" cy="20" r="5" fill="${PINK}"/><path d="M75 24q5 -3 10 0" stroke="${GREEN}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  const top = blooming ? flower(80, 20, 6) : level >= 1 ? bud : '';
  const side = level >= 2 && mood > 0 ? flower(120, 36, 4.5) : '';
  const pot = `<path d="M50 132h60l-6 26H56z" fill="#c2703d" stroke="${LINE}" stroke-width="3" stroke-linejoin="round"/>`;
  return silhouette(shapes) + water.markup + eye(72, 60, mood) + eye(88, 60, mood) + mouth(80, 74, mood) + pot + top + side;
}

function sprout(fill, { level }) {
  const mood = moodOf(fill);
  const pot = '<path d="M42 92h76l-8 58H50z"/>';
  const water = waterIn(pot, { x: 42, y: 92, w: 76, h: 58, low: 0.14, high: 0.86 }, fill);
  const plants = [
    '<path d="M80 92q0-34 22-30q10 4 6 18" fill="none" stroke="#a3a35a" stroke-width="5" stroke-linecap="round"/><path d="M108 80q8 6 4 16q-10-4-4-16z" fill="#a3a35a"/>',
    `<path d="M80 92V48" stroke="${GREEN}" stroke-width="5" stroke-linecap="round"/><path d="M80 62q-24-2-26-20q22 0 26 20zM80 54q22-4 26-22q-24 0-26 22z" fill="${GREEN}"/>`,
    `<path d="M80 92V30" stroke="${GREEN}" stroke-width="5" stroke-linecap="round"/><path d="M80 72q-26-2-28-20q24 0 28 20zM80 64q24-4 28-22q-26 0-28 22z" fill="${GREEN}"/>${flower(80, 26, 9)}`,
  ];
  const butterfly = level >= 2
    ? `<g class="char-bob"><path d="M122 44q-12 -10 -14 2q2 8 14 -2zM122 44q12 -10 14 2q-2 8 -14 -2z" fill="${YELLOW}"/><path d="M122 38v12" stroke="${INK}" stroke-width="2" stroke-linecap="round"/></g>`
    : '';
  return `${plants[mood]}<g fill="${BODY}">${pot}</g>${water.markup}<path d="M42 92h76l-8 58H50z" fill="none" stroke="${LINE}" stroke-width="3" stroke-linejoin="round"/><rect x="36" y="86" width="88" height="11" rx="5" fill="${level >= 1 ? PINK : LINE}"/>${butterfly}${eye(68, 114, mood)}${eye(92, 114, mood)}${mouth(80, 128, mood)}`;
}

const DRAW = { duck, coolant, camel, gulp, spike, sprout };

// What each character earns, by days with at least one break. Counting days
// rather than a streak means weekends off never cost anyone a hat.
const UNLOCKS = {
  duck: [[7, 'a hat'], [30, 'sunglasses']],
  coolant: [[7, 'a heatsink'], [30, 'a fan']],
  camel: [[7, 'a saddle blanket'], [30, 'a second hump']],
  gulp: [[7, 'a castle'], [30, 'a friend']],
  spike: [[7, 'a flower bud'], [30, 'flowers that stay']],
  sprout: [[7, 'a painted pot'], [30, 'a butterfly']],
};
const DUSTY_AFTER_DAYS = 7;

const COBWEB = `<g class="char-cobweb" fill="none" stroke="${LINE}" stroke-width="1.2" stroke-opacity=".75"><path d="M6 6l30 8M6 6l22 22M6 6l8 30"/><path d="M26 11q-4 6-6 7q-2 5-7 7M16 8q-1 4-3 5q-1 3-5 4"/></g>`;

const characters = {
  // In the order the settings page lists them.
  list: [
    { id: 'orb', name: 'Orb' },
    { id: 'duck', name: 'Debug Duck' },
    { id: 'coolant', name: 'Coolant' },
    { id: 'camel', name: 'Hump Day' },
    { id: 'gulp', name: 'Gulp' },
    { id: 'spike', name: 'Spike' },
    { id: 'sprout', name: 'Sprout' },
  ],

  has: (id) => id in DRAW,

  // Never takes anything away: unlocks stay, and dust goes with one break.
  growth(id, activeDays = 0, daysSinceBreak = null) {
    const unlocks = UNLOCKS[id] || [];
    const earned = unlocks.filter(([days]) => activeDays >= days);
    const upcoming = unlocks[earned.length];
    return {
      level: earned.length,
      neglected: daysSinceBreak !== null && daysSinceBreak >= DUSTY_AFTER_DAYS,
      earned: earned.map(([, name]) => name),
      next: upcoming ? { days: upcoming[0], name: upcoming[1], left: upcoming[0] - activeDays } : null,
    };
  },

  // The unlock reached by going from one day count to the next, if any.
  unlockedBetween(id, before, after) {
    const hit = (UNLOCKS[id] || []).find(([days]) => before < days && after >= days);
    return hit ? hit[1] : null;
  },

  fillFor: (glasses, goal) => Math.min(1, Math.max(0, glasses / goal)),

  // The drawing, to go inside an <svg viewBox="0 0 160 160">.
  markup(id, fill, { small = false, level = 0, neglected = false } = {}) {
    const art = DRAW[id](fill, { small, level });
    return neglected ? `<g class="char-dusty">${art}</g>${COBWEB}` : art;
  },

  // Draws into an <svg>. Given a previous fill, the water rises from there.
  render(svg, id, fill, { from, small, level, neglected } = {}) {
    svg.innerHTML = this.markup(id, fill, { small, level, neglected });
    if (from === undefined) return;
    const parts = [...svg.querySelectorAll('.char-rise')];
    const place = (level) => parts.forEach((el) => {
      el.style.transform = `translateY(${-Number(el.dataset.span) * level}px)`;
    });
    place(from);
    // Force the start position to apply so the change animates.
    svg.getBoundingClientRect();
    place(fill);
  },
};

if (typeof module !== 'undefined') module.exports = characters;
else window.characters = characters;
