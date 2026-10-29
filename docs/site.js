document.documentElement.classList.add('js');

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/* Entrances: the masked headlines and each section's parts, once. */
requestAnimationFrame(() => $('.hero').classList.add('shown'));

const reveal = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add(entry.target.classList.contains('close-title') ? 'shown' : 'in');
      reveal.unobserve(entry.target);
    }
  },
  { threshold: 0.15 },
);

$$('.reveal, .close-title').forEach((el) => {
  // Stagger the parts of a section by their order inside it.
  const siblings = $$('.reveal', el.parentElement);
  el.style.transitionDelay = `${Math.max(0, siblings.indexOf(el)) * 80}ms`;
  reveal.observe(el);
});

/* The settings bands: real switches. */
$$('.band').forEach((band) => {
  const toggle = $('.switch', band);
  toggle.addEventListener('click', () => {
    const on = band.dataset.on !== 'true';
    band.dataset.on = String(on);
    toggle.setAttribute('aria-checked', String(on));
  });
});

/* When will it ask? Reads "every 40 minutes", "45 min", "every hour"... */
const input = $('#interval');

function parseInterval(text) {
  const t = text.toLowerCase();
  if (/\b(an|one|1)?\s*hour\b/.test(t) && !/\d+\s*(m|min)/.test(t)) {
    const hours = Number((t.match(/(\d+(?:\.\d+)?)\s*h/) || [])[1] || 1);
    return Math.round(hours * 60);
  }
  const n = Number((t.match(/\d+/) || [])[0]);
  return n || null;
}

// Clock times, like 09:40. taste-skill-ignore
const pad = (n) => String(n).padStart(2, '0');

function renderSchedule() {
  const every = parseInterval(input.value);
  const summary = $('#ask-summary');
  const list = $('#ask-times');
  if (!every || every < 15 || every > 90) {
    summary.textContent = 'Stip asks every 15 to 90 minutes. Try "every 40 minutes".';
    list.replaceChildren();
    return;
  }
  // A working day from 09:00 to 18:00; each break restarts the timer.
  const times = [];
  for (let m = 9 * 60 + every; m <= 18 * 60; m += every + 1) times.push(m);
  summary.textContent = `${times.length} breaks between 09:00 and 18:00, ${times.length} minutes on your feet.`;
  list.replaceChildren(
    ...times.map((m) => {
      const li = document.createElement('li');
      li.textContent = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
      if (m >= 12 * 60 && m < 13 * 60) li.className = 'lunch';
      return li;
    }),
  );
}

input.addEventListener('input', renderSchedule);
$$('[data-example]').forEach((button) =>
  button.addEventListener('click', () => {
    input.value = button.dataset.example;
    renderSchedule();
  }),
);
renderSchedule();

/* The live break: a 20-second taste of the real thing. */
const demo = $('#demo');
const DEMO_SEC = 20;
const HOLD_MS = 3000;
let endsAt = 0;
let ticker = null;
let breathTimer = null;
let holdTimer = null;
let opener = null;

function closeDemo(message) {
  clearInterval(ticker);
  clearInterval(breathTimer);
  clearTimeout(holdTimer);
  demo.hidden = true;
  document.body.style.overflow = '';
  if (opener) {
    if (message) opener.textContent = message;
    opener.focus();
  }
}

function tick() {
  const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  $('#demo-time').textContent = `0:${pad(left)}`;
  if (left === 0) {
    clearInterval(ticker);
    $('#demo-title').textContent = 'Nice. Back to it.';
    $('#demo-sub').textContent = 'That was a stand break. Stip does this every 40 minutes.';
    setTimeout(() => closeDemo('Try another break'), 1600);
  }
}

function openDemo(event) {
  opener = event.currentTarget;
  $('#demo-title').textContent = 'Keep calm and stand up.';
  $('#demo-sub').textContent = 'This is a 20-second taste. The real one lasts a minute.';
  demo.hidden = false;
  document.body.style.overflow = 'hidden';
  endsAt = Date.now() + DEMO_SEC * 1000;
  tick();
  ticker = setInterval(tick, 250);
  let breathingIn = true;
  $('#demo-breath').textContent = 'Breathe in';
  breathTimer = setInterval(() => {
    breathingIn = !breathingIn;
    $('#demo-breath').textContent = breathingIn ? 'Breathe in' : 'Breathe out';
  }, 4000);
  $('.esc-meeting', demo).focus();
}

$$('[data-try-break]').forEach((button) => button.addEventListener('click', openDemo));

$$('[data-demo-close]', demo).forEach((button) =>
  button.addEventListener('click', () => {
    closeDemo(button.dataset.demoClose === 'meeting' ? 'In the app, it waits for your call' : 'In the app, it comes back in 5 min');
  }),
);

// Skipping needs a deliberate 3-second hold, of Esc or of the button.
const hold = $('#demo-hold');
function startHold() {
  if (holdTimer) return;
  hold.classList.add('holding');
  holdTimer = setTimeout(() => {
    holdTimer = null;
    hold.classList.remove('holding');
    closeDemo('Skipped. Try another break');
  }, HOLD_MS);
}
function cancelHold() {
  clearTimeout(holdTimer);
  holdTimer = null;
  hold.classList.remove('holding');
}
hold.addEventListener('pointerdown', startHold);
hold.addEventListener('pointerup', cancelHold);
hold.addEventListener('pointerleave', cancelHold);
hold.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && !e.repeat && startHold());
hold.addEventListener('keyup', (e) => (e.key === 'Enter' || e.key === ' ') && cancelHold());
document.addEventListener('keydown', (e) => {
  if (!demo.hidden && e.key === 'Escape' && !e.repeat) startHold();
  if (!demo.hidden && e.key === 'Tab') {
    // Keep focus inside the break, like the real one.
    const buttons = $$('button', demo);
    const i = buttons.indexOf(document.activeElement);
    e.preventDefault();
    buttons[(i + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
  }
});
document.addEventListener('keyup', (e) => {
  if (!demo.hidden && e.key === 'Escape') cancelHold();
});

/* Fit the footer wordmark from margin to margin, whatever font loaded. */
function fitWordmark() {
  const svg = $('.wordmark');
  const box = $('text', svg).getBBox();
  if (box.width) svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
}
document.fonts.ready.then(fitWordmark);
