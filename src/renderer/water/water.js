const $ = (id) => document.getElementById(id);
// If nobody answers, tuck the orb away and ask again later.
const IGNORE_AFTER_MS = 20000;

// Our own copy; the <em> marks the highlighted word.
const LINES = [
  "I'm running <em>low.</em> So are you.",
  'Your brain is a <em>grape</em> right now.',
  'Sip happens. <em>Make it.</em>',
  'Hydrate or <em>diedrate.</em>',
  'Plants need water. <em>So do devs.</em>',
];

let glasses = 0;
let goal = 8;
let answered = false;

// Water surface height inside the orb: 244 is empty, 36 is full. The orb
// always keeps a little water so its face, which floats in it, stays visible.
function setLevel(count) {
  const fill = 0.32 + 0.68 * Math.min(1, count / goal);
  $('level').style.transform = `translateY(${244 - fill * 208}px)`;
}

function renderDots(count) {
  const dots = $('dots');
  dots.replaceChildren(
    ...Array.from({ length: goal }, (_, i) => {
      const dot = document.createElement('span');
      if (i < count) dot.className = 'full';
      return dot;
    }),
  );
  dots.setAttribute('aria-label', `${count} of ${goal} glasses today`);
}

function close(action) {
  if (answered) return;
  answered = true;
  document.body.classList.add('leaving');
  setTimeout(() => window.stip.act(action), 500);
}

async function init() {
  const state = await window.stip.getState();
  applyTheme(state.settings.theme);
  glasses = state.today.glasses;
  goal = state.settings.water.goalGlasses;
  const ml = state.settings.water.glassMl;

  $('line').innerHTML = LINES[Math.floor(Math.random() * LINES.length)];
  $('since').textContent = `Sitting for ${fmt.minutes(state.status.sittingMs)}`;
  $('count').textContent = `${glasses} of ${goal} glasses · ${(glasses * ml) / 1000} L today`;
  $('plus').textContent = `+${ml} ml`;
  renderDots(glasses);
  setLevel(glasses);

  const ignoreTimer = setTimeout(() => close('water-later'), IGNORE_AFTER_MS);

  $('sipped').addEventListener('click', () => {
    if (answered) return;
    clearTimeout(ignoreTimer);
    window.stip.act('water-sipped');
    glasses += 1;
    setLevel(glasses);
    renderDots(glasses);
    $('count').textContent = `${glasses} of ${goal} glasses · ${(glasses * ml) / 1000} L today`;
    document.getElementById('orb').classList.add('happy');
    setTimeout(() => close('water-close'), 1800);
  });

  $('later').addEventListener('click', () => {
    clearTimeout(ignoreTimer);
    close('water-later');
  });

  // Let clicks through the transparent parts of the window.
  document.querySelectorAll('.interactive').forEach((el) => {
    el.addEventListener('mouseenter', () => window.stip.act('water-hover', { over: true }));
    el.addEventListener('mouseleave', () => window.stip.act('water-hover', { over: false }));
  });
}

window.stip.onShow(init);
