const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

// Answers the `stip` command. A socket only this user can open; no network.
function startCliServer(socket, handle) {
  if (process.platform !== 'win32') fs.rmSync(socket, { force: true });
  const server = net.createServer((client) => {
    let data = '';
    client.on('error', () => {});
    client.on('data', (chunk) => {
      data += chunk;
      if (!data.includes('\n')) return;
      let reply;
      try {
        reply = handle(JSON.parse(data));
      } catch {
        reply = { error: "Stip didn't understand that." };
      }
      client.end(JSON.stringify(reply));
    });
  });
  server.on('error', (err) => console.error('stip command unavailable:', err.message));
  server.listen(socket, () => {
    if (process.platform !== 'win32') fs.chmodSync(socket, 0o600);
  });
  return server;
}

// Writes a small launcher that runs src/cli.js with the app's own Node.
function installCommand({ exe, cli }) {
  const windows = process.platform === 'win32';
  const dir = windows
    ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'Stip', 'bin')
    : path.join(os.homedir(), '.local', 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, windows ? 'stip.cmd' : 'stip');
  const script = windows
    ? `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "${cli}" %*\r\n`
    : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${exe}" "${cli}" "$@"\n`;
  fs.writeFileSync(file, script, { mode: 0o755 });
  return { file, dir };
}

module.exports = { startCliServer, installCommand };
