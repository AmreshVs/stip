// Makes the Mac App Store screenshots in build/app-store, at 2880x1800, the
// largest size Apple accepts. Run with `npm run screenshots:appstore`. Uses a
// throwaway data folder with sample stats, so your own data is never touched.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const electron = require('electron');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'build', 'app-store');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stip-appstore-'));
const WIDTH = 2880;
const HEIGHT = 1800;
const NIGHT = '#0b1020';

function dayKey(offset) {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Sample data: a believable fortnight, enough to unlock the duck's hat.
function seed(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ water: { character: 'duck' } }));
  const days = {};
  for (let i = 0; i < 12; i += 1) {
    const late = i % 3 === 0;
    days[dayKey(i)] = {
      breaks: 5 + (i % 4),
      skipped: late ? 2 : 0,
      snoozed: i % 2,
      glasses: i === 0 ? 4 : 6 + (i % 3),
      hours: { 9: 1, 10: 2, 11: 1, 13: 1, 14: 1 },
      skippedHours: late ? { 16: 2 } : {},
      longestSitMin: i === 3 ? 160 : 45,
    };
  }
  fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify(days));
}

function capture(view, delayMs = 2500) {
  const dir = path.join(tmp, view.replace(/\W/g, '-'));
  seed(dir);
  const file = path.join(tmp, `${view.replace(/\W/g, '-')}.png`);
  execFileSync(electron, [root, `--show=${view}:aurora`], {
    env: { ...process.env, STIP_AS_APP_STORE: '1', STIP_USER_DATA: dir, STIP_SNAPSHOT: file, STIP_SNAPSHOT_DELAY: String(delayMs), STIP_SNAPSHOT_SIZE: '1440x900' },
    stdio: 'ignore',
  });
  return file;
}

function caption(title, subtitle) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <defs>
      <radialGradient id="a"><stop offset="0" stop-color="#0f766e" stop-opacity=".6"/><stop offset="1" stop-color="#0f766e" stop-opacity="0"/></radialGradient>
      <radialGradient id="b"><stop offset="0" stop-color="#4338ca" stop-opacity=".6"/><stop offset="1" stop-color="#4338ca" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="${NIGHT}"/>
    <circle cx="300" cy="200" r="1100" fill="url(#a)"/>
    <circle cx="2600" cy="1700" r="1200" fill="url(#b)"/>
    <text x="1440" y="170" text-anchor="middle" font-family="Georgia, serif" font-size="116" fill="#eef2ff">${title}</text>
    <text x="1440" y="260" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="48" fill="#cbd5e1">${subtitle}</text>
  </svg>`);
}

// Puts a capture under a caption, scaled to fit the space that's left.
async function framed(file, title, subtitle, out, { maxWidth = 2500, maxHeight = 1400 } = {}) {
  const image = await sharp(file).resize({ width: maxWidth, height: maxHeight, fit: 'inside' }).png().toBuffer();
  const { width, height } = await sharp(image).metadata();
  await sharp(caption(title, subtitle))
    .composite([{ input: image, left: Math.round((WIDTH - width) / 2), top: Math.round(330 + (HEIGHT - 360 - height) / 2) }])
    .flatten({ background: NIGHT })
    .removeAlpha()
    .png()
    .toFile(path.join(outDir, out));
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  await sharp(capture('break'))
    .resize(WIDTH, HEIGHT, { fit: 'cover' })
    .flatten({ background: NIGHT })
    .removeAlpha()
    .png()
    .toFile(path.join(outDir, '1-stand-break-2880x1800.png'));

  // The reminder is see-through, so show its corner over a plain desktop.
  const water = capture('water', 4500);
  const meta = await sharp(water).metadata();
  const desk = await sharp({ create: { width: meta.width, height: meta.height, channels: 4, background: '#334155' } })
    .composite([{ input: water }])
    .png()
    .toBuffer();
  // Captures are at the screen's pixel density, so measure in points.
  const density = meta.width > 2000 ? 2 : 1;
  const cropWidth = Math.min(meta.width, 1120 * density);
  const cropHeight = Math.min(meta.height, 640 * density);
  const corner = await sharp(desk)
    .extract({ left: meta.width - cropWidth, top: meta.height - cropHeight, width: cropWidth, height: cropHeight })
    .png()
    .toBuffer();
  await framed(corner, 'A nudge that fills as you drink', 'Six characters, or the classic orb. They earn things as you go.', '2-water-reminder-2880x1800.png');

  await framed(capture('tray'), 'Quiet, right in your menu bar', 'Looks like part of your Mac, in light and dark mode.', '3-menu-bar-2880x1800.png', { maxHeight: 1380, maxWidth: 1200 });
  await framed(capture('report'), 'Your week, as a code review', 'The Spine report: habits as a diff, with a suggestion you can apply.', '4-spine-report-2880x1800.png');
  await framed(capture('settings.water'), 'Make it yours', 'Timing, strictness, water goal, working hours and two themes.', '5-settings-2880x1800.png');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`App Store screenshots saved to ${path.relative(root, outDir)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
