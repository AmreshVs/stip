const $ = (id) => document.getElementById(id);

// "today", "tomorrow" or a weekday name.
function dayName(ms) {
  const days = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `on ${new Date(ms).toLocaleDateString([], { weekday: 'long' })}`;
}

const timeOfDay = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-act]');
  if (!button) return;
  const minutes = button.dataset.min;
  window.stip.act(button.dataset.act, minutes ? { minutes } : undefined);
});

$('pause-toggle').addEventListener('click', () => {
  const open = $('pause-row').hidden;
  $('pause-row').hidden = !open;
  $('pause-toggle').setAttribute('aria-expanded', String(open));
  reportHeight();
});

function moveFocus(step) {
  const rows = [...document.querySelectorAll('.row')].filter((row) => row.offsetParent !== null);
  const next = rows.indexOf(document.activeElement) + step;
  rows[(next + rows.length) % rows.length]?.focus();
}

// The keys a real menu answers to.
document.addEventListener('keydown', (event) => {
  const command = event.metaKey || event.ctrlKey;
  if (event.key === 'Escape') window.stip.act('tray-close');
  else if (event.key === 'ArrowDown') moveFocus(1);
  else if (event.key === 'ArrowUp') moveFocus(-1);
  else if (command && event.key === ',') window.stip.act('settings');
  else if (command && event.key === 'q') window.stip.act('quit');
  else return;
  event.preventDefault();
});

// The window fits the panel, so its height follows the content.
let lastHeight = 0;
let lastBead = '';
function reportHeight() {
  const height = Math.ceil($('panel').getBoundingClientRect().height);
  if (height !== lastHeight) {
    lastHeight = height;
    window.stip.act('tray-size', { height });
  }
}

function render(state) {
  const { settings, status, today, streak, meeting, tip, platform } = state;
  document.documentElement.classList.toggle('win', platform === 'win32');
  const now = Date.now();
  const paused = status.pausedUntil > 0;
  const set = (label, side, clock) => {
    $('status-text').textContent = label;
    $('break-at').textContent = side;
    $('next').textContent = clock;
  };
  let note = '';

  if (paused) {
    set('Paused', 'until', timeOfDay(status.pausedUntil));
  } else if (status.offHours) {
    set('Off hours', status.resumesAt ? `back ${dayName(status.resumesAt)}` : 'no working days set', status.resumesAt ? timeOfDay(status.resumesAt) : '--:--');
  } else if (status.waitingForMeeting) {
    set('In a call', 'break waiting', 'Soon');
    note = 'Your break starts 30 seconds after the call.';
  } else if (meeting.active) {
    // The timer keeps running in a call; only the break itself waits.
    set('In a call', `break at ${timeOfDay(now + status.msToStand)}, or after`, fmt.clock(status.msToStand));
  } else if (status.waitingForFlow) {
    set('Break at your next pause', "you're busy", 'Soon');
    note = 'It starts when you pause, 10 minutes later at most.';
  } else {
    set('Next break', `at ${timeOfDay(now + status.msToStand)}`, fmt.clock(status.msToStand));
    note = tip || '';
  }
  $('note').textContent = note;
  $('note').hidden = !note;

  const idle = paused || status.offHours;
  const waiting = status.waitingForMeeting || status.waitingForFlow;
  const progress = idle ? 0 : waiting ? 1 : 1 - status.msToStand / status.standEveryMs;
  $('bar').style.width = `${Math.min(1, Math.max(0, progress)) * 100}%`;

  const streakText = streak > 0 ? `${streak}-day streak` : `${today.breaks} ${today.breaks === 1 ? 'break' : 'breaks'} today`;
  $('summary').textContent = `Sitting ${fmt.minutes(status.sittingMs)} · ${streakText}`;

  const water = settings.water;
  $('sip').hidden = !water.enabled;
  $('water-now').hidden = !water.enabled;
  $('glasses').textContent = `${today.glasses} of ${water.goalGlasses} glasses`;
  if (status.waterOff) {
    $('water-next').textContent = status.waterResumesAt ? `back at ${timeOfDay(status.waterResumesAt)}` : 'no days set';
  } else {
    $('water-next').textContent = `next in ${fmt.minutes(status.msToWater)}`;
  }

  const custom = characters.has(water.character);
  $('bead-orb').toggleAttribute('hidden', custom);
  $('bead-char').toggleAttribute('hidden', !custom);
  const growth = characters.growth(water.character, state.activeDays, state.daysSinceBreak);
  const beadKey = `${water.character}:${today.glasses}:${water.goalGlasses}:${growth.level}:${growth.neglected}`;
  if (custom && beadKey !== lastBead) {
    lastBead = beadKey;
    characters.render($('bead-char'), water.character, characters.fillFor(today.glasses, water.goalGlasses), { small: true, level: growth.level, neglected: growth.neglected });
  }
  // Like the big orb, the bead never looks completely empty.
  const level = 0.2 + 0.8 * Math.min(1, today.glasses / water.goalGlasses);
  $('bead-level').style.transform = `translateY(${36 - level * 32}px)`;

  $('meeting').setAttribute('aria-pressed', String(meeting.manual));
  $('meeting-text').textContent = meeting.manual ? `On until ${timeOfDay(meeting.until)}` : 'Off';
  $('meeting').title = meeting.manual ? 'End meeting mode' : 'Hold breaks until your meeting ends';

  $('pause-toggle').hidden = paused;
  if (paused) $('pause-row').hidden = true;
  $('resume').hidden = !paused;
  reportHeight();
}

// A hidden window keeps running its CSS animations, which would use CPU all day.
window.stip.onShow(({ visible }) => document.body.classList.toggle('asleep', !visible));

window.stip.onState(render);
window.stip.getState().then(render);
