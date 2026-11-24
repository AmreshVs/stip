// Builds the Tauri app (a debug build, quick once cached) and returns the
// path to its binary, for scripts that run it to take screenshots.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function appBinary() {
  const dir = path.join(__dirname, '..', 'src-tauri');
  execFileSync('cargo', ['build', '--locked'], { cwd: dir, stdio: 'inherit' });
  return path.join(dir, 'target', 'debug', process.platform === 'win32' ? 'stip.exe' : 'stip');
}

module.exports = { appBinary };
