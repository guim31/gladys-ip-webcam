// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal cycle — reads, motions, sounds, images, the widget — writes
// nothing; a failure that repeats is logged once, and its end once. Never a
// password of the configuration, at any level.
// (Adapted from guim31/gladys-dahua.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_CONFIG, PASSWORD, createAll, createWorld, ids, settle } from './helpers/world.js';

/** Capture the lines of the SDK logger at a level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BASIC = Buffer.from(`gladys:${PASSWORD}`).toString('base64');

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

function assertNoSecret(text, secrets = [PASSWORD, BASIC]) {
  for (const secret of secrets) {
    assert.ok(!text.includes(secret), `a secret was logged: ${secret}`);
  }
}

test('a normal cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('Connected to IP Webcam at 192.0.2.10:8080')),
    'the start is logged',
  );
  await createAll(w);
  logs.clear();

  for (let i = 0; i < 3; i += 1) {
    w.clock.advance(10_000);
    w.phones.kitchen.shortMotion();
    w.phones.kitchen.sample('sound', 200 + i);
    await w.hub.refresh();
    w.clock.advance(60_000);
    await w.hub.snapshotAll();
    await w.fake.widgetGet('ip_webcam', { settings: {}, language: 'en' });
    await w.fake.widgetGet('ip_webcam', {
      settings: { phone: ids(w.gladys, 'kitchen').device },
      language: 'en',
    });
  }
  await sleep(80); // the pulses end
  await settle();
  assert.deepEqual(logs.texts(), []);
  assert.ok(w.fake.cameraImages.length >= 6);
});

test('a phone that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();

  w.phones.kitchen.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.refresh();
    await w.hub.snapshotAll();
  }
  const lines = logs.texts();
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(
    lines[0],
    /\[INFO\].*Cannot read IP Webcam at 192\.0\.2\.10:8080: .*does not answer/,
  );

  logs.clear();
  w.phones.kitchen.online = true;
  await w.hub.refresh();
  await w.hub.refresh();
  const back = logs.texts();
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /answers again after 5 min/);
});

test('a refused password is a warning once, its repeats only at debug; never a password', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, {
    config: { ...BASE_CONFIG, hosts: '192.0.2.10', password: 'wrong-phone-secret' },
  });
  for (let i = 0; i < 5; i += 1) {
    await w.hub.refresh();
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.match(
    warnings[0].text,
    /Cannot read IP Webcam at 192\.0\.2\.10:8080: User name or password refused/,
  );
  assertNoSecret(logs.texts().join('\n'), [
    PASSWORD,
    'wrong-phone-secret',
    Buffer.from('gladys:wrong-phone-secret').toString('base64'),
  ]);
});

test('a phone that stops sending images is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  w.phones.kitchen.shotCode = 500;
  for (let i = 0; i < 4; i += 1) {
    w.clock.advance(10 * 60_000);
    await w.hub.snapshotAll();
  }
  assert.equal(logs.texts().length, 1, logs.texts().join('\n'));
  assert.match(logs.texts()[0], /No image from 192\.0\.2\.10:8080/);
  logs.clear();
  w.phones.kitchen.shotCode = 200;
  w.clock.advance(10 * 60_000);
  await w.hub.snapshotAll();
  assert.equal(logs.texts().length, 1, logs.texts().join('\n'));
  assert.match(logs.texts()[0], /back/);
});

test('a user command is one line; the stream address never holds the password', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  const device = w.fake.discoveredDevices[0];
  const torch = device.features.find((f) => f.external_id.endsWith(':torch'));
  await w.fake.setValue(device, torch, 1);
  assert.equal(logs.texts().length, 1);
  assert.match(logs.texts()[0], /192\.0\.2\.10:8080: torch on/);
  logs.clear();
  await w.fake.action('stream_url', { phone: device.external_id });
  assert.equal(logs.texts().length, 1);
  logs.clear();
  await w.fake.sceneAction('record_video', { phone: device.external_id, minutes: '1' });
  assert.equal(logs.texts().length, 1);
  assert.match(logs.texts()[0], /recording started for 1 min/);
  logs.clear();
  await w.fake.widgetAction('ip_webcam', 'image', { phone: device.external_id }, { settings: {} });
  assert.equal(logs.texts().length, 1);
  assertNoSecret(logs.texts().join('\n'));
});

test('LOG_LEVEL=debug shows the repeats; never a password nor the Basic header', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  await createAll(w);
  w.phones.kitchen.online = false;
  await w.hub.refresh();
  await w.hub.refresh();
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*Cannot read IP Webcam at 192\.0\.2\.10:8080/);
  assertNoSecret(text);
});
