#!/usr/bin/env node
// The `stip` command. It talks to the running app over a private local socket
// and never touches the network.
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const HELP = `Usage: stip <command>

  status            When the next break is, and today's numbers
  break             Start a stand break now
  water             Show the water reminder now
  sip               Log a glass of water
  pause <time>      Pause reminders: 30m, 1h, or today
  resume            Turn reminders back on
  meeting on|off    Turn meeting mode on or off

Add --json to status for machine-readable output.
Example: npm run build && stip break`;

function socketPath() {
  if (process.env.STIP_SOCKET) return process.env.STIP_SOCKET;
  if (process.platform === 'win32') return `\\\\.\\pipe\\stip-${os.userInfo().username}`;
  return path.join(os.homedir(), '.stip.sock');
}

// "30m", "1h", "90" (minutes) or "today". Returns minutes, 'day' or null.
function parseDuration(text) {
  if (text === 'today') return 'day';
  const match = /^(\d+)(m|min|h|hr)?$/.exec(text || '');
  if (!match || Number(match[1]) === 0) return null;
  return Number(match[1]) * (match[2]?.startsWith('h') ? 60 : 1);
}

// Turns the command line into a request, or { error }.
function parseArgs(args) {
  const [command, value] = args;
  switch (command) {
    case 'status':
    case 'break':
    case 'water':
    case 'sip':
    case 'resume':
      return { command };
    case 'pause': {
      const minutes = parseDuration(value);
      return minutes ? { command, minutes } : { error: 'Say how long, like: stip pause 30m, 1h or today' };
    }
    case 'meeting':
      if (value === 'on' || value === 'off') return { command, on: value === 'on' };
      return { error: 'Use: stip meeting on, or stip meeting off' };
    default:
      return { error: HELP };
  }
}

function send(request, socket = socketPath()) {
  return new Promise((resolve, reject) => {
    const client = net.connect(socket);
    let data = '';
    client.on('connect', () => client.write(`${JSON.stringify(request)}\n`));
    client.on('data', (chunk) => {
      data += chunk;
    });
    client.on('end', () => resolve(JSON.parse(data)));
    client.on('error', reject);
  });
}

function clock(ms) {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function describe({ status, today, meeting, streak }) {
  let next = `Next break in ${clock(status.msToStand)}`;
  if (status.onBreak) next = 'On a break';
  else if (status.pausedUntil) next = `Paused until ${new Date(status.pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  else if (status.offHours) next = 'Outside working hours';
  else if (status.waitingForMeeting) next = 'Break waiting for your call to end';
  else if (status.waitingForFlow) next = 'Break starts at your next pause';
  const lines = [next, `Today: ${today.breaks} breaks, ${today.glasses} glasses, ${streak}-day streak`];
  if (meeting) lines.push('Meeting mode is on');
  return lines.join('\n');
}

async function main(args) {
  if (!args.length || args[0] === '--help' || args[0] === 'help') {
    console.log(HELP);
    return;
  }
  const json = args.includes('--json');
  const request = parseArgs(args.filter((arg) => arg !== '--json'));
  if (request.error) {
    console.error(request.error);
    process.exitCode = 2;
    return;
  }
  let reply;
  try {
    reply = await send(request);
  } catch {
    console.error("Stip isn't running. Open it first.");
    process.exitCode = 1;
    return;
  }
  if (reply.error) {
    console.error(reply.error);
    process.exitCode = 1;
  } else if (request.command === 'status') {
    console.log(json ? JSON.stringify(reply) : describe(reply));
  } else {
    console.log(reply.message);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { parseArgs, parseDuration, socketPath, send, describe };
