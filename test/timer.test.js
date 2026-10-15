// -----------------------------------------------------------------------------
// The timers of the container. Gladys never polls a device published with
// should_poll: false (and never polls the devices created without should_poll,
// GladysAssistant/Gladys#3198): the phones must be read again by the hub's own
// timer, with no onPoll at all, at the interval of the configuration; the
// camera images refreshed at theirs; a timed recording stopped on time.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUB_TIMINGS } from '../src/hub.js';
import { BASE_CONFIG, createAll, createWorld, ids, settle } from './helpers/world.js';

async function timedWorld(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_760_000_000_000 });
  // The hub and the phones read the mocked clock, which the ticks move.
  const clock = { now: () => Date.now() };
  const w = await createWorld({ timers: true, clock, ...options });
  t.after(() => w.app.stop());
  await createAll(w);
  return w;
}

const statusReads = (w) =>
  w.phones.kitchen.requests.filter((r) => r.path.startsWith('/status.json')).length;

async function tick(t, ms) {
  t.mock.timers.tick(ms);
  await settle();
}

test('the internal timer reads the phones again without any onPoll from Gladys', async (t) => {
  const w = await timedWorld(t);
  assert.ok(w.fake.discoveredDevices.every((device) => device.should_poll === false));
  const battery = ids(w.gladys, 'kitchen').feature('battery');
  const before = statusReads(w);

  w.phones.kitchen.sample('battery_level', 86);
  await tick(t, 10_000);
  assert.equal(w.fake.lastState(battery), 86);
  w.phones.kitchen.sample('battery_level', 85);
  await tick(t, 10_000);
  assert.equal(w.fake.lastState(battery), 85);

  // The test never calls fake.poll(): every read came from the timer.
  assert.equal(statusReads(w) - before, 2, 'one read per interval');
});

test('the interval of the configuration is followed', async (t) => {
  const w = await timedWorld(t, { config: { ...BASE_CONFIG, refresh_interval: '60' } });
  const before = statusReads(w);
  await tick(t, 30_000);
  assert.equal(statusReads(w), before);
  await tick(t, 30_000);
  assert.equal(statusReads(w), before + 1);
});

test('camera images follow the interval of the configuration', async (t) => {
  const w = await timedWorld(t, { config: { ...BASE_CONFIG, refresh_interval: '60' } });
  const images = w.fake.cameraImages.length;
  await tick(t, 60_000);
  assert.equal(w.fake.cameraImages.length - images, 2, 'one per phone');
});

test('no periodic image when the configuration says "only on motion or request"', async (t) => {
  const w = await timedWorld(t, {
    config: { ...BASE_CONFIG, refresh_interval: '60', snapshot_interval: '0' },
  });
  const images = w.fake.cameraImages.length;
  await tick(t, 60 * 60_000);
  assert.equal(w.fake.cameraImages.length, images);
});

test('a timed recording stops on time', async (t) => {
  const w = await timedWorld(t, { config: { ...BASE_CONFIG, refresh_interval: '60' } });
  const phone = ids(w.gladys, 'kitchen').device;
  await w.fake.sceneAction('record_video', { phone, minutes: '2' });
  assert.equal(w.phones.kitchen.recording, true);
  await tick(t, 60_000);
  assert.equal(w.phones.kitchen.recording, true);
  await tick(t, 60_000);
  assert.equal(w.phones.kitchen.recording, false);
  assert.equal(w.fake.lastState(ids(w.gladys, 'kitchen').feature('recording')), 0);
});

test('the timers stop with the integration', async (t) => {
  const w = await timedWorld(t);
  await w.app.stop();
  const requests = w.phones.kitchen.requests.length;
  await tick(t, 60 * 60_000);
  assert.equal(w.phones.kitchen.requests.length, requests);
});

test('an unchanged value is sent again every 6 hours (heartbeat, under the 12 h rule)', async (t) => {
  const w = await timedWorld(t, {
    config: { ...BASE_CONFIG, refresh_interval: '60', snapshot_interval: '0' },
  });
  const feature = ids(w.gladys, 'kitchen').feature('pressure');
  const sent = () =>
    w.fake.states.filter((state) => state.device_feature_external_id === feature).length;
  const before = sent();
  for (let elapsed = 0; elapsed < HUB_TIMINGS.heartbeatMs - 60_000; elapsed += 60_000) {
    await tick(t, 60_000);
  }
  assert.equal(sent(), before, 'nothing sent while the value is recent');
  await tick(t, 2 * 60_000);
  assert.equal(sent(), before + 1, 'sent again once 6 hours old');
  assert.ok(HUB_TIMINGS.heartbeatMs <= 12 * 60 * 60_000);
});
