const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, parseDuration, send } = require('../src/cli');
const { startCliServer, installCommand } = require('../src/main/cli-server');

test('durations', () => {
  assert.equal(parseDuration('30m'), 30);
  assert.equal(parseDuration('90'), 90);
  assert.equal(parseDuration('1h'), 60);
  assert.equal(parseDuration('today'), 'day');
  assert.equal(parseDuration('soon'), null);
  assert.equal(parseDuration('0'), null);
  assert.equal(parseDuration(undefined), null);
});

test('commands', () => {
  assert.deepEqual(parseArgs(['break']), { command: 'break' });
  assert.deepEqual(parseArgs(['pause', '1h']), { command: 'pause', minutes: 60 });
  assert.deepEqual(parseArgs(['meeting', 'off']), { command: 'meeting', on: false });
  assert.ok(parseArgs(['pause']).error);
  assert.ok(parseArgs(['meeting', 'maybe']).error);
  assert.ok(parseArgs(['dance']).error);
});

test('a request reaches the app and the reply comes back', async () => {
  const socket = process.platform === 'win32'
    ? `\\\\.\\pipe\\stip-test-${process.pid}`
    : path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stip-')), 's.sock');
  const server = startCliServer(socket, ({ command }) => ({ message: `got ${command}` }));
  await new Promise((resolve) => server.once('listening', resolve));
  assert.deepEqual(await send({ command: 'break' }, socket), { message: 'got break' });
  await new Promise((resolve) => server.close(resolve));
});

test('install writes a launcher', { skip: process.platform === 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stip-home-'));
  const original = os.homedir;
  os.homedir = () => home;
  try {
    const { file } = installCommand({ exe: '/Apps/Stip', cli: '/Apps/app.asar/src/cli.js' });
    const script = fs.readFileSync(file, 'utf8');
    assert.match(script, /ELECTRON_RUN_AS_NODE=1 exec "\/Apps\/Stip" "\/Apps\/app\.asar\/src\/cli\.js" "\$@"/);
    assert.ok(fs.statSync(file).mode & 0o100);
  } finally {
    os.homedir = original;
  }
});
