const $ = (id) => document.getElementById(id);

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-act]');
  if (!button) return;
  const minutes = button.dataset.min;
  window.stip.act(button.dataset.act, minutes ? { minutes } : undefined);
});

function render(state) {
  const { settings, status, today, streak, meeting } = state;
  applyTheme(settings.theme);

  const paused = status.pausedUntil > 0;
  if (paused) {
    $('next-label').textContent = 'Paused until';
    $('next').textContent = new Date(status.pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (status.waitingForMeeting) {
    $('next-label').textContent = 'Waiting for your call';
    $('next').textContent = 'Soon';
  } else {
    $('next-label').textContent = 'Next stand';
    $('next').textContent = fmt.clock(status.msToStand);
  }
  $('sitting').textContent = `Sitting for ${fmt.minutes(status.sittingMs)}`;

  const progress = paused ? 0 : 1 - status.msToStand / status.standEveryMs;
  $('ring').style.strokeDashoffset = String(264 * (1 - Math.min(1, Math.max(0, progress))));

  const goal = settings.water.goalGlasses;
  $('water-row').hidden = !settings.water.enabled;
  $('glasses').textContent = `${today.glasses} of ${goal} glasses`;
  $('water-next').textContent = `Next sip in ${fmt.minutes(status.msToWater)}`;
  const level = Math.min(1, today.glasses / goal);
  $('bead-water').setAttribute('y', String(36 - level * 32));

  $('stat-breaks').textContent = String(today.breaks);
  const litres = (today.glasses * settings.water.glassMl) / 1000;
  $('stat-water').textContent = `${Number(litres.toFixed(1))} L`;
  $('stat-streak').textContent = String(streak);

  const meetingButton = $('meeting');
  meetingButton.classList.toggle('on', meeting.manual);
  meetingButton.textContent = meeting.manual ? 'End meeting mode' : 'Meeting mode';

  $('pause-label').textContent = paused ? 'Reminders are paused' : 'Pause reminders';
  $('pause-row').hidden = paused;
  $('resume').hidden = !paused;
}

window.stip.onState(render);
window.stip.getState().then(render);
