#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real phone running IP Webcam, with the very client of
// the integration: what the integration would see, without Gladys.
//
//   [IPWEBCAM_USER=… IPWEBCAM_PASSWORD=…] node scripts/probe.mjs <address> [seconds]
//
// <address> as in the configuration: 192.168.1.50, 192.168.1.50:8080,
// https://192.168.1.50:8080. It reads /status.json?show_avail=1 (every
// setting, its choices, the video status), /sensors.json (every sensor the
// app logs, unit, number of samples, last value), takes one frame of
// /shot.jpg, and prints what the integration makes of it (the features of the
// device). With [seconds], it then reads again every 2 seconds and prints
// what changes: move in front of the phone, make noise, start a recording in
// the app, plug or unplug the charger.
//
// It writes nothing to the phone: no torch, no setting, no recording. It
// prints neither the password nor the address the phone reports for itself.
//
// Not part of the Docker image (only index.js and src/ are copied).
// -----------------------------------------------------------------------------

import { parseHost } from '../src/config.js';
import { featureKeys } from '../src/devices.js';
import { jpegSize } from '../src/image.js';
import { IpWebcamClient } from '../src/ipwebcam/client.js';
import { capabilities, latest, parseSensors, parseStatus } from '../src/ipwebcam/model.js';

const [address, seconds = '0'] = process.argv.slice(2);
const username = process.env.IPWEBCAM_USER ?? '';
const password = process.env.IPWEBCAM_PASSWORD ?? '';
const host = parseHost(address);
if (!host || Boolean(username) !== Boolean(password)) {
  console.error(
    'Usage: [IPWEBCAM_USER=… IPWEBCAM_PASSWORD=…] node scripts/probe.mjs <address> [seconds]',
  );
  process.exit(2);
}

// The address the phone reports for itself is private: never printed.
const PRIVATE_SETTINGS = new Set(['ip_address']);
const line = (label, value) => console.log(`${label.padEnd(24)} ${value}`);

const client = new IpWebcamClient({ host: { ...host, username, password } });

async function read() {
  const started = Date.now();
  const rawStatus = await client.readStatus();
  const rawSensors = await client.readSensors();
  return { rawStatus, rawSensors, ms: Date.now() - started };
}

let first;
try {
  first = await read();
} catch (err) {
  console.error(`Cannot read ${host.label}: ${err.message} (${err.kind ?? 'error'})`);
  process.exit(1);
}

const { rawStatus, rawSensors } = first;
line('Address', host.label);
line('Status + sensors read', `${first.ms} ms`);
line('Video status', JSON.stringify(rawStatus.video_status ?? null));
line('Viewers', `video ${rawStatus.video_connections}, audio ${rawStatus.audio_connections}`);
line('Choices under', rawStatus.avail ? '`avail`' : 'the top level');
console.log('\nSettings (curvals):');
for (const [key, value] of Object.entries(rawStatus.curvals ?? {})) {
  line(`  ${JSON.stringify(key)}`, PRIVATE_SETTINGS.has(key) ? '(hidden)' : JSON.stringify(value));
}
console.log('\nChoices:');
const avail = rawStatus.avail ?? rawStatus;
for (const [key, value] of Object.entries(avail)) {
  if (Array.isArray(value)) {
    line(`  ${key}`, value.join(', '));
  }
}
console.log('\nSensors (sensors.json), every key the app sends:');
if (Object.keys(rawSensors).length === 0) {
  console.log('  none: "Data logging" is off in the app');
}
for (const [key, node] of Object.entries(rawSensors)) {
  const data = Array.isArray(node?.data) ? node.data : [];
  const last = data.at(-1);
  const span = data.length > 1 ? `${Math.round((data.at(-1)[0] - data[0][0]) / 1000)} s` : '-';
  line(
    `  ${key}`,
    `unit ${JSON.stringify(node?.unit ?? null)}, ${data.length} sample(s) over ${span}, last ${JSON.stringify(last?.[1] ?? null)}`,
  );
}

const status = parseStatus(rawStatus);
const sensors = parseSensors(rawSensors);
const caps = capabilities(status, sensors);
console.log('\nWhat the integration makes of it:');
line('  Recording', String(status.recording));
line('  Settings read', JSON.stringify(status.settings));
line('  Features', featureKeys(caps).join(', '));

try {
  const started = Date.now();
  const bytes = await client.shot();
  const size = jpegSize(bytes);
  line(
    '\nFrame /shot.jpg',
    `${Math.round(bytes.length / 1024)} KB, ${size ? `${size.width}×${size.height}` : 'not a JPEG'}, ${Date.now() - started} ms`,
  );
} catch (err) {
  line('\nFrame /shot.jpg', `failed: ${err.message}`);
}

const watchMs = Number(seconds) * 1000;
if (watchMs > 0) {
  console.log(`\nWatching for ${seconds} s (move, make noise, record, plug the charger)…`);
  const watched = ['motion_active', 'sound', 'battery_level', 'battery_charging', 'light'];
  let before = '';
  const end = Date.now() + watchMs;
  while (Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const { rawStatus: s, rawSensors: n } = await read();
      const parsed = parseSensors(n);
      const now = JSON.stringify({
        mode: s.video_status?.mode,
        torch: s.curvals?.torch,
        motion_detect: s.curvals?.motion_detect,
        ...Object.fromEntries(watched.map((key) => [key, latest(parsed, key)?.v ?? null])),
        sound_samples: parsed.get('sound')?.samples.length ?? 0,
        motion_samples: (parsed.get('motion_active')?.samples ?? []).map((x) => x.v).join(''),
      });
      if (now !== before) {
        console.log(`${new Date().toISOString()} ${now}`);
        before = now;
      }
    } catch (err) {
      console.log(`${new Date().toISOString()} read failed: ${err.message}`);
    }
  }
}
console.log('\nDone. Nothing was written to the phone.');
process.exit(0);
