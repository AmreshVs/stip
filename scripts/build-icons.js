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

// Microsoft Store tiles: the arrow and drop on Stip's dark plate.
async function storeTile(width, height, file, dir = 'appx') {
  const size = Math.round(Math.min(width, height) * 0.62);
  const x = (width - size) / 2;
  const y = (height - size) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#141414"/>
    <g transform="translate(${x} ${y}) scale(${size / 1024})">
      <path d="M512 880 L512 560 M372 690 L512 550 L652 690" fill="none" stroke="#c6f35c" stroke-width="120" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M512 120C512 120 402 248 402 316a110 110 0 00220 0C622 248 512 120 512 120z" fill="#3d6bff"/>
    </g>
  </svg>`;
  fs.mkdirSync(path.join(__dirname, '..', 'build', dir), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(path.join(__dirname, '..', 'build', dir, file));
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
  // Microsoft Store package tiles, read by electron-builder from build/appx.
  await storeTile(50, 50, 'StoreLogo.png');
  await storeTile(44, 44, 'Square44x44Logo.png');
  await storeTile(71, 71, 'SmallTile.png');
  await storeTile(150, 150, 'Square150x150Logo.png');
  await storeTile(310, 150, 'Wide310x150Logo.png');
  await storeTile(310, 310, 'LargeTile.png');
  // Store listing images, uploaded by hand in Partner Center under Store logos.
  await storeTile(300, 300, 'app-tile-icon-300x300.png', 'store-listing');
  await storeTile(2160, 2160, 'box-art-2160x2160.png', 'store-listing');
  await storeTile(1440, 2160, 'poster-art-1440x2160.png', 'store-listing');
  console.log('Icons written to assets/generated');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
