// Renders the SVG sources in assets/ into the PNGs the app and installer use.
// Run with `npm run icons` after changing an SVG; the PNGs are committed.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const assets = path.join(__dirname, '..', 'assets');
const out = (name) => path.join(assets, 'generated', name);

async function square(svgFile, size, file) {
  await sharp(path.join(assets, svgFile), { density: 72 * (size / 1024) * 4 })
    .resize(size, size)
    .png()
    .toFile(out(file));
}

// The glyph is tall, so centre it on a square transparent canvas.
async function trayGlyph(size, color, file) {
  const svg = fs
    .readFileSync(path.join(assets, 'glyph.svg'), 'utf8')
    .replaceAll('#000', color);
  const height = Math.round(size * 0.9);
  const glyph = await sharp(Buffer.from(svg), { density: 300 }).resize({ height }).png().toBuffer();
  const { width } = await sharp(glyph).metadata();
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: glyph, left: Math.round((size - width) / 2), top: Math.round((size - height) / 2) }])
    .png()
    .toFile(out(file));
}

async function main() {
  fs.mkdirSync(path.join(assets, 'generated'), { recursive: true });
  await square('icon.svg', 1024, 'icon.png');
  await square('icon.svg', 256, 'icon-256.png');
  await square('icon-aurora.svg', 1024, 'icon-aurora.png');
  // macOS menu bar: black template images, tinted by the system.
  await trayGlyph(18, '#000', 'trayTemplate.png');
  await trayGlyph(36, '#000', 'trayTemplate@2x.png');
  // Windows and Linux trays: lime glyph that reads on dark and light bars.
  await trayGlyph(32, '#8fd14f', 'tray.png');
  console.log('Icons written to assets/generated');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
