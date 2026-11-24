// Renders build/dmg-background.html into the DMG window background, at
// normal and Retina size, and on macOS joins them into background.tiff, the
// one file the DMG uses (Finder picks the size for the screen). Run with
// `npm run dmg-background` after changing the HTML; the images are committed.
//
// Uses headless Chrome (or set CHROME to another Chromium browser), so the
// page loads the app's own fonts from node_modules.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');

const WIDTH = 540;
const HEIGHT = 380;
const buildDir = path.join(__dirname, '..', 'build');

const candidates = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const chrome = candidates.find((file) => fs.existsSync(file));
if (!chrome) {
  console.error('No Chrome found. Set CHROME to a Chrome or Chromium binary.');
  process.exit(1);
}

const page = pathToFileURL(path.join(buildDir, 'dmg-background.html')).href;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stip-dmg-'));

async function main() {
  for (const [scale, file] of [[1, 'background.png'], [2, 'background@2x.png']]) {
    const shot = path.join(tmp, file);
    // Headless Chrome counts some window chrome in --window-size, so render in
    // a taller window and crop to the page, which is a fixed 540x380.
    execFileSync(chrome, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      // Gives the fonts time to load before the picture is taken.
      '--virtual-time-budget=3000',
      `--window-size=${WIDTH},${HEIGHT + 400}`,
      `--force-device-scale-factor=${scale}`,
      `--screenshot=${shot}`,
      page,
    ], { stdio: 'ignore' });
    await sharp(shot)
      .extract({ left: 0, top: 0, width: WIDTH * scale, height: HEIGHT * scale })
      .png()
      .toFile(path.join(buildDir, file));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (process.platform === 'darwin') {
    const [one, two, tiff] = ['background.png', 'background@2x.png', 'background.tiff'].map((f) => path.join(buildDir, f));
    execFileSync('tiffutil', ['-cathidpicheck', one, two, '-out', tiff], { stdio: 'ignore' });
    console.log('DMG background written to build/background.png, background@2x.png and background.tiff');
  } else {
    console.log('DMG background written to build/background.png and background@2x.png (make background.tiff on a Mac)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
