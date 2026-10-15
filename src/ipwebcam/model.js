// -----------------------------------------------------------------------------
// What the answers of IP Webcam mean (test/fixtures/ipwebcam, from the tests of
// the Home Assistant integration `android_ip_webcam`).
//
// /status.json?show_avail=1:
//   { video_connections, audio_connections,
//     video_status: { result, enabled, mode },
//     curvals: { torch: "off", night_vision: "off", motion_detect: "on",
//                orientation: "landscape", quality: "49", … },   all strings
//     avail: { night_vision: ["on", "off"], … } }
//   The choices sit under `avail` (as pydroid-ipcam reads them) or, in the
//   answer Home Assistant keeps as fixture, at the top level: both are read.
//   A setting exists on this phone when its key is in `curvals`.
//
// /sensors.json:
//   { light: { unit: "lx", data: [[timestamp_ms, [708.0]], …] }, … }
//   Only the sensors the app logs (its "Data logging" option) are present;
//   `{}` when logging is off. `data` holds the recent samples, oldest first,
//   timestamps of the phone clock in milliseconds.
// -----------------------------------------------------------------------------

// The sensors of /sensors.json read here, by key of the app.
export const SENSORS = Object.freeze({
  BATTERY_LEVEL: 'battery_level',
  // Not in the Home Assistant fixture: read when the app sends it.
  BATTERY_CHARGING: 'battery_charging',
  BATTERY_TEMP: 'battery_temp',
  LIGHT: 'light',
  SOUND: 'sound',
  MOTION_ACTIVE: 'motion_active',
  PROXIMITY: 'proximity',
  PRESSURE: 'pressure',
});

// The settings of `curvals` read and written here.
export const SETTINGS = Object.freeze({
  TORCH: 'torch',
  NIGHT_VISION: 'night_vision',
  MOTION_DETECT: 'motion_detect',
  ORIENTATION: 'orientation',
  QUALITY: 'quality',
});

const KNOWN_SENSORS = new Set(Object.values(SENSORS));
const KNOWN_SETTINGS = new Set(Object.values(SETTINGS));

const onOff = (value) => {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  if (text === 'on') {
    return true;
  }
  if (text === 'off') {
    return false;
  }
  return null;
};

/**
 * @param {object} json the answer of /status.json?show_avail=1
 * @returns {{ settings: object, available: object, recording: boolean|null,
 *   viewers: number|null }}
 */
export function parseStatus(json) {
  const curvals = json?.curvals;
  if (!curvals || typeof curvals !== 'object') {
    throw new Error('No settings (curvals) in /status.json');
  }
  const settings = {};
  if (SETTINGS.TORCH in curvals) {
    settings.torch = onOff(curvals.torch);
  }
  if (SETTINGS.NIGHT_VISION in curvals) {
    settings.nightVision = onOff(curvals.night_vision);
  }
  if (SETTINGS.MOTION_DETECT in curvals) {
    settings.motionDetect = onOff(curvals.motion_detect);
  }
  if (SETTINGS.ORIENTATION in curvals) {
    settings.orientation = String(curvals.orientation);
  }
  if (SETTINGS.QUALITY in curvals) {
    const quality = Number(curvals.quality);
    settings.quality = Number.isFinite(quality) ? quality : null;
  }
  const avail = json.avail && typeof json.avail === 'object' ? json.avail : json;
  const available = {};
  for (const key of KNOWN_SETTINGS) {
    if (Array.isArray(avail[key])) {
      available[key] = avail[key].map(String);
    }
  }
  // `mode` is "none" while nothing records. The values while recording are
  // not documented: anything else counts as recording (scripts/probe.mjs
  // prints it on a real phone).
  const mode = json.video_status?.mode;
  const recording =
    typeof mode === 'string' && mode.trim() !== '' ? mode.trim().toLowerCase() !== 'none' : null;
  const viewers = Number(json.video_connections);
  return {
    settings,
    available,
    recording,
    viewers: Number.isFinite(viewers) ? viewers : null,
  };
}

/**
 * @param {object} json the answer of /sensors.json
 * @returns {Map<string, { unit: string, samples: Array<{ t: number, v: number }> }>}
 *   the known sensors with at least one numeric sample, oldest first
 */
export function parseSensors(json) {
  const sensors = new Map();
  if (!json || typeof json !== 'object') {
    return sensors;
  }
  for (const [key, node] of Object.entries(json)) {
    if (!KNOWN_SENSORS.has(key) || !Array.isArray(node?.data)) {
      continue;
    }
    const samples = [];
    for (const entry of node.data) {
      if (!Array.isArray(entry)) {
        continue;
      }
      const [t, values] = entry;
      const v = Array.isArray(values) ? Number(values[0]) : Number(values);
      if (Number.isFinite(Number(t)) && Number.isFinite(v)) {
        samples.push({ t: Number(t), v });
      }
    }
    if (samples.length > 0) {
      samples.sort((a, b) => a.t - b.t);
      sensors.set(key, { unit: typeof node.unit === 'string' ? node.unit : '', samples });
    }
  }
  return sensors;
}

/** The capabilities of a phone: what its devices show. Saved in /data. */
export function capabilities(status, sensors) {
  return {
    sensors: [...sensors.keys()].filter((key) => KNOWN_SENSORS.has(key)).sort(),
    settings: Object.keys(status.settings).sort(),
    orientations: status.available.orientation ?? null,
  };
}

/** The latest sample of a sensor, null when absent. */
export function latest(sensors, key) {
  const samples = sensors.get(key)?.samples;
  return samples?.length ? samples[samples.length - 1] : null;
}

/** The samples of a sensor newer than `since` (all of them when `since` is null). */
export function samplesSince(sensors, key, since) {
  const samples = sensors.get(key)?.samples ?? [];
  return since === null || since === undefined
    ? samples
    : samples.filter((sample) => sample.t > since);
}

/** A temperature in °C whatever the unit the app reports ("℃" in the fixture). */
export function celsius(value, unit) {
  const text = String(unit ?? '').trim();
  return text === '℉' || /^°?\s*f$/i.test(text) ? ((value - 32) * 5) / 9 : value;
}
