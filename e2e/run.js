// End-to-end test: starts the real app with its windows hidden, clicks the
// real buttons and keys, and checks what happened. Run with `npm run e2e`.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stip-e2e-'));
fs.writeFileSync(
  path.join(dataDir, 'settings.json'),
  JSON.stringify({ stand: { everyMin: 60 }, water: { everyMin: 60 } }),
);
process.env.STIP_USER_DATA = dataDir;
process.env.STIP_HIDDEN = '1';

const { app, screen } = require('electron');
const { ready } = require('../src/main/index.js');

const MIN = 60 * 1000;
const results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
}

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✖'} ${name}${ok || !detail ? '' : `  (${detail})`}`);
}

const js = (win, code) => win.webContents.executeJavaScript(code);
const click = (win, selector) => js(win, `document.querySelector(${JSON.stringify(selector)}).click()`);
const isLoaded = (win) => waitFor(async () => !win.webContents.isLoading() && (await js(win, 'document.readyState')) === 'complete');

async function pressEscape(win, holdMs) {
  win.webContents.focus();
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await sleep(holdMs);
  // A long enough hold closes the break, and with it the window.
  if (!win.isDestroyed()) win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
}

async function openBreak(stip) {
  stip.handleAction('stand-now');
  await waitFor(() => stip.breaks.primary);
  const win = stip.breaks.primary;
  await isLoaded(win);
  await waitFor(() => js(win, "!document.getElementById('main-view').hidden"));
  return win;
}

async function testTray(stip) {
  const panel = stip.tray.open();
  await isLoaded(panel);
  await waitFor(() => js(panel, "document.getElementById('next').textContent !== '--:--'"));
  check('tray shows the countdown', /^\d+:\d\d$/.test(await js(panel, "document.getElementById('next').textContent")));

  check('tray status says Active', (await js(panel, "document.getElementById('status-text').textContent")) === 'Active');
  const height = stip.tray.panel.getBounds().height;
  check('tray window fits its content', height > 300 && height < 440, `${height} px`);

  await click(panel, '[data-act="pause"][data-min="30"]');
  check('pause 30 min pauses reminders', await waitFor(() => stip.scheduler.status(Date.now()).pausedUntil > 0));
  check('tray status says Paused', await waitFor(() => js(panel, "document.getElementById('status-text').textContent === 'Paused'")));
  check('resume button appears', await waitFor(() => js(panel, "!document.getElementById('resume').hidden")));
  await click(panel, '#resume');
  check('resume unpauses', await waitFor(() => stip.scheduler.status(Date.now()).pausedUntil === 0));

  await click(panel, '#meeting');
  check('meeting mode turns on', await waitFor(() => stip.meeting.manual()));
  check(
    'tray shows meeting mode is on',
    await waitFor(() =>
      js(
        panel,
        "document.getElementById('meeting').getAttribute('aria-pressed') === 'true' && document.getElementById('status-text').textContent === 'In a call' && document.getElementById('meeting-text').textContent.startsWith('End meeting mode · on until')",
      ),
    ),
  );
  await click(panel, '#meeting');
  check('meeting mode turns off', await waitFor(() => !stip.meeting.manual()));

  stip.settings.set({ workHours: { enabled: true, days: [] } });
  check('tray says Off hours outside working hours', await waitFor(() => js(panel, "document.getElementById('status-text').textContent === 'Off hours'")));
  stip.settings.set({ workHours: { enabled: false, days: [1, 2, 3, 4, 5] } });

  stip.settings.set({ water: { enabled: false } });
  await waitFor(() => js(panel, "document.getElementById('water-now').hidden"));
  const fullWidth = await js(panel, "document.querySelector('.stand').offsetWidth > document.querySelector('.actions').offsetWidth * 0.8");
  check('Stand now fills the row when water is off', fullWidth);
  stip.settings.set({ water: { enabled: true } });
  stip.tray.hide();
}

async function testBreak(stip) {
  let win = await openBreak(stip);
  const displays = screen.getAllDisplays().length;
  check(`break covers all ${displays} display(s)`, stip.breaks.windows.length === displays);
  const memes = await js(win, "document.querySelectorAll('#meme-left .meme, #meme-right .meme').length");
  check('break shows memes beside the timer', memes === 2);

  await click(win, '#snooze');
  check('snooze closes the break', await waitFor(() => !stip.breaks.open));
  const toStand = stip.scheduler.status(Date.now()).msToStand;
  check('snooze moves the break 5 min out', toStand > 4.9 * MIN && toStand <= 5 * MIN, `${toStand} ms`);

  win = await openBreak(stip);
  await pressEscape(win, 500);
  await sleep(3000);
  check('a short Esc tap does not skip', stip.breaks.open);
  await pressEscape(win, 3400);
  check('holding Esc for 3 s skips', await waitFor(() => !stip.breaks.open));
  check('skip is counted', stip.stats.today().skipped === 1);

  stip.settings.set({ stand: { breakSec: 3 } });
  await openBreak(stip);
  check('break ends by itself when time is up', await waitFor(() => !stip.breaks.open, 8000));
  check('finished break is counted', stip.stats.today().breaks === 1);
  check('timer restarts after a break', stip.scheduler.status(Date.now()).sittingMs < 5000);

  stip.settings.set({ stand: { breakSec: 60, strictness: 'strict' } });
  win = await openBreak(stip);
  const strictHidden = await js(win, "document.getElementById('skip').hidden && document.getElementById('snooze').hidden");
  check('strict mode hides skip and snooze', strictHidden);
  await click(win, '[data-finish="meeting"]');
  check("I'm in a meeting closes the break", await waitFor(() => !stip.breaks.open));
  check('break waits for the call', stip.meeting.manual() && stip.scheduler.status(Date.now()).waitingForMeeting);
  stip.meeting.setManual(false);
  stip.scheduler.restart(Date.now());
  stip.settings.set({ stand: { strictness: 'balanced' } });
}

async function testWater(stip) {
  const before = stip.stats.today().glasses;
  let win = stip.water.show();
  await isLoaded(win);
  await waitFor(() => js(win, "document.getElementById('count').textContent !== ''"));
  const level = await js(win, "document.getElementById('level').style.transform");
  check('water orb shows a level', /translateY/.test(level));
  await click(win, '#sipped');
  check('I sipped logs a glass', await waitFor(() => stip.stats.today().glasses === before + 1));
  check('water reminder closes after a sip', await waitFor(() => !stip.water.win, 4000));

  win = stip.water.show();
  await isLoaded(win);
  await click(win, '#later');
  check('In 10 min closes the reminder', await waitFor(() => !stip.water.win, 3000));
  const toWater = stip.scheduler.status(Date.now()).msToWater;
  check('In 10 min asks again in 10 min', toWater > 9.9 * MIN && toWater <= 10 * MIN, `${toWater} ms`);

  const panel = stip.tray.open();
  await isLoaded(panel);
  await click(panel, '[data-act="water-now"]');
  check('tray Water now shows the reminder', await waitFor(() => stip.water.win));
  win = stip.water.win;
  await isLoaded(win);
  await waitFor(() => js(win, "document.getElementById('count').textContent !== ''"));
  const dimmed = await js(win, "getComputedStyle(document.querySelector('.dim')).display !== 'none'");
  check('the screen dims behind the reminder', dimmed);
  stip.water.hide();

  stip.settings.set({ water: { dimScreen: false } });
  win = stip.water.show();
  await isLoaded(win);
  await waitFor(() => js(win, "document.body.classList.contains('no-dim')"));
  check('dimming can be turned off', await js(win, "getComputedStyle(document.querySelector('.dim')).display === 'none'"));
  stip.water.hide();
  stip.settings.set({ water: { dimScreen: true } });

  const settingsWin = stip.settingsWindow.open('flat');
  await isLoaded(settingsWin);
  await click(settingsWin, '.nav[data-page="water"]');
  await click(settingsWin, '[data-act="water-now"]');
  check('settings Try a water reminder shows it', await waitFor(() => stip.water.win));
  stip.water.hide();
  settingsWin.close();
}

async function testTimers(stip) {
  stip.settings.set({ water: { everyMin: 0.05 } });
  check('water reminder fires on its own timer', await waitFor(() => stip.water.win, 6000));
  stip.water.hide();
  stip.settings.set({ water: { everyMin: 60 } });

  stip.scheduler.lastBreakAt = Date.now();
  stip.settings.set({ stand: { everyMin: 0.05 } });
  check('stand break fires on its own timer', await waitFor(() => stip.breaks.open, 6000));
  stip.breaks.finish('skip');
  stip.settings.set({ stand: { everyMin: 60 } });
}

async function testSettings(stip) {
  const win = stip.settingsWindow.open('flat');
  await isLoaded(win);
  await waitFor(() => js(win, "document.getElementById('every').value === '60'"));

  await js(
    win,
    `(() => { const el = document.getElementById('every'); el.value = 30; el.dispatchEvent(new Event('change')); })()`,
  );
  check('slider changes the stand interval', await waitFor(() => stip.settings.get().stand.everyMin === 30));

  await click(win, '[data-key="stand.breakSec"] [data-value="120"]');
  check('break length can be changed', await waitFor(() => stip.settings.get().stand.breakSec === 120));

  await click(win, '#hours-edit');
  check('Edit shows the working days and times', await waitFor(() => js(win, "!document.getElementById('hours-detail').hidden")));
  await click(win, '#days button:nth-child(6)');
  check('a working day can be toggled', await waitFor(() => stip.settings.get().workHours.days.includes(6)));

  await js(
    win,
    `(() => { const el = document.querySelector('select[data-key="stand.awayMin"]'); el.value = '10'; el.dispatchEvent(new Event('change')); })()`,
  );
  check('away time can be changed', await waitFor(() => stip.settings.get().stand.awayMin === 10));

  await click(win, '.nav[data-page="stats"]');
  check('stats page opens', await js(win, "!document.getElementById('page-stats').hidden"));
  const statsShown = await js(
    win,
    "document.querySelectorAll('#hour-bars span').length === 10 && document.querySelectorAll('#week-bars span').length === 7",
  );
  check('stats page shows hourly and weekly charts', statsShown);
  const breaksTile = await js(win, "document.getElementById('t-breaks').textContent");
  check('stats page counts today\'s breaks', breaksTile.startsWith(String(stip.stats.today().breaks)), breaksTile);

  await click(win, '.nav[data-page="general"]');
  check('sidebar switches pages', await js(win, "!document.getElementById('page-general').hidden"));
  await click(win, '[data-key="theme"] [data-value="aurora"]');
  check('theme switches to aurora', await waitFor(() => stip.settings.get().theme === 'aurora'));
  check('window restyles to aurora', await waitFor(() => js(win, "document.documentElement.dataset.theme === 'aurora'")));

  await click(win, 'input[data-key="sound"]');
  check('sound can be turned off', await waitFor(() => stip.settings.get().sound === false));

  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
  check('settings are saved to disk', saved.theme === 'aurora' && saved.stand.everyMin === 30);
  win.close();
}

async function main() {
  const stip = await ready;
  for (const suite of [testTray, testBreak, testWater, testTimers, testSettings]) {
    console.log(`\n${suite.name.replace(/^test/, '')}`);
    try {
      await suite(stip);
    } catch (err) {
      check(`${suite.name} ran without errors`, false, err.message);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  fs.rmSync(dataDir, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
}

main();
