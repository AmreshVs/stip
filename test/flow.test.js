const test = require('node:test');
const assert = require('node:assert/strict');
const { Flow } = require('../src/main/flow');

function busyFor(flow, seconds, idle = 0) {
  for (let i = 0; i < seconds; i += 1) flow.note(idle);
}

test('in flow after being busy for most of a minute', () => {
  const flow = new Flow();
  busyFor(flow, 29);
  assert.equal(flow.active(), false);
  busyFor(flow, 1);
  assert.equal(flow.active(), true);
});

test('a pause of 10 seconds ends flow', () => {
  const flow = new Flow();
  busyFor(flow, 60);
  flow.note(9);
  assert.equal(flow.active(), true);
  flow.note(10);
  assert.equal(flow.active(), false);
});

test('old activity falls out of the last minute', () => {
  const flow = new Flow();
  busyFor(flow, 60);
  busyFor(flow, 31, 5);
  assert.equal(flow.active(), false);
});

test('a running build counts as flow, on any platform', () => {
  const flow = new Flow();
  flow.updateProcesses(['/usr/bin/login', '/Users/me/.cargo/bin/cargo']);
  assert.equal(flow.active(), true);
  flow.updateProcesses(['cl.exe', 'MSBuild.exe']);
  assert.equal(flow.active(), true);
  flow.updateProcesses(['/usr/bin/login', 'Cargo Notes']);
  assert.equal(flow.active(), false);
});
