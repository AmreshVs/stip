const $ = (id) => document.getElementById(id);
const RING = 314;

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

function setStatus(kind, text) {
  $('status').className = `status ${kind}`;
  $('status-text').textContent = text;
}

// The window fits the panel, so its height follows the content.
let lastHeight = 0;
function reportHeight() {
  const height = Math.ceil($('panel').getBoundingClientRect().height);
  if (height !== lastHeight) {
    lastHeight = height;
    window.stip.act('tray-size', { height });
  }
}

function render(state) {
  const { settings, status, today, streak, meeting } = state;
  applyTheme(settings.theme);
  const now = Date.now();
  const paused = status.pausedUntil > 0;

  if (paused) {
    setStatus('paused', 'Paused');
    $('next').textContent = timeOfDay(status.pausedUntil);
    $('next-label').textContent = 'paused until';
    $('break-at').textContent = 'Reminders are off';
  } else if (status.offHours) {
    setStatus('paused', 'Off hours');
    $('next').textContent = status.resumesAt ? timeOfDay(status.resumesAt) : '--:--';
    $('next-label').textContent = 'back at';
    $('break-at').textContent = status.resumesAt ? `Working hours resume ${dayName(status.resumesAt)}` : 'No working days set';
  } else if (status.waitingForMeeting || meeting.active) {
    setStatus('call', 'In a call');
    $('next').textContent = status.waitingForMeeting ? 'Soon' : fmt.clock(status.msToStand);
    $('next-label').textContent = status.waitingForMeeting ? 'after the call' : 'to stand';
    // The timer keeps running in a call; only the break itself waits.
    $('break-at').textContent = status.waitingForMeeting
      ? 'Starts 30 s after the call'
      : `Break at ${timeOfDay(now + status.msToStand)}, or after the call`;
  } else {
    setStatus('', 'Active');
    $('next').textContent = fmt.clock(status.msToStand);
    $('next-label').textContent = 'to stand';
    $('break-at').textContent = `Break at ${timeOfDay(now + status.msToStand)}`;
  }
  $('sitting').textContent = `Sitting ${fmt.minutes(status.sittingMs)}`;

  const idle = paused || status.offHours;
  const progress = idle ? 0 : status.waitingForMeeting ? 1 : 1 - status.msToStand / status.standEveryMs;
  $('ring').style.strokeDashoffset = String(RING * (1 - Math.min(1, Math.max(0, progress))));

  const water = settings.water;
  $('water-row').hidden = !water.enabled;
  $('water-rule').hidden = !water.enabled;
  $('water-now').hidden = !water.enabled;
  $('glasses').textContent = `${today.glasses} of ${water.goalGlasses} glasses`;
  $('water-next').textContent = `Sip in ${fmt.minutes(status.msToWater)}`;
  // Like the big orb, the bead never looks completely empty.
  const level = 0.2 + 0.8 * Math.min(1, today.glasses / water.goalGlasses);
  $('bead-level').style.transform = `translateY(${36 - level * 32}px)`;

  const litres = Number(((today.glasses * water.glassMl) / 1000).toFixed(1));
  const breaks = `${today.breaks} ${today.breaks === 1 ? 'break' : 'breaks'} today`;
  const streakText = streak > 0 ? `<strong>${streak}-day streak</strong>` : '<strong>Start a streak today</strong>';
  $('summary').innerHTML = water.enabled ? `${breaks} · ${litres} L water · ${streakText}` : `${breaks} · ${streakText}`;

  $('meeting').setAttribute('aria-pressed', String(meeting.manual));
  $('meeting-text').textContent = meeting.manual ? `End meeting mode · on until ${timeOfDay(meeting.until)}` : 'Meeting mode';
  $('meeting').title = meeting.manual ? 'End meeting mode' : 'Hold breaks until your meeting ends';

  $('pause-label').textContent = paused ? `Paused until ${timeOfDay(status.pausedUntil)}` : 'Pause for';
  $('pause-row').hidden = paused;
  $('resume').hidden = !paused;
  reportHeight();
}

window.stip.onState(render);
window.stip.getState().then(render);
