const $ = (id) => document.getElementById(id);
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const FIRST_HOUR = 9;
const LAST_HOUR = 18;

let hoursOpen = false;
let lastPreview = '';
let lastPicker = '';

function get(obj, key) {
  return key.split('.').reduce((o, k) => o?.[k], obj);
}

// Turns "stand.everyMin" + 30 into { stand: { everyMin: 30 } }.
function patch(key, value) {
  return key
    .split('.')
    .reverse()
    .reduce((acc, k) => ({ [k]: acc }), value);
}

function save(key, value) {
  window.stip.act('settings-set', patch(key, value));
}

function percent(input, value) {
  return ((value - input.min) / (input.max - input.min)) * 100;
}

function rangeFill(input) {
  input.style.setProperty('--pct', `${percent(input, input.value)}%`);
  const ticks = input.parentElement.querySelectorAll('.ticks span');
  ticks.forEach((tick) => tick.classList.toggle('on', tick.dataset.value === input.value));
}

function buildTicks() {
  document.querySelectorAll('.slider[data-ticks]').forEach((slider) => {
    const input = slider.querySelector('input');
    slider.querySelector('.ticks').replaceChildren(
      ...slider.dataset.ticks.split(',').map((value) => {
        const tick = document.createElement('span');
        tick.dataset.value = value;
        tick.textContent = value;
        tick.style.left = `${percent(input, Number(value))}%`;
        return tick;
      }),
    );
  });
}

function bar(className, heightPct, title) {
  const el = document.createElement('span');
  el.className = className;
  el.style.height = `${Math.max(3, heightPct)}%`;
  el.title = title;
  return el;
}

function renderStats({ settings, today, streak, longestStreak, week }) {
  const water = settings.water;
  $('t-streak').innerHTML = `${streak} <small>${streak === 1 ? 'day' : 'days'}</small>`;
  $('t-longest').textContent = `Longest: ${longestStreak} ${longestStreak === 1 ? 'day' : 'days'}`;

  // A rough daily target: one break per interval across an 8-hour day.
  const breakGoal = Math.max(1, Math.round((8 * 60) / settings.stand.everyMin));
  $('t-breaks').innerHTML = `${today.breaks} <small>of ${breakGoal}</small>`;
  $('t-breaks-bar').style.width = `${Math.min(100, (today.breaks / breakGoal) * 100)}%`;

  const litres = (today.glasses * water.glassMl) / 1000;
  const goalLitres = (water.goalGlasses * water.glassMl) / 1000;
  $('t-water').innerHTML = `${Number(litres.toFixed(1))} <small>of ${Number(goalLitres.toFixed(1))} L</small>`;
  $('t-water-bar').style.width = `${Math.min(100, (litres / goalLitres) * 100)}%`;

  const maxBreaks = Math.max(1, ...Object.values(today.hours));
  const nowHour = new Date().getHours();
  $('hour-bars').replaceChildren(
    ...Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => {
      const hour = FIRST_HOUR + i;
      const count = today.hours[hour] || 0;
      const cls = [count ? 'has' : '', hour === nowHour ? 'now' : ''].join(' ').trim();
      return bar(cls, (count / maxBreaks) * 100, `${count} at ${hour}:00`);
    }),
  );
  $('hour-axis').replaceChildren(
    ...[9, 11, 13, 15, 17].map((h) => Object.assign(document.createElement('span'), { textContent: String(h).padStart(2, '0') })),
  );

  // Water per day, scaled so the goal sits at 80% of the chart height.
  const scale = 80 / goalLitres;
  const weekBars = week.days.map((day, i) => {
    const dayLitres = (day.glasses * water.glassMl) / 1000;
    const cls = [day.glasses ? 'has' : '', i === week.days.length - 1 ? 'today' : ''].join(' ').trim();
    return bar(cls, Math.min(100, dayLitres * scale), `${Number(dayLitres.toFixed(2))} L`);
  });
  const goalLine = $('goal-line');
  goalLine.style.bottom = '80%';
  $('week-bars').replaceChildren(goalLine, ...weekBars);
  $('goal-label').textContent = `goal ${Number(goalLitres.toFixed(1))} L`;
  $('week-axis').replaceChildren(
    ...week.days.map((day, i) => {
      const label = document.createElement(i === week.days.length - 1 ? 'b' : 'span');
      label.textContent = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.weekday];
      return label;
    }),
  );

  const chip = (html) => Object.assign(document.createElement('span'), { innerHTML: html });
  const chips = [
    chip(`Last 7 days: <strong>${week.totals.breaks}</strong> breaks taken`),
    chip(`<strong>${week.totals.skipped}</strong> skipped`),
    chip(`<strong>${week.totals.snoozed}</strong> snoozed`),
  ];
  if (week.bestHour !== null) chips.push(chip(`Best hour: <strong>${String(week.bestHour).padStart(2, '0')}:00</strong>`));
  $('week-chips').replaceChildren(...chips);
}

function renderDays(container, key, selected) {
  container.replaceChildren(
    ...[1, 2, 3, 4, 5, 6, 0].map((day) => {
      const button = document.createElement('button');
      button.textContent = DAYS[day];
      button.setAttribute('aria-pressed', String(selected.includes(day)));
      button.addEventListener('click', () => {
        const days = selected.includes(day) ? selected.filter((d) => d !== day) : [...selected, day];
        save(key, days.sort());
      });
      return button;
    }),
  );
}

function render(state) {
  const { settings, today } = state;
  // The choices show what's been earned, so redraw them when that changes.
  const pickerKey = `${state.activeDays}:${state.daysSinceBreak}`;
  if (pickerKey !== lastPicker) {
    lastPicker = pickerKey;
    buildCharacters(state.activeDays, state.daysSinceBreak);
  }
  applyTheme(settings.theme);
  $('version').textContent = `Stip ${state.version}`;
  // The Microsoft Store version starts at login through Windows' own settings.
  $('login-row').hidden = state.fromStore;
  $('login-store').hidden = !state.fromStore;

  document.querySelectorAll('input[type="range"][data-key]').forEach((input) => {
    if (document.activeElement !== input) input.value = get(settings, input.dataset.key);
    rangeFill(input);
  });
  $('every-out').textContent = $('every').value;
  $('water-every-out').textContent = $('water-every').value;
  $('goal-out').textContent = $('goal').value;
  const goalLitres = (settings.water.goalGlasses * settings.water.glassMl) / 1000;
  $('goal-litres').textContent = `About ${Number(goalLitres.toFixed(1))} L a day`;

  document.querySelectorAll('[role="radiogroup"][data-key]').forEach((group) => {
    const value = String(get(settings, group.dataset.key));
    group.querySelectorAll('[role="radio"]').forEach((button) => {
      button.setAttribute('aria-checked', String(button.dataset.value === value));
    });
  });

  document.querySelectorAll('input[type="checkbox"][data-key]').forEach((input) => {
    input.checked = Boolean(get(settings, input.dataset.key));
  });

  document.querySelectorAll('select[data-key], input[type="time"][data-key]').forEach((input) => {
    if (document.activeElement !== input) input.value = String(get(settings, input.dataset.key));
  });

  const hours = settings.workHours;
  const dayNames = hours.days.map((d) => DAYS[d]).join(' ');
  $('hours-summary').textContent = `${dayNames || 'No days'} · ${hours.start} to ${hours.end}`;
  $('hours-detail').hidden = !hoursOpen;
  $('hours-edit').textContent = hoursOpen ? 'Done' : 'Edit';
  $('hours-edit').setAttribute('aria-expanded', String(hoursOpen));
  renderDays($('days'), 'workHours.days', hours.days);

  // Until someone chooses, water follows the working hours switch.
  const schedule = settings.water.schedule || (hours.enabled ? 'work' : 'always');
  $('water-schedule').querySelectorAll('[role="radio"]').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.value === schedule));
  });
  $('water-hours').hidden = schedule !== 'custom';
  renderDays($('water-days'), 'water.hours.days', settings.water.hours.days);
  $('water-schedule-hint').textContent = {
    always: 'Whenever Stip is running',
    work: `${dayNames || 'No days'} · ${hours.start} to ${hours.end}. Change these under Stand breaks.`,
    custom: 'Its own days and hours, separate from breaks',
  }[schedule];

  const cli = state.cliInstall;
  $('cli-row').hidden = state.fromStore || state.sandboxed;
  if (state.sandboxed) {
    $('calls-hint').textContent = 'When meeting mode is on';
    $('flow-hint').textContent = "When you're busy, the break starts at your next pause, 10 minutes later at most. Stip only looks at idle time, never what you type.";
  }
  $('cli-hint').textContent = !cli
    ? 'Control Stip from a terminal: stip pause 1h, or npm run build && stip break'
    : cli.ok
      ? `Installed in ${cli.dir}. If "stip" isn't found, add that folder to your PATH.`
      : `Couldn't install it: ${cli.error}`;

  $('preview-time').textContent = fmt.clock(settings.stand.breakSec * 1000);

  // Water preview: same level rule as the real orb, which never looks empty.
  const goal = settings.water.goalGlasses;
  const character = settings.water.character;
  $('mini-orb').toggleAttribute('hidden', characters.has(character));
  $('mini-char').toggleAttribute('hidden', !characters.has(character));
  const growth = characters.growth(character, state.activeDays, state.daysSinceBreak);
  const look = { level: growth.level, neglected: growth.neglected };
  renderGrowth(character, growth, state.activeDays);
  const previewKey = `${character}:${today.glasses}:${goal}:${growth.level}:${growth.neglected}`;
  if (characters.has(character) && previewKey !== lastPreview) {
    lastPreview = previewKey;
    characters.render($('mini-char'), character, characters.fillFor(today.glasses, goal), look);
  }
  const fill = 0.32 + 0.68 * Math.min(1, today.glasses / goal);
  $('preview-level').style.transform = `translateY(${244 - fill * 208}px)`;
  $('glass-dots').replaceChildren(
    ...Array.from({ length: goal }, (_, i) => {
      const dot = document.createElement('span');
      if (i < today.glasses) dot.className = 'full';
      return dot;
    }),
  );
  const litres = (today.glasses * settings.water.glassMl) / 1000;
  $('glass-count').textContent = `${today.glasses} of ${goal} glasses · ${Number(litres.toFixed(2))} L`;

  renderStats(state);
}

let lastState = null;

function renderGrowth(character, growth, activeDays) {
  const line = $('character-growth');
  line.hidden = !characters.has(character);
  if (line.hidden) return;
  const parts = [`${activeDays} ${activeDays === 1 ? 'day' : 'days'} with a break.`];
  if (growth.next) parts.push(`${growth.next.left} more for ${growth.next.name}.`);
  else parts.push('Everything unlocked.');
  if (growth.neglected) parts.push('Looking a bit dusty. One break fixes that.');
  line.textContent = parts.join(' ');
}

// Each choice shows the character half full, so the water reads.
function buildCharacters(activeDays = 0, daysSinceBreak = null) {
  $('characters').replaceChildren(
    ...characters.list.map(({ id, name }) => {
      const button = document.createElement('button');
      button.setAttribute('role', 'radio');
      button.dataset.value = id;
      const svgNs = 'http://www.w3.org/2000/svg';
      const art = document.createElementNS(svgNs, 'svg');
      art.setAttribute('viewBox', '0 0 160 160');
      art.setAttribute('aria-hidden', 'true');
      if (characters.has(id)) {
        const { level, neglected } = characters.growth(id, activeDays, daysSinceBreak);
        art.innerHTML = characters.markup(id, 0.5, { level, neglected });
      } else {
        art.innerHTML = `<circle cx="80" cy="84" r="60" fill="#141b2e" stroke="#e2e8f0" stroke-width="3"/><path d="M20 84a60 60 0 00120 0z" fill="#38bdf8"/><circle cx="66" cy="108" r="4" fill="#0b1020"/><circle cx="94" cy="108" r="4" fill="#0b1020"/>`;
      }
      const label = document.createElement('span');
      label.textContent = name;
      button.append(art, label);
      return button;
    }),
  );
}

function wire() {
  buildCharacters();
  buildTicks();

  document.querySelectorAll('.nav').forEach((nav) => {
    nav.addEventListener('click', () => {
      document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('on', n === nav));
      document.querySelectorAll('.page').forEach((page) => {
        page.hidden = page.id !== `page-${nav.dataset.page}`;
      });
    });
  });

  document.querySelectorAll('input[type="range"][data-key]').forEach((input) => {
    input.addEventListener('input', () => {
      rangeFill(input);
      const out = $(`${input.id}-out`);
      if (out) out.textContent = input.value;
    });
    input.addEventListener('change', () => save(input.dataset.key, Number(input.value)));
  });

  document.querySelectorAll('[role="radiogroup"][data-key]').forEach((group) => {
    group.addEventListener('click', (event) => {
      const button = event.target.closest('[role="radio"]');
      if (!button) return;
      const value = 'num' in group.dataset ? Number(button.dataset.value) : button.dataset.value;
      save(group.dataset.key, value);
    });
  });

  document.querySelectorAll('input[type="checkbox"][data-key]').forEach((input) => {
    input.addEventListener('change', () => save(input.dataset.key, input.checked));
  });

  document.querySelectorAll('select[data-key]').forEach((select) => {
    select.addEventListener('change', () => save(select.dataset.key, Number(select.value)));
  });

  document.querySelectorAll('input[type="time"][data-key]').forEach((input) => {
    input.addEventListener('change', () => input.value && save(input.dataset.key, input.value));
  });

  $('hours-edit').addEventListener('click', () => {
    hoursOpen = !hoursOpen;
    if (lastState) render(lastState);
  });

  document.querySelectorAll('[data-act]').forEach((button) => {
    button.addEventListener('click', () => window.stip.act(button.dataset.act));
  });
}

function onState(state) {
  lastState = state;
  render(state);
}

wire();
window.stip.onState(onState);
window.stip.getState().then(onState);
