// -----------------------------------------------------------------------------
// The configuration as typed by the user: addresses with or without a port or
// a scheme, the identity of each phone, credentials, intervals.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHost, parseHosts } from '../src/config.js';

test('an address takes the configured port and scheme unless it gives its own', () => {
  assert.deepEqual(parseHost('192.0.2.10'), {
    origin: 'http://192.0.2.10:8080',
    label: '192.0.2.10:8080',
    key: '192-0-2-10-8080',
  });
  assert.equal(parseHost('192.0.2.10', { port: 8081 }).origin, 'http://192.0.2.10:8081');
  assert.equal(parseHost('192.0.2.10:9000', { port: 8081 }).origin, 'http://192.0.2.10:9000');
  assert.equal(parseHost('192.0.2.10', { https: true }).origin, 'https://192.0.2.10:8080');
  assert.equal(parseHost('https://phone.lan').origin, 'https://phone.lan:8080');
  // A port equal to the default of the scheme stays explicit in the label.
  assert.deepEqual(parseHost('192.0.2.10', { port: 80 }), {
    origin: 'http://192.0.2.10',
    label: '192.0.2.10:80',
    key: '192-0-2-10-80',
  });
  assert.equal(parseHost('[2001:db8::10]').key, '2001-db8-10-8080');
});

test('the identity of a phone does not depend on the scheme or the case', () => {
  assert.equal(parseHost('Phone.LAN').key, parseHost('https://phone.lan:8080').key);
  assert.equal(parseHost('192.0.2.10', { https: true }).key, parseHost('192.0.2.10').key);
});

test('an address with credentials, a path or garbage is refused, never echoed', () => {
  for (const raw of ['user:pass@192.0.2.10', '192.0.2.10/video', 'ftp://192.0.2.10', 'a b', '']) {
    assert.equal(parseHost(raw), null, raw);
  }
  const { hosts, invalid } = parseHosts(
    '192.0.2.10, admin:secret@192.0.2.11; nope_host, 192.0.2.10',
  );
  assert.deepEqual(
    hosts.map((host) => host.label),
    ['192.0.2.10:8080'],
  );
  assert.deepEqual(invalid, ['…@…', 'nope_host']);
});

test('normalizeConfig fills the defaults and reads the fields', () => {
  const config = normalizeConfig({});
  assert.deepEqual(config.phones, []);
  assert.equal(config.refreshMs, 10_000);
  assert.equal(config.snapshotIntervalMs, 60_000);
  assert.equal(config.allowMotionDetectionOff, false);
  assert.equal(config.language, DEFAULT_CONFIG.language);
  assert.equal(config.credentialsIncomplete, false);

  const full = normalizeConfig({
    hosts: '192.0.2.10\n192.0.2.11:8081',
    port: '8082',
    https: 'true',
    username: ' gladys ',
    password: ' spaced ',
    refresh_interval: '30',
    snapshot_interval: '0',
    allow_motion_detection_off: true,
    language: 'de',
  });
  assert.deepEqual(
    full.phones.map((phone) => phone.origin),
    ['https://192.0.2.10:8082', 'https://192.0.2.11:8081'],
  );
  assert.equal(full.phones[0].username, 'gladys');
  assert.equal(full.phones[0].password, ' spaced ', 'a password is kept as typed');
  assert.equal(full.refreshMs, 30_000);
  assert.equal(full.snapshotIntervalMs, 0);
  assert.equal(full.allowMotionDetectionOff, true);
  assert.equal(full.language, 'de');
});

test('unknown choices fall back to the defaults; a lone user name is flagged', () => {
  const config = normalizeConfig({
    hosts: '192.0.2.10',
    port: 70000,
    refresh_interval: '1',
    snapshot_interval: 'x',
    language: 'it',
    username: 'gladys',
  });
  assert.equal(config.phones[0].origin, 'http://192.0.2.10:8080');
  assert.equal(config.refreshMs, 10_000);
  assert.equal(config.snapshotIntervalMs, 60_000);
  assert.equal(config.language, 'fr');
  assert.equal(config.credentialsIncomplete, true);
});
