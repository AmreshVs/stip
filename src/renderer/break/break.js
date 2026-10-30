const $ = (id) => document.getElementById(id);
const HOLD_MS = 3000;

const MESSAGES = [
  ['Keep calm and', 'stand up.'],
  ['Time to', 'unsit.'],
  ['Up you', 'get.'],
  ['Legs:', 'deployed.'],
  ['Stand up,', 'hero.'],
  ['Hydrate, then', 'elevate.'],
];

// Something to do with the break. A new one every 40 seconds.
const TASKS = [
  'Stand up and take five slow, deep breaths.',
  'Look at something 20 feet away for 20 seconds.',
  'Go and drink a glass of water.',
  'Do three slow shoulder rolls, then three backwards.',
  'Reach for the ceiling, then let your arms hang loose.',
  'Walk to the window and back.',
  'Turn your head slowly left, then right. Twice.',
  'Stretch your wrists: palms out, then palms in.',
];
const TASK_MS = 40000;

let show = null;
let finished = false;

function finish(how) {
  if (finished) return;
  finished = true;
  window.stip.act('break-finish', { how });
}

function chime() {
  const ctx = new AudioContext();
  [523.25, 783.99].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + i * 0.18;
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.18, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 1.1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 1.2);
  });
}

function tick() {
  const remaining = show.endsAt - Date.now();
  const text = fmt.clock(remaining);
  $('time').textContent = text;
  $('meme-time').textContent = text;
  const progress = 1 - remaining / (show.breakSec * 1000);
  $('ring').style.strokeDashoffset = String(917 * Math.min(1, Math.max(0, progress)));

  if (remaining <= 0 && show.role === 'main' && !finished) {
    $('done').hidden = false;
    if (show.sound) chime();
    setTimeout(() => finish('done'), 1400);
    return;
  }
  if (remaining > 0) setTimeout(tick, 250);
}

// Skipping needs a deliberate hold of Esc (or the button) unless the user
// picked the gentle mode. Strict mode only allows the meeting escape.
function startTasks(seed) {
  let i = seed % TASKS.length;
  const task = $('sub');
  task.textContent = TASKS[i];
  setInterval(() => {
    i = (i + 1) % TASKS.length;
    task.classList.remove('fresh');
    void task.offsetWidth;
    task.textContent = TASKS[i];
    task.classList.add('fresh');
  }, TASK_MS);
}

// After the allowed snoozes in a row, the break can't be put off again.
function setupSnooze(strictness, left) {
  const snooze = $('snooze');
  if (strictness === 'strict') return;
  if (left === 0) {
    snooze.hidden = true;
    $('note').textContent = 'No snoozes left. Time to stand.';
    return;
  }
  if (left !== null) snooze.textContent = `Snooze 5 min · ${left} left`;
}

function setupSkip(strictness) {
  const skip = $('skip');
  if (strictness === 'strict') {
    skip.hidden = true;
    $('snooze').hidden = true;
    return;
  }
  if (strictness === 'gentle') {
    skip.classList.add('instant');
    $('skip-hint').textContent = 'Skip';
    skip.addEventListener('click', () => finish('skip'));
    document.addEventListener('keydown', (e) => e.key === 'Escape' && finish('skip'));
    return;
  }

  let timer = null;
  const start = () => {
    if (timer) return;
    skip.classList.add('holding');
    timer = setTimeout(() => finish('skip'), HOLD_MS);
  };
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    skip.classList.remove('holding');
  };
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !e.repeat && start());
  document.addEventListener('keyup', (e) => e.key === 'Escape' && cancel());
  skip.addEventListener('pointerdown', start);
  skip.addEventListener('pointerup', cancel);
  skip.addEventListener('pointerleave', cancel);
}

async function init(data) {
  show = data;
  const state = await window.stip.getState();
  applyTheme(state.settings.theme);
  show.sound = state.settings.sound;

  $('chip-count').textContent = `Break ${state.today.breaks + 1} today`;
  $('chip-sat').textContent = `You focused for ${fmt.minutes(state.status.sittingMs)}`;

  if (data.role === 'main') {
    const [lead, accent] = MESSAGES[data.memeIndex % MESSAGES.length];
    $('lead').textContent = lead;
    $('accent').textContent = accent;
    startTasks(data.memeIndex);
    $('meme-left').innerHTML = memeAt(data.memeIndex);
    $('meme-right').innerHTML = memeAt(data.memeIndex + 1);
    $('note').textContent =
      data.displayCount > 1 ? `More memes on your other ${data.displayCount > 2 ? 'screens' : 'screen'}` : '';
    $('main-view').hidden = false;
    setupSnooze(data.strictness, data.snoozesLeft);
    setupSkip(data.strictness);
    document.querySelectorAll('[data-finish]').forEach((button) => {
      button.addEventListener('click', () => finish(button.dataset.finish));
    });
  } else {
    $('meme-big').innerHTML = memeAt(data.memeIndex + 2);
    $('meme-view').hidden = false;
  }
  tick();
}

window.stip.onShow(init);
