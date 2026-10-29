const $ = (id) => document.getElementById(id);
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const FIRST_HOUR = 9;
const LAST_HOUR = 18;

let current = null;

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

function rangeFill(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--pct', `${pct}%`);
}

function render(state) {
  current = state;
  const { settings, today, streak } = state;
  applyTheme(settings.theme);

  document.querySelectorAll('input[type="range"][data-key]').forEach((input) => {
    if (document.activeElement !== input) input.value = get(settings, input.dataset.key);
    rangeFill(input);
  });
  $('every-out').textContent = $('every').value;
  $('water-every-out').textContent = $('water-every').value;
  $('goal-out').textContent = $('goal').value;

  document.querySelectorAll('[role="radiogroup"][data-key]').forEach((group) => {
    const value = String(get(settings, group.dataset.key));
    group.querySelectorAll('[role="radio"]').forEach((button) => {
      button.setAttribute('aria-checked', String(button.dataset.value === value));
    });
  });

  document.querySelectorAll('input[type="checkbox"][data-key]').forEach((input) => {
    input.checked = Boolean(get(settings, input.dataset.key));
  });

  document.querySelectorAll('input[type="time"][data-key]').forEach((input) => {
    if (document.activeElement !== input) input.value = get(settings, input.dataset.key);
  });

  const hours = settings.workHours;
  $('hours-detail').hidden = !hours.enabled;
  $('hours-summary').textContent = hours.enabled
    ? `${hours.days.map((d) => DAYS[d]).join(' ')} · ${hours.start} to ${hours.end}`
    : 'No reminders outside these';
  $('days').replaceChildren(
    ...[1, 2, 3, 4, 5, 6, 0].map((day) => {
      const button = document.createElement('button');
      button.textContent = DAYS[day];
      button.setAttribute('aria-pressed', String(hours.days.includes(day)));
      button.addEventListener('click', () => {
        const days = hours.days.includes(day) ? hours.days.filter((d) => d !== day) : [...hours.days, day];
        save('workHours.days', days.sort());
      });
      return button;
    }),
  );

  $('preview-time').textContent = fmt.clock(settings.stand.breakSec * 1000);
  $('streak').textContent = `${streak} ${streak === 1 ? 'day' : 'days'}`;

  const maxBreaks = Math.max(1, ...Object.values(today.hours));
  const nowHour = new Date().getHours();
  $('bars').replaceChildren(
    ...Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => {
      const hour = FIRST_HOUR + i;
      const count = today.hours[hour] || 0;
      const bar = document.createElement('span');
      bar.style.height = `${Math.max(6, (count / maxBreaks) * 100)}%`;
      if (count) bar.className = 'has';
      if (hour === nowHour) bar.classList.add('now');
      bar.title = `${count} at ${hour}:00`;
      return bar;
    }),
  );
}

function wire() {
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

  document.querySelectorAll('input[type="time"][data-key]').forEach((input) => {
    input.addEventListener('change', () => input.value && save(input.dataset.key, input.value));
  });

  document.querySelectorAll('[data-act]').forEach((button) => {
    button.addEventListener('click', () => window.stip.act(button.dataset.act));
  });
}

wire();
window.stip.onState(render);
window.stip.getState().then(render);
