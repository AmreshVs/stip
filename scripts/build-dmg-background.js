// Renders build/dmg-background.html into the DMG window background, at
// normal and Retina size. Run with `npm run dmg-background` after changing
// the HTML; the PNGs are committed.
//
// It runs inside Electron so the page uses the app's own fonts.
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const WIDTH = 540;
const HEIGHT = 380;
const buildDir = path.join(__dirname, '..', 'build');

async function render(win, scale, file) {
  win.webContents.setZoomFactor(scale);
  win.setContentSize(WIDTH * scale, HEIGHT * scale);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const image = await win.webContents.capturePage();
  // Displays may capture at their own pixel density; pin the exact size.
  const sized = image.resize({ width: WIDTH * scale, height: HEIGHT * scale, quality: 'best' });
  fs.writeFileSync(path.join(buildDir, file), sized.toPNG());
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadFile(path.join(buildDir, 'dmg-background.html'));
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await render(win, 1, 'background.png');
  await render(win, 2, 'background@2x.png');
  console.log('DMG background written to build/background.png and build/background@2x.png');
  app.exit(0);
});
