// -----------------------------------------------------------------------------
// The Gladys devices: one per phone running IP Webcam.
//
// Identity: the app exposes no serial number, no MAC, no name. The only stable
// identity is the address and port typed in the configuration:
// `gladys.externalIds('phone', '192-0-2-10-8080')`. A phone that changes
// address is a new device: the documentation asks for a fixed address (a DHCP
// reservation). Feature keys are permanent once published.
//
// Features, each one only when the phone has it (test/gladys-rules.test.js
// checks the couples against the core table):
//   image                camera/image                     /shot.jpg
//   online               input/binary                     the phone answers (On/Off)
//   battery              battery/integer %                battery_level
//   charging             battery/charging                 battery_charging (when the app sends it)
//   battery_temperature  device-temperature-sensor/decimal battery_temp, °C
//   light                light-sensor/decimal lux         light
//   sound                noise-sensor/integer             sound: the loudest sample since the last read
//   motion               motion-sensor/binary             motion_active (the app's own detection)
//   proximity            distance-sensor/decimal cm       proximity
//   pressure             pressure-sensor/decimal hPa      pressure
//   motion_detection     input/binary                     motion_detect setting, READ ONLY: turning
//                                                         it off disarms the phone, so it is a scene
//                                                         action allowed in the configuration, never a
//                                                         switch (src/scenes.js)
//   torch                light/binary                     /enabletorch, /disabletorch
//   focus                switch/binary                    /focus (hold), /nofocus (continuous)
//   night_vision         switch/binary                    night_vision setting
//   recording            switch/binary                    /startvideo, /stopvideo
//   orientation          text/select                      orientation setting
//   quality              text/select                      quality setting (JPEG quality, %)
// "Online" and "motion detection" are input/binary (On/Off): a
// presence-sensor would read "Presence detected".
// The sound level has no unit: the app reports it on its own relative scale
// (about 180 in a quiet room in the Home Assistant fixture), not in calibrated
// decibels, and the front knows no decibel unit.
//
// The devices are published with should_poll: false: the integration reads
// the phones on its own timer (src/hub.js), never waiting for Gladys to poll
// (GladysAssistant/Gladys#3198).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { ORIENTATIONS } from './ipwebcam/client.js';
import { SENSORS } from './ipwebcam/model.js';

export const DEVICE_TYPE = 'phone';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  IMAGE: 'image',
  ONLINE: 'online',
  BATTERY: 'battery',
  CHARGING: 'charging',
  BATTERY_TEMPERATURE: 'battery_temperature',
  LIGHT: 'light',
  SOUND: 'sound',
  MOTION: 'motion',
  PROXIMITY: 'proximity',
  PRESSURE: 'pressure',
  MOTION_DETECTION: 'motion_detection',
  TORCH: 'torch',
  FOCUS: 'focus',
  NIGHT_VISION: 'night_vision',
  RECORDING: 'recording',
  ORIENTATION: 'orientation',
  QUALITY: 'quality',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    image: 'Image',
    online: 'Online',
    battery: 'Battery',
    charging: 'Charging',
    battery_temperature: 'Battery temperature',
    light: 'Light level',
    sound: 'Sound level',
    motion: 'Motion',
    proximity: 'Proximity',
    pressure: 'Pressure',
    motion_detection: 'Motion detection',
    torch: 'Torch',
    focus: 'Focus lock',
    night_vision: 'Night vision',
    recording: 'Video recording',
    orientation: 'Orientation',
    quality: 'Image quality',
  },
  fr: {
    image: 'Image',
    online: 'En ligne',
    battery: 'Batterie',
    charging: 'En charge',
    battery_temperature: 'Température de la batterie',
    light: 'Luminosité',
    sound: 'Niveau sonore',
    motion: 'Mouvement',
    proximity: 'Proximité',
    pressure: 'Pression',
    motion_detection: 'Détection de mouvement',
    torch: 'Lampe torche',
    focus: 'Mise au point fixe',
    night_vision: 'Vision nocturne',
    recording: 'Enregistrement vidéo',
    orientation: 'Orientation',
    quality: "Qualité d'image",
  },
  de: {
    image: 'Bild',
    online: 'Online',
    battery: 'Akku',
    charging: 'Lädt',
    battery_temperature: 'Akkutemperatur',
    light: 'Helligkeit',
    sound: 'Lautstärke',
    motion: 'Bewegung',
    proximity: 'Nähe',
    pressure: 'Luftdruck',
    motion_detection: 'Bewegungserkennung',
    torch: 'Taschenlampe',
    focus: 'Fokussperre',
    night_vision: 'Nachtsicht',
    recording: 'Videoaufnahme',
    orientation: 'Ausrichtung',
    quality: 'Bildqualität',
  },
  es: {
    image: 'Imagen',
    online: 'En línea',
    battery: 'Batería',
    charging: 'Cargando',
    battery_temperature: 'Temperatura de la batería',
    light: 'Luminosidad',
    sound: 'Nivel de sonido',
    motion: 'Movimiento',
    proximity: 'Proximidad',
    pressure: 'Presión',
    motion_detection: 'Detección de movimiento',
    torch: 'Linterna',
    focus: 'Bloqueo de enfoque',
    night_vision: 'Visión nocturna',
    recording: 'Grabación de vídeo',
    orientation: 'Orientación',
    quality: 'Calidad de imagen',
  },
};

// Options of `orientation` (values of the app, permanent once published).
export const ORIENTATION_NAMES = {
  en: {
    landscape: 'Landscape',
    upsidedown: 'Landscape, upside down',
    portrait: 'Portrait',
    upsidedown_portrait: 'Portrait, upside down',
  },
  fr: {
    landscape: 'Paysage',
    upsidedown: 'Paysage inversé',
    portrait: 'Portrait',
    upsidedown_portrait: 'Portrait inversé',
  },
  de: {
    landscape: 'Querformat',
    upsidedown: 'Querformat, gedreht',
    portrait: 'Hochformat',
    upsidedown_portrait: 'Hochformat, gedreht',
  },
  es: {
    landscape: 'Horizontal',
    upsidedown: 'Horizontal invertida',
    portrait: 'Vertical',
    upsidedown_portrait: 'Vertical invertida',
  },
};

// Options of `quality`: the JPEG quality of the app, in %. The phone may hold
// any value from 1 to 100: the nearest option is shown.
export const QUALITIES = Object.freeze(['30', '50', '70', '90', '100']);

// Bounds of the numeric features: display bounds (the core never enforces
// them on a state); a reading outside is clamped.
const RANGES = {
  battery: [0, 100],
  battery_temperature: [-20, 90],
  light: [0, 200_000],
  sound: [0, 1000],
  proximity: [0, 1000],
  pressure: [300, 1100],
};

const binarySensor = (category) => ({
  category,
  type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1,
});

const measure = (category, type, key, unit) => ({
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: RANGES[key][0],
  max: RANGES[key][1],
  ...(unit ? { unit } : {}),
});

const command = (category, type, hasFeedback = true) => ({
  category,
  type,
  read_only: false,
  // The app reports the torch, night vision and recording back in its
  // status; it never reports the focus hold.
  has_feedback: hasFeedback,
  keep_history: true,
  min: 0,
  max: 1,
});

const select = () => ({
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
  read_only: false,
  has_feedback: true,
  keep_history: true,
  // NOT NULL in Gladys even for a text feature.
  min: 0,
  max: 0,
});

const DEFINITIONS = {
  [FEATURE_KEYS.IMAGE]: {
    category: DEVICE_FEATURE_CATEGORIES.CAMERA,
    type: DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
    read_only: true,
    has_feedback: false,
    // Images travel on their own channel, never in the states history.
    keep_history: false,
    min: 0,
    max: 0,
  },
  [FEATURE_KEYS.ONLINE]: binarySensor(DEVICE_FEATURE_CATEGORIES.INPUT),
  [FEATURE_KEYS.BATTERY]: measure(
    DEVICE_FEATURE_CATEGORIES.BATTERY,
    DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
    'battery',
    DEVICE_FEATURE_UNITS.PERCENT,
  ),
  [FEATURE_KEYS.CHARGING]: {
    ...binarySensor(DEVICE_FEATURE_CATEGORIES.BATTERY),
    type: DEVICE_FEATURE_TYPES.BATTERY.CHARGING,
  },
  [FEATURE_KEYS.BATTERY_TEMPERATURE]: measure(
    DEVICE_FEATURE_CATEGORIES.DEVICE_TEMPERATURE_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    'battery_temperature',
    DEVICE_FEATURE_UNITS.CELSIUS,
  ),
  [FEATURE_KEYS.LIGHT]: measure(
    DEVICE_FEATURE_CATEGORIES.LIGHT_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    'light',
    DEVICE_FEATURE_UNITS.LUX,
  ),
  [FEATURE_KEYS.SOUND]: measure(
    DEVICE_FEATURE_CATEGORIES.NOISE_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    'sound',
  ),
  [FEATURE_KEYS.MOTION]: binarySensor(DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR),
  [FEATURE_KEYS.PROXIMITY]: measure(
    DEVICE_FEATURE_CATEGORIES.DISTANCE_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    'proximity',
    DEVICE_FEATURE_UNITS.CM,
  ),
  [FEATURE_KEYS.PRESSURE]: measure(
    DEVICE_FEATURE_CATEGORIES.PRESSURE_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    'pressure',
    DEVICE_FEATURE_UNITS.HECTO_PASCAL,
  ),
  [FEATURE_KEYS.MOTION_DETECTION]: binarySensor(DEVICE_FEATURE_CATEGORIES.INPUT),
  [FEATURE_KEYS.TORCH]: command(DEVICE_FEATURE_CATEGORIES.LIGHT, DEVICE_FEATURE_TYPES.LIGHT.BINARY),
  [FEATURE_KEYS.FOCUS]: command(
    DEVICE_FEATURE_CATEGORIES.SWITCH,
    DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    false,
  ),
  [FEATURE_KEYS.NIGHT_VISION]: command(
    DEVICE_FEATURE_CATEGORIES.SWITCH,
    DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  ),
  [FEATURE_KEYS.RECORDING]: command(
    DEVICE_FEATURE_CATEGORIES.SWITCH,
    DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  ),
  [FEATURE_KEYS.ORIENTATION]: select(),
  [FEATURE_KEYS.QUALITY]: select(),
};

/** External ids of a phone and its features. */
export const phoneIds = (gladys, phone) => gladys.externalIds(DEVICE_TYPE, phone.key);

/** The name of a phone in Gladys: the app has none to give. */
export const phoneName = (phone) => `IP Webcam ${phone.label}`;

/**
 * The feature keys of a phone, in display order.
 * @param {object} caps { sensors: string[], settings: string[] } (src/ipwebcam/model.js)
 */
export function featureKeys(caps) {
  const sensors = new Set(caps?.sensors ?? []);
  const settings = new Set(caps?.settings ?? []);
  return [
    FEATURE_KEYS.IMAGE,
    FEATURE_KEYS.ONLINE,
    sensors.has(SENSORS.BATTERY_LEVEL) && FEATURE_KEYS.BATTERY,
    sensors.has(SENSORS.BATTERY_CHARGING) && FEATURE_KEYS.CHARGING,
    sensors.has(SENSORS.BATTERY_TEMP) && FEATURE_KEYS.BATTERY_TEMPERATURE,
    sensors.has(SENSORS.LIGHT) && FEATURE_KEYS.LIGHT,
    sensors.has(SENSORS.SOUND) && FEATURE_KEYS.SOUND,
    (sensors.has(SENSORS.MOTION_ACTIVE) || settings.has('motionDetect')) && FEATURE_KEYS.MOTION,
    sensors.has(SENSORS.PROXIMITY) && FEATURE_KEYS.PROXIMITY,
    sensors.has(SENSORS.PRESSURE) && FEATURE_KEYS.PRESSURE,
    settings.has('motionDetect') && FEATURE_KEYS.MOTION_DETECTION,
    settings.has('torch') && FEATURE_KEYS.TORCH,
    FEATURE_KEYS.FOCUS,
    settings.has('nightVision') && FEATURE_KEYS.NIGHT_VISION,
    FEATURE_KEYS.RECORDING,
    settings.has('orientation') && FEATURE_KEYS.ORIENTATION,
    settings.has('quality') && FEATURE_KEYS.QUALITY,
  ].filter(Boolean);
}

/** The orientations offered: the app's list when it gives one, else the four known. */
function orientations(caps) {
  const listed = (caps?.orientations ?? []).filter((value) => ORIENTATIONS.includes(value));
  return listed.length > 0 ? ORIENTATIONS.filter((value) => listed.includes(value)) : ORIENTATIONS;
}

/**
 * The discovery payload of a phone.
 * @param {object} gladys SDK client
 * @param {object} phone { key, label, caps } (src/hub.js)
 * @param {object} [options] { language }
 */
export function buildDevice(gladys, phone, { language = 'en' } = {}) {
  const ids = phoneIds(gladys, phone);
  const names = NAMES[language] ?? NAMES.en;
  const orientationNames = ORIENTATION_NAMES[language] ?? ORIENTATION_NAMES.en;
  const options = {
    [FEATURE_KEYS.ORIENTATION]: orientations(phone.caps).map((value, index) => ({
      value,
      label: orientationNames[value],
      sort_order: index,
    })),
    [FEATURE_KEYS.QUALITY]: QUALITIES.map((value, index) => ({
      value,
      label: `${value} %`,
      sort_order: index,
    })),
  };
  return {
    name: phoneName(phone),
    external_id: ids.device,
    model: 'IP Webcam (Android)',
    should_poll: false,
    params: [{ name: 'address', value: phone.label }],
    features: featureKeys(phone.caps).map((key) => ({
      ...DEFINITIONS[key],
      name: names[key],
      external_id: ids.feature(key),
      ...(options[key] ? { supported_options: options[key] } : {}),
    })),
  };
}

const flag = (value) => (value === null || value === undefined ? null : value ? 1 : 0);

const clamp = (key, value, round) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const [min, max] = RANGES[key];
  const bounded = Math.min(max, Math.max(min, value));
  return round ? Math.round(bounded) : Math.round(bounded * 10) / 10;
};

/** The quality option nearest to a value of the app. */
export function nearestQuality(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return QUALITIES.reduce((best, option) =>
    Math.abs(Number(option) - value) < Math.abs(Number(best) - value) ? option : best,
  );
}

/**
 * The value of every feature of a phone (null: nothing to publish). Text
 * values are `{ text }`.
 * @param {object} live { online, readings, settings, recording, focus, motion }
 */
export function featureValues(live) {
  const readings = live.readings ?? {};
  const settings = live.settings ?? {};
  const quality = nearestQuality(settings.quality);
  return {
    [FEATURE_KEYS.ONLINE]: live.online ? 1 : 0,
    [FEATURE_KEYS.BATTERY]: clamp('battery', readings.battery, true),
    [FEATURE_KEYS.CHARGING]: flag(readings.charging),
    [FEATURE_KEYS.BATTERY_TEMPERATURE]: clamp('battery_temperature', readings.batteryTemperature),
    [FEATURE_KEYS.LIGHT]: clamp('light', readings.light),
    [FEATURE_KEYS.SOUND]: clamp('sound', readings.sound, true),
    [FEATURE_KEYS.MOTION]: flag(live.motion),
    [FEATURE_KEYS.PROXIMITY]: clamp('proximity', readings.proximity),
    [FEATURE_KEYS.PRESSURE]: clamp('pressure', readings.pressure),
    [FEATURE_KEYS.MOTION_DETECTION]: flag(settings.motionDetect),
    [FEATURE_KEYS.TORCH]: flag(settings.torch),
    [FEATURE_KEYS.FOCUS]: flag(live.focus ?? false),
    [FEATURE_KEYS.NIGHT_VISION]: flag(settings.nightVision),
    [FEATURE_KEYS.RECORDING]: flag(live.recording),
    [FEATURE_KEYS.ORIENTATION]: ORIENTATIONS.includes(settings.orientation)
      ? { text: settings.orientation }
      : null,
    [FEATURE_KEYS.QUALITY]: quality ? { text: quality } : null,
  };
}
