const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, parseDuration, send } = require('../src/cli');

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

// The app's side (src-tauri/src/cli_server.rs) has its own tests; this
// checks that the command sends one JSON line and reads the reply.
test('a request reaches the app and the reply comes back', async () => {
  const socket = process.platform === 'win32'
    ? `\\\\.\\pipe\\stip-test-${process.pid}`
    : path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stip-')), 's.sock');
  const server = net.createServer((client) => {
    let data = '';
    client.on('data', (chunk) => {
      data += chunk;
      if (data.includes('\n')) client.end(JSON.stringify({ message: `got ${JSON.parse(data).command}` }));
    });
  });
  await new Promise((resolve) => server.listen(socket, resolve));
  assert.deepEqual(await send({ command: 'break' }, socket), { message: 'got break' });
  await new Promise((resolve) => server.close(resolve));
});
