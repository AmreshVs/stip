const fs = require('node:fs');

// Dev helper: STIP_SNAPSHOT=/tmp/shot.png npm start -- --show=tray
// saves a PNG of the window once it has rendered, then quits.
async function snapshot(win, file, delayMs = Number(process.env.STIP_SNAPSHOT_DELAY) || 1500) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(file, image.toPNG());
}

function requestedView() {
  const arg = process.argv.find((a) => a.startsWith('--show='));
  return arg ? arg.slice('--show='.length) : null;
}

module.exports = { snapshot, requestedView };
