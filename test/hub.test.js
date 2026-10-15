// -----------------------------------------------------------------------------
// The hub against two fake phones and the SDK's fake Gladys: features by what
// each phone offers, motions between two reads, the image before the motion,
// the loudest sound, phones lost and back, commands, timed recordings, the
// security rule of the motion detection, and what survives a restart.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUB_TIMINGS } from '../src/hub.js';
import {
  BASE_CONFIG,
  FakePhone,
  createAll,
  createClock,
  createWorld,
  ids,
  settle,
} from './helpers/world.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const featureOf = (w, name, key) => {
  const externalId = ids(w.gladys, name).feature(key);
  const device = w.fake.discoveredDevices.find((d) => d.external_id === ids(w.gladys, name).device);
  return { device, feature: device.features.find((f) => f.external_id === externalId) };
};

test('one device per phone, its features from what the app offers', async (t) => {
  const w = await world(t);
  const [kitchen, garage] = w.fake.discoveredDevices;
  assert.equal(kitchen.name, 'IP Webcam 192.0.2.10:8080');
  assert.equal(kitchen.external_id, 'ext:test-integration:phone:192-0-2-10-8080');
  assert.equal(kitchen.should_poll, false);
  assert.deepEqual(kitchen.params, [{ name: 'address', value: '192.0.2.10:8080' }]);
  const keys = (device) => device.features.map((f) => f.external_id.split(':').pop());
  assert.ok(keys(kitchen).includes('pressure') && keys(kitchen).includes('charging'));
  assert.ok(!keys(garage).includes('pressure') && !keys(garage).includes('charging'));
  // The garage gives its orientations; the kitchen does not: the four known.
  const orientation = (device) =>
    device.features.find((f) => f.external_id.endsWith(':orientation')).supported_options;
  assert.equal(orientation(kitchen).length, 4);
  assert.equal(orientation(garage)[2].value, 'portrait');
});

test('a phone without data logging still has its camera and its commands', async (t) => {
  const clock = createClock();
  const w = await world(t, {
    clock,
    phones: { kitchen: new FakePhone({ sensors: 'sensors-empty.json', now: clock.now }) },
    config: { ...BASE_CONFIG, hosts: '192.0.2.10', username: '', password: '' },
  });
  const [device] = w.fake.discoveredDevices;
  const keys = device.features.map((f) => f.external_id.split(':').pop());
  assert.deepEqual(keys, [
    'image',
    'online',
    'motion',
    'motion_detection',
    'torch',
    'focus',
    'night_vision',
    'recording',
    'orientation',
    'quality',
  ]);
  const report = await w.fake.action('test_connection', {});
  assert.match(report.data.message.en, /logs no sensor: enable "Data logging"/);
});

test('states are only published for the phones added to Gladys, and again on creation', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.states.length, 0, 'nothing before "Add to Gladys"');
  await createAll(w);
  const kitchen = ids(w.gladys, 'kitchen');
  assert.equal(w.fake.lastState(kitchen.feature('battery')), 87);
  assert.equal(w.fake.lastState(kitchen.feature('charging')), 1);
  assert.equal(w.fake.lastState(kitchen.feature('battery_temperature')), 33.9);
  assert.equal(w.fake.lastState(kitchen.feature('light')), 991);
  assert.equal(w.fake.lastState(kitchen.feature('pressure')), 1013.2);
  assert.equal(w.fake.lastState(kitchen.feature('quality')), '50', '49 shows as the nearest, 50');
  assert.equal(w.fake.lastState(ids(w.gladys, 'garage').feature('recording')), 1);
  assert.ok(w.fake.cameraImages.length >= 2, 'an image of each phone once added');
  // Nothing changed: a second read publishes nothing.
  const count = w.fake.states.length;
  await w.hub.refresh();
  assert.equal(w.fake.states.length, count);
});

test('a short motion between two reads is published 1 then 0, the image first', async (t) => {
  const w = await world(t);
  await createAll(w);
  const motion = ids(w.gladys, 'kitchen').feature('motion');
  const images = w.fake.cameraImages.length;
  w.clock.advance(10_000);
  w.phones.kitchen.shortMotion();
  // Gladys sees the image arrive before the state 1.
  const order = [];
  const publishCameraImage = w.gladys.publishCameraImage.bind(w.gladys);
  t.mock.method(w.gladys, 'publishCameraImage', async (...args) => {
    order.push('image');
    return publishCameraImage(...args);
  });
  const publishChangedStates = w.gladys.publishChangedStates.bind(w.gladys);
  t.mock.method(w.gladys, 'publishChangedStates', async (states, options) => {
    if (states.some((s) => s.device_feature_external_id === motion && s.state === 1)) {
      order.push('motion');
    }
    return publishChangedStates(states, options);
  });
  await w.hub.refresh();
  assert.equal(w.fake.lastState(motion), 1);
  assert.equal(w.fake.cameraImages.length, images + 1);
  assert.deepEqual(order, ['image', 'motion']);
  await sleep(80); // the pulse ends
  assert.equal(w.fake.lastState(motion), 0);
});

test('a lasting motion stays 1 until the app says 0; an old sample is not a new motion', async (t) => {
  const w = await world(t);
  await createAll(w);
  const motion = ids(w.gladys, 'kitchen').feature('motion');
  w.clock.advance(10_000);
  w.phones.kitchen.sample('motion_active', 1);
  await w.hub.refresh();
  await sleep(80);
  assert.equal(w.fake.lastState(motion), 1);
  w.clock.advance(10_000);
  w.phones.kitchen.sample('motion_active', 0);
  await w.hub.refresh();
  assert.equal(w.fake.lastState(motion), 0);
  // Nothing new: the samples already seen do not fire again.
  w.clock.advance(10_000);
  await w.hub.refresh();
  await settle();
  assert.equal(w.fake.lastState(motion), 0);
  assert.equal(
    w.fake.states.filter((s) => s.device_feature_external_id === motion && s.state === 1).length,
    1,
  );
});

test('the sound level is the loudest sample since the last read', async (t) => {
  const w = await world(t);
  await createAll(w);
  const sound = ids(w.gladys, 'kitchen').feature('sound');
  assert.equal(w.fake.lastState(sound), 178, 'the first read takes the last sample');
  w.clock.advance(10_000);
  w.phones.kitchen.sample('sound', 230, { at: w.clock.now() - 3000 });
  w.phones.kitchen.sample('sound', 181, { at: w.clock.now() - 1000 });
  await w.hub.refresh();
  assert.equal(w.fake.lastState(sound), 230);
  w.clock.advance(10_000);
  w.phones.kitchen.sample('sound', 182);
  await w.hub.refresh();
  assert.equal(w.fake.lastState(sound), 182);
});

test('a phone lost: offline, transport unreachable, readings kept; back again', async (t) => {
  const w = await world(t);
  await createAll(w);
  const kitchen = ids(w.gladys, 'kitchen');
  w.phones.kitchen.online = false;
  await w.hub.refresh();
  assert.equal(w.fake.lastState(kitchen.feature('online')), 0);
  assert.equal(w.fake.lastState(kitchen.feature('battery')), 87, 'the last reading stays');
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  assert.deepEqual(w.fake.connectionStatus.connected, true, 'the garage still answers');
  assert.match(w.fake.connectionStatus.message.en, /some phones do not answer/);
  w.phones.kitchen.online = true;
  await w.hub.refresh();
  assert.equal(w.fake.lastState(kitchen.feature('online')), 1);
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('every phone refusing the password: a status that says what to fix', async (t) => {
  const w = await world(t, {
    config: { ...BASE_CONFIG, hosts: '192.0.2.10', password: 'bad-pass' },
  });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /User name or password refused/);
  const lone = await world(t, {
    config: { ...BASE_CONFIG, hosts: '192.0.2.10', password: '' },
  });
  assert.match(lone.fake.connectionStatus.message.en, /both a user name and a password/);
  const none = await world(t, { config: { ...BASE_CONFIG, hosts: '' } });
  assert.match(none.fake.connectionStatus.message.en, /Enter the address/);
  assert.deepEqual(none.fake.discoveredDevices, []);
});

test('the commands reach the app and their state follows', async (t) => {
  const w = await world(t);
  await createAll(w);
  const cases = [
    ['torch', 1, () => w.phones.kitchen.curvals.torch === 'on'],
    ['night_vision', 1, () => w.phones.kitchen.curvals.night_vision === 'on'],
    ['focus', 1, () => w.phones.kitchen.focused === true],
    ['recording', 1, () => w.phones.kitchen.recording === true],
    ['recording', 0, () => w.phones.kitchen.recording === false],
    ['orientation', 'upsidedown', () => w.phones.kitchen.curvals.orientation === 'upsidedown'],
    ['quality', '70', () => w.phones.kitchen.curvals.quality === '70'],
  ];
  for (const [key, value, check] of cases) {
    const { device, feature } = featureOf(w, 'kitchen', key);
    const ack = await w.fake.setValue(device, feature, value);
    assert.equal(ack.success, true, `${key}: ${ack.error}`);
    assert.ok(check(), key);
    const state = w.fake.lastState(feature.external_id);
    assert.equal(String(state), String(value), key);
  }
  // A read confirms what the app holds.
  await w.hub.refresh();
  assert.equal(w.fake.lastState(ids(w.gladys, 'kitchen').feature('quality')), '70');
});

test('a refused command fails with a reason; a read-only feature is no command', async (t) => {
  const w = await world(t);
  await createAll(w);
  const { device, feature } = featureOf(w, 'kitchen', 'torch');
  w.phones.kitchen.refuseCommands = true;
  const ack = await w.fake.setValue(device, feature, 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /refused the command/);
  const detection = featureOf(w, 'kitchen', 'motion_detection');
  const refused = await w.fake.setValue(detection.device, detection.feature, 0);
  assert.equal(refused.success, false);
  assert.match(refused.error, /No command/);
});

test('motion detection: on always, off only when allowed, never as a switch', async (t) => {
  const w = await world(t);
  await createAll(w);
  const phone = ids(w.gladys, 'kitchen').device;
  const { feature } = featureOf(w, 'kitchen', 'motion_detection');
  assert.equal(feature.read_only, true);
  const off = await w.fake.sceneAction('set_motion_detection', { phone, state: 'off' });
  assert.equal(off.success, false);
  assert.match(off.error, /disabled: allow it in the configuration/);
  assert.equal(w.phones.kitchen.curvals.motion_detect, 'on');

  await w.fake.configUpdated({ ...BASE_CONFIG, allow_motion_detection_off: true });
  await settle();
  const allowed = await w.fake.sceneAction('set_motion_detection', { phone, state: 'off' });
  assert.equal(allowed.success, true, allowed.error);
  assert.equal(w.phones.kitchen.curvals.motion_detect, 'off');
  assert.equal(w.fake.lastState(feature.external_id), 0);
  const on = await w.fake.sceneAction('set_motion_detection', { phone, state: 'on' });
  assert.equal(on.success, true);
  assert.equal(w.phones.kitchen.curvals.motion_detect, 'on');
});

test('a timed recording stops by itself, and survives a restart', async (t) => {
  const clock = createClock();
  const w = await createWorld({ clock });
  await createAll(w);
  const phone = ids(w.gladys, 'kitchen').device;
  const ack = await w.fake.sceneAction('record_video', { phone, minutes: '5', tag: 'Front door!' });
  assert.deepEqual(ack.data.outputs, { started: true });
  assert.ok(w.phones.kitchen.recording);
  assert.equal(w.phones.kitchen.tag, 'Front_door_');
  await w.app.stop();

  // The integration restarts 6 minutes later: it stops the recording.
  clock.advance(6 * 60_000);
  const again = await createWorld({ clock, phones: w.phones, dataDir: w.dataDir });
  t.after(() => again.app.stop());
  assert.equal(w.phones.kitchen.recording, false);
  assert.deepEqual(again.hub.saved.recordings, {});
});

test('a recording started by hand is never stopped by a scene timer', async (t) => {
  const w = await world(t);
  await createAll(w);
  // The garage records already (started on the phone).
  const phone = ids(w.gladys, 'garage').device;
  const ack = await w.fake.sceneAction('record_video', { phone, minutes: '1' });
  assert.deepEqual(ack.data.outputs, { started: false });
  w.clock.advance(5 * 60_000);
  await w.hub.refresh();
  assert.equal(w.phones.garage.recording, true);
});

test('stopping a recording by hand ends the timer of the scene', async (t) => {
  const w = await world(t);
  await createAll(w);
  const phone = ids(w.gladys, 'kitchen').device;
  await w.fake.sceneAction('record_video', { phone, minutes: '10' });
  const { device, feature } = featureOf(w, 'kitchen', 'recording');
  await w.fake.setValue(device, feature, 0);
  assert.deepEqual(w.hub.saved.recordings, {});
  // Started again by hand, it is not stopped when the old timer would have.
  await w.fake.setValue(device, feature, 1);
  w.clock.advance(15 * 60_000);
  await w.hub.refresh();
  assert.equal(w.phones.kitchen.recording, true);
});

test('a phone off at start keeps its features from /data', async (t) => {
  const clock = createClock();
  const first = await createWorld({ clock });
  await first.app.stop();
  const phones = first.phones;
  phones.kitchen.online = false;
  const w = await world(t, { clock, phones, dataDir: first.dataDir });
  const keys = w.fake.discoveredDevices[0].features.map((f) => f.external_id.split(':').pop());
  assert.ok(keys.includes('battery') && keys.includes('pressure'));
});

test('a fresh image on request: Gladys, the scene action; an error when the phone fails', async (t) => {
  const w = await world(t);
  await createAll(w);
  const phone = ids(w.gladys, 'kitchen').device;
  const device = w.fake.discoveredDevices[0];
  const image = await w.fake.getImage(device);
  assert.equal(image.success, true);
  assert.match(image.data.image, /^image\/jpg;base64,/);
  const before = w.fake.cameraImages.length;
  const scene = await w.fake.sceneAction('take_image', { phone });
  assert.equal(scene.success, true);
  assert.equal(w.fake.cameraImages.length, before + 1, 'never the image of 5 s ago');
  w.phones.kitchen.shotCode = 500;
  const failed = await w.fake.sceneAction('take_image', { phone });
  assert.equal(failed.success, false);
  assert.match(failed.error, /did not send an image/);
  const unknown = await w.fake.sceneAction('take_image', { phone: 'ext:test-integration:phone:x' });
  assert.match(unknown.error, /not \(or no longer\) one of the configured phones/);
});

test('images are spaced: two requests within 5 s share one frame', async (t) => {
  const w = await world(t);
  await createAll(w);
  const device = w.fake.discoveredDevices[0];
  const shots = () => w.phones.kitchen.requests.filter((r) => r.path === '/shot.jpg').length;
  w.clock.advance(HUB_TIMINGS.imageSpacingMs);
  const before = shots();
  await Promise.all([w.fake.getImage(device), w.fake.getImage(device)]);
  await w.fake.getImage(device);
  assert.equal(shots(), before + 1);
});

test('the stream address holds no password', async (t) => {
  const w = await world(t);
  await createAll(w);
  const ack = await w.fake.action('stream_url', { phone: ids(w.gladys, 'kitchen').device });
  assert.match(ack.data.message.en, /rtsp:\/\/gladys:PASSWORD@192\.0\.2\.10:8080\/h264_aac\.sdp/);
  for (const text of Object.values(ack.data.message)) {
    assert.ok(!text.includes(BASE_CONFIG.password));
  }
  const missing = await w.fake.action('stream_url', {});
  assert.match(missing.error, /Choose a phone/);
});

test('a reconnection of Gladys sends everything again', async (t) => {
  const w = await world(t);
  await createAll(w);
  const count = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  await settle();
  assert.ok(w.fake.states.length > count, 'the states were sent again');
});
