// -----------------------------------------------------------------------------
// The answers of IP Webcam (fixtures of the Home Assistant integration) and
// what they mean: settings, choices, recording, sensors and their samples.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capabilities,
  celsius,
  latest,
  parseSensors,
  parseStatus,
  samplesSince,
} from '../src/ipwebcam/model.js';
import { fixture } from './helpers/fakePhone.js';

test('the status of the Home Assistant fixture: settings, top-level choices, not recording', () => {
  const status = parseStatus(fixture('status.json'));
  assert.deepEqual(status.settings, {
    torch: false,
    nightVision: false,
    motionDetect: true,
    orientation: 'landscape',
    quality: 49,
  });
  assert.deepEqual(status.available.night_vision, ['on', 'off']);
  assert.equal(status.available.orientation, undefined);
  assert.equal(status.recording, false);
  assert.equal(status.viewers, 0);
});

test('the status with its choices under `avail`, recording', () => {
  const status = parseStatus(fixture('status-avail-recording.json'));
  assert.equal(status.settings.torch, true);
  assert.equal(status.settings.quality, 90);
  assert.deepEqual(status.available.orientation, [
    'landscape',
    'upsidedown',
    'portrait',
    'upsidedown_portrait',
  ]);
  assert.equal(status.recording, true);
});

test('a status without settings is not IP Webcam; an unknown video mode is unknown', () => {
  assert.throws(() => parseStatus({}), /curvals/);
  assert.throws(() => parseStatus(null), /curvals/);
  const status = parseStatus({ curvals: { torch: 'maybe' } });
  assert.equal(status.settings.torch, null);
  assert.equal(status.recording, null);
});

test('the sensors: known keys only, samples sorted, values of the first axis', () => {
  const sensors = parseSensors(fixture('sensors.json'));
  assert.deepEqual(
    [...sensors.keys()].sort(),
    ['battery_level', 'battery_temp', 'light', 'motion_active', 'proximity', 'sound'],
    '`motion` (the raw level) and `battery_voltage` are not read',
  );
  assert.equal(latest(sensors, 'light').v, 991);
  assert.equal(sensors.get('battery_temp').unit, '℃');
  assert.equal(sensors.get('sound').samples.length, 10);
  const since = sensors.get('sound').samples[7].t;
  assert.deepEqual(
    samplesSince(sensors, 'sound', since).map((s) => s.v),
    [186, 178],
  );
  assert.equal(samplesSince(sensors, 'sound', null).length, 10);
  assert.equal(latest(sensors, 'pressure'), null);
});

test('a malformed sample is skipped; no logging means no sensor', () => {
  const sensors = parseSensors({
    light: { unit: 'lx', data: [[1, ['x']], 'bad', [3, [12]], [2, 10]] },
    gyro: { unit: '', data: [[1, [1, 2, 3]]] },
    proximity: { data: 'nope' },
  });
  assert.deepEqual(sensors.get('light').samples, [
    { t: 2, v: 10 },
    { t: 3, v: 12 },
  ]);
  assert.equal(sensors.size, 1);
  assert.equal(parseSensors(fixture('sensors-empty.json')).size, 0);
});

test('capabilities list what the devices show', () => {
  const caps = capabilities(
    parseStatus(fixture('status.json')),
    parseSensors(fixture('sensors-extended.json')),
  );
  assert.deepEqual(caps.sensors, [
    'battery_charging',
    'battery_level',
    'battery_temp',
    'light',
    'motion_active',
    'pressure',
    'proximity',
    'sound',
  ]);
  assert.deepEqual(caps.settings, [
    'motionDetect',
    'nightVision',
    'orientation',
    'quality',
    'torch',
  ]);
  assert.equal(caps.orientations, null);
});

test('battery temperatures in °C', () => {
  assert.equal(celsius(33.9, '℃'), 33.9);
  assert.equal(celsius(33.9, '°C'), 33.9);
  assert.equal(Math.round(celsius(95, '℉')), 35);
  assert.equal(Math.round(celsius(95, '°F')), 35);
  assert.equal(celsius(20, ''), 20);
});
