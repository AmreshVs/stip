// Captures the README screenshots into docs/screenshots. Run with
// `npm run screenshots`. Uses a throwaway data folder with sample stats, so
// your own settings are never touched.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const electron = require('electron');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stip-shots-'));

function dayKey(offset) {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return date.toISOString().slice(0, 10);
}

// A believable week: a few breaks every morning, most water goals met.
function seed(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const week = [
    [6, 7, 1, 0, 6],
    [5, 8, 0, 1, 8],
    [4, 6, 1, 2, 7],
    [3, 9, 0, 1, 9],
    [2, 7, 1, 0, 6],
    [1, 8, 0, 1, 8],
    [0, 4, 0, 1, 4],
  ];
  const days = {};
  for (const [offset, breaks, skipped, snoozed, glasses] of week) {
    days[dayKey(offset)] = { breaks, skipped, snoozed, glasses, hours: { 9: 1, 10: 1, 11: 2 } };
  }
  fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify(days));
}

function capture(view, theme, delayMs = 1800) {
  const dir = path.join(tmp, theme);
  if (!fs.existsSync(dir)) seed(dir);
  const file = path.join(tmp, `${view}-${theme}.png`);
  execFileSync(electron, [root, `--show=${view}:${theme}`], {
    env: {
      ...process.env,
      STIP_USER_DATA: dir,
      STIP_SNAPSHOT: file,
      STIP_SNAPSHOT_DELAY: String(delayMs),
      STIP_SNAPSHOT_SIZE: '1600x900',
    },
    stdio: 'ignore',
  });
  return file;
}

// Puts a transparent window capture on a solid backdrop with some room around it.
async function onBackdrop(file, color, pad, out) {
  const { width, height } = await sharp(file).metadata();
  await sharp({ create: { width: width + pad * 2, height: height + pad * 2, channels: 4, background: color } })
    .composite([{ input: file, left: pad, top: pad }])
    .png()
    .toFile(out);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const out = (name) => path.join(outDir, name);

  for (const theme of ['flat', 'aurora']) {
    await sharp(capture('break', theme)).resize({ width: 1600 }).png().toFile(out(`break-${theme}.png`));
    const tray = capture('tray', theme);
    await onBackdrop(tray, theme === 'flat' ? '#3d6bff' : '#0b1020', 48, out(`tray-${theme}.png`));
  }

  // The water reminder dims a full-screen window; show its corner over a plain desktop.
  const water = capture('water', 'flat', 4000);
  const { width, height } = await sharp(water).metadata();
  const desk = await sharp({ create: { width, height, channels: 4, background: '#9aa3b2' } })
    .composite([{ input: water }])
    .png()
    .toBuffer();
  const cropWidth = Math.min(width, 1100);
  await sharp(desk)
    .extract({ left: width - cropWidth, top: height - 640, width: cropWidth, height: 640 })
    .png()
    .toFile(out('water-flat.png'));

  await sharp(capture('settings.stand', 'flat')).png().toFile(out('settings-flat.png'));
  await sharp(capture('settings.stats', 'flat')).png().toFile(out('stats-flat.png'));
  await sharp(capture('settings.stand', 'aurora')).png().toFile(out('settings-aurora.png'));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`Screenshots saved to ${path.relative(root, outDir)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
