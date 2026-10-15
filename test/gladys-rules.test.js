// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (test/fixtures/ipwebcam, after the Home Assistant integration): a
// phone with every sensor and a login, a phone recording with its choices
// under `avail`, a phone without data logging — before and after a short
// motion, a loud sound and commands, in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled, guim31/gladys-pihole and guim31/gladys-dahua.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BASE_CONFIG,
  FakePhone,
  ORIGINS,
  createAll,
  createClock,
  createPhones,
  createWorld,
} from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'English names', language: 'en' },
  { label: 'French names', language: 'fr' },
  { label: 'German names', language: 'de' },
  { label: 'Spanish names', language: 'es' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Two phones of the world, and a third without data logging on another address. */
function threePhones(clock) {
  const phones = createPhones(clock);
  phones.attic = new FakePhone({ sensors: 'sensors-empty.json', now: clock.now });
  return phones;
}

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const clock = createClock();
    const world = await createWorld({
      clock,
      phones: threePhones(clock),
      origins: { ...ORIGINS, attic: 'http://192.0.2.12:8080' },
      config: {
        ...BASE_CONFIG,
        hosts: `${BASE_CONFIG.hosts}, 192.0.2.12`,
        language: scenario.language,
      },
    });
    try {
      await createAll(world);
      // Events and commands, so the pulsed and commanded values exist too.
      clock.advance(10_000);
      world.phones.kitchen.shortMotion();
      world.phones.kitchen.sample('sound', 5000);
      await world.hub.refresh();
      for (const device of world.fake.discoveredDevices) {
        for (const feature of device.features.filter((f) => !f.read_only)) {
          const value = feature.type === 'select' ? feature.supported_options.at(-1).value : 1;
          const ack = await world.fake.setValue(device, feature, value);
          assert.equal(ack.success, true, `${feature.name}: ${ack.error}`);
        }
      }
      await sleep(80); // the pulse ends

      const devices = world.fake.discoveredDevices;
      assert.equal(devices.length, 3);
      const deviceIds = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          assert.equal(typeof feature.keep_history, 'boolean', `${at}: keep_history`);
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: unit ${feature.unit} for ${feature.category}`,
              );
            }
          }

          assert.ok(
            feature.external_id.startsWith(`${device.external_id}:`),
            `${at}: feature id outside its device`,
          );
          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // Every value published fits the declared bounds; images have none.
          if (feature.category === 'camera') {
            continue;
          }
          const states = world.fake.states.filter(
            (entry) => entry.device_feature_external_id === feature.external_id,
          );
          for (const state of states) {
            if (feature.category === 'text') {
              assert.equal(typeof state.text, 'string', `${at}: text state`);
              assert.ok(state.text.length > 0, `${at}: empty text`);
              if (feature.type === 'select') {
                assert.ok(
                  feature.supported_options.some((option) => option.value === state.text),
                  `${at}: ${state.text} is not an option`,
                );
              }
              continue;
            }
            const value = state.state;
            assert.equal(typeof value, 'number', `${at}: non-numeric state`);
            assert.ok(
              value >= feature.min && value <= feature.max,
              `${at}: ${value} out of bounds`,
            );
            if (feature.type === 'integer' || feature.type === 'binary' || feature.max === 1) {
              assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
            }
          }
        }
      }
    } finally {
      await world.app.stop();
    }
  });
}

test('every feature that has a value received one once the devices are added', async () => {
  const world = await createWorld();
  try {
    await createAll(world);
    const published = new Set(world.fake.states.map((state) => state.device_feature_external_id));
    const missing = world.fake.discoveredDevices
      .flatMap((device) => device.features)
      .filter((feature) => feature.category !== 'camera' && !published.has(feature.external_id))
      .map((feature) => feature.external_id);
    assert.deepEqual(missing, []);
  } finally {
    await world.app.stop();
  }
});

test('the opening of a select, the camera image and the security switch are as the core expects', async () => {
  const world = await createWorld();
  try {
    const [device] = world.fake.discoveredDevices;
    const byKey = Object.fromEntries(
      device.features.map((feature) => [feature.external_id.split(':').pop(), feature]),
    );
    assert.equal(byKey.image.category, 'camera');
    assert.equal(byKey.image.keep_history, false);
    // Turning the detection off disarms the phone: never a command feature.
    assert.equal(byKey.motion_detection.read_only, true);
    assert.equal(byKey.motion_detection.category, 'input');
    for (const key of ['orientation', 'quality']) {
      assert.ok(byKey[key].supported_options.length > 0, key);
      assert.equal(byKey[key].min, 0);
      assert.equal(byKey[key].max, 0);
    }
  } finally {
    await world.app.stop();
  }
});
