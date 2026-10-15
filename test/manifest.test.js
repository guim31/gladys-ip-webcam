// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// (Adapted from the template and guim31/gladys-dahua.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES, REFRESH_INTERVALS, SNAPSHOT_INTERVALS } from '../src/config.js';
import { WIDGET_KEY } from '../src/hub.js';
import {
  DEFAULT_RECORDING_MINUTES,
  MOTION_STATES,
  RECORDING_MINUTES,
  SCENE_ACTIONS,
} from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { BASE_CONFIG, createAll, createWorld, ids } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, cover, local transport, security category', () => {
  assert.equal(manifest.name, 'IP Webcam');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-ip-webcam:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-ip-webcam/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['security']);
  assert.equal(manifest.network_discovery, undefined);
});

test('the intro says the integration is not affiliated with the app', () => {
  const intro = manifest.config_schema.find((field) => field.key === 'intro');
  assert.match(intro.description.en, /not affiliated with the IP Webcam app/);
});

test('every manifest action has a handler', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  assert.deepEqual(keysOf(manifest.actions), ['test_connection', 'stream_url']);
  const fields = { stream_url: { phone: ids(world.gladys, 'kitchen').device } };
  for (const action of manifest.actions) {
    const ack = await world.fake.action(action.key, fields[action.key] ?? {});
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
  }
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION));
});

test('scene actions and widgets require Gladys >= 5.1.0; no trigger duplicates a state', () => {
  assert.ok(manifest.scene_actions.length > 0);
  assert.ok(manifest.widgets.length > 0);
  assert.ok(isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION));
  // Motion and sound are device states: the scenes of Gladys trigger on them
  // (with a threshold for the sound). No scene trigger repeats them.
  assert.equal(manifest.scene_triggers, undefined);
});

test('no widget button opens a form: Gladys 5.1.0 is enough', async (t) => {
  assert.equal(manifest.gladys_version, '>=5.1.0');
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  for (const name of ['kitchen', 'garage']) {
    const ack = await world.fake.widgetGet(WIDGET_KEY, {
      settings: { phone: ids(world.gladys, name).device },
      language: 'en',
    });
    const buttons = ack.data.content.components.filter((c) => c.type === 'button');
    assert.ok(buttons.length > 0);
    assert.ok(buttons.every((button) => button.action && button.action.fields === undefined));
  }
});

test('every scene_actions key has a handler, and returns the declared outputs', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  const world = await createWorld({
    config: { ...BASE_CONFIG, allow_motion_detection_off: true },
  });
  t.after(() => world.app.stop());
  await createAll(world);
  const phone = ids(world.gladys, 'kitchen').device;
  const fields = {
    take_image: { phone },
    record_video: { phone, minutes: '1' },
    stop_recording: { phone },
    set_motion_detection: { phone, state: 'off' },
  };
  for (const action of manifest.scene_actions) {
    const ack = await world.fake.sceneAction(action.key, fields[action.key]);
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data?.outputs ?? {}).sort(),
      keysOf(action.outputs).sort(),
      `${action.key} outputs`,
    );
  }
});

test('the scene fields match the code; turning detection off is disabled by default', () => {
  const record = manifest.scene_actions.find((entry) => entry.key === 'record_video');
  const minutes = record.fields.find((field) => field.key === 'minutes');
  assert.deepEqual(
    minutes.options.map((option) => option.value),
    RECORDING_MINUTES,
  );
  assert.equal(minutes.default, DEFAULT_RECORDING_MINUTES);
  const motion = manifest.scene_actions.find((entry) => entry.key === 'set_motion_detection');
  const state = motion.fields.find((field) => field.key === 'state');
  assert.deepEqual(
    state.options.map((option) => option.value),
    MOTION_STATES,
  );
  assert.equal(state.default, 'on');
  const allow = manifest.config_schema.find((field) => field.key === 'allow_motion_detection_off');
  assert.equal(allow.type, 'boolean');
  assert.equal(allow.default, false, 'disarming is disabled by default');
});

test('every widgets key has a handler', async (t) => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {} });
  assert.equal(ack.success, true, ack.error);
});

test('config_schema defaults and options stay consistent with the code', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
  const options = (key) =>
    manifest.config_schema.find((f) => f.key === key).options.map((o) => o.value);
  assert.deepEqual(options('language'), LANGUAGES);
  assert.deepEqual(options('refresh_interval'), REFRESH_INTERVALS);
  assert.deepEqual(options('snapshot_interval'), SNAPSHOT_INTERVALS);
  assert.equal(DEFAULT_CONFIG.language, 'fr');
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((f) => f.type !== 'section')
      .map((f) => f.key)
      .sort(),
  );
  assert.equal(manifest.config_schema.find((f) => f.key === 'password').type, 'secret');
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `field "${field.key}".${key} must be an integer`);
      }
    }
  }
});

test('actions declare no secret field, no required field (no default is applied)', () => {
  // Gladys#3154/#3155: a secret in an action form cannot be filled, and an
  // action applies no default while enforcing `required`.
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret');
      assert.notEqual(field.required, true);
    }
  }
});

test('a required scene action field has a default, or names a device', () => {
  for (const action of manifest.scene_actions) {
    for (const field of action.fields ?? []) {
      if (field.required) {
        assert.ok(field.default !== undefined || field.source === 'devices', field.key);
      }
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('field placeholders are multi-language objects', () => {
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', field.key);
    assert.equal(typeof field.placeholder.en, 'string', field.key);
  }
});
