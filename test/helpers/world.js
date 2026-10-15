// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, two fake phones (one with a
// login and every sensor, one recording, on another port), a temporary /data
// and a manual clock, with the integration wired on top through
// registerHandlers. No periodic timer runs unless `timers: true` (with
// node:test mock timers): the tests read the phones with `world.hub.refresh()`.
// (Adapted from guim31/gladys-dahua.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakePhone, PASSWORD, USERNAME, network } from './fakePhone.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const ORIGINS = {
  kitchen: 'http://192.0.2.10:8080',
  garage: 'http://192.0.2.11:8081',
};

export const KEYS = {
  kitchen: '192-0-2-10-8080',
  garage: '192-0-2-11-8081',
};

export const BASE_CONFIG = {
  hosts: '192.0.2.10, 192.0.2.11:8081',
  port: 8080,
  https: false,
  username: USERNAME,
  password: PASSWORD,
  refresh_interval: '10',
  snapshot_interval: '60',
  allow_motion_detection_off: false,
  language: 'en',
};

/** A manual clock. */
export function createClock(start = Date.UTC(2026, 9, 15, 18, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/** Let the handlers and the fake network settle. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export function createPhones(clock) {
  return {
    kitchen: new FakePhone({
      sensors: 'sensors-extended.json',
      username: USERNAME,
      password: PASSWORD,
      now: clock.now,
    }),
    garage: new FakePhone({ status: 'status-avail-recording.json', now: clock.now }),
  };
}

/**
 * @param {object} [options]
 * @param {object} [options.phones] fake phones by name
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.created] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers]
 * @param {object} [options.timings] HUB_TIMINGS overrides
 * @param {object} [options.origins] address of each fake phone, by name
 */
export async function createWorld({
  clock = createClock(),
  phones,
  config = BASE_CONFIG,
  created = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-ip-webcam-')),
  timings = {},
  timers = false,
  toImage,
  origins = ORIGINS,
} = {}) {
  const fakePhones = phones ?? createPhones(clock);
  const gladys = createFakeGladys({ config, devices: created });
  const request = network(
    Object.fromEntries(Object.entries(fakePhones).map(([name, phone]) => [origins[name], phone])),
  );
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request,
    timers,
    timings: { pulseMs: 50, eventImageWaitMs: 200, ...timings },
    now: clock.now,
    toImage,
  });
  const world = {
    gladys,
    fake: gladys.fake,
    phones: fakePhones,
    app,
    hub: app.hub,
    clock,
    dataDir,
  };
  if (connect) {
    await gladys.connect();
    await app.ready;
    await settle();
  }
  return world;
}

/** External ids of a phone of the world. */
export const ids = (gladys, name) => gladys.externalIds('phone', KEYS[name]);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await settle();
}

export { FakePhone, PASSWORD, USERNAME };
