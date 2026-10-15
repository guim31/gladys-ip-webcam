// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `ip_webcam`.
//
// The use case: an old phone left on a shelf for months, plugged in day and
// night. What matters at a glance is whether it is up, charging, and not
// cooking its battery (a swollen battery is the classic end of such a phone).
//
//   - every phone (no setting): a tile "phones online 2/3", one status line per
//     phone (battery and its temperature, or offline), and a caption when a
//     battery is too hot;
//   - one phone (setting `phone`): its last image, battery and temperature
//     tiles (live when the device is added), a status (online, charging,
//     motion detection, recording) and three buttons: fresh image, torch,
//     recording.
//
// Budget (8 components, ≤ 2 texts, one focal component, one status, ≤ 4
// buttons). A choice in use is shown by its icon (`check-circle`), never by
// the `primary` style, invisible in dark mode (Gladys#3153).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { ACTION_TEXT, ERROR_TEXT, pick } from './texts.js';

// Above this, a lithium battery ages fast: the widget warns.
export const HOT_BATTERY_CELSIUS = 45;
// Below this, unplugged: the widget warns.
export const LOW_BATTERY_PERCENT = 20;

export const TEXT = {
  configure: {
    en: 'Enter the address of your phones running IP Webcam in the configuration of the integration.',
    fr: "Saisissez l'adresse de vos téléphones qui font tourner IP Webcam dans la configuration de l'intégration.",
    de: 'Gib die Adresse deiner Handys mit IP Webcam in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de sus teléfonos con IP Webcam en la configuración de la integración.',
  },
  unknown: {
    en: 'This phone is no longer configured: choose another one in the widget settings.',
    fr: "Ce téléphone n'est plus configuré : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieses Handy ist nicht mehr konfiguriert: Wähle ein anderes in den Widget-Einstellungen.',
    es: 'Este teléfono ya no está configurado: elija otro en la configuración del widget.',
  },
  waiting: {
    en: 'The phone has not answered yet.',
    fr: "Le téléphone n'a pas encore répondu.",
    de: 'Das Handy hat noch nicht geantwortet.',
    es: 'El teléfono aún no ha respondido.',
  },
  hot: {
    en: 'A battery is above 45 °C: give the phone air, or unplug it.',
    fr: 'Une batterie dépasse 45 °C : aérez le téléphone, ou débranchez-le.',
    de: 'Ein Akku ist über 45 °C: Gib dem Handy Luft oder zieh den Stecker.',
    es: 'Una batería supera los 45 °C: ventile el teléfono o desenchúfelo.',
  },
  online: {
    en: 'Phones online',
    fr: 'Téléphones en ligne',
    de: 'Handys online',
    es: 'Teléfonos en línea',
  },
  battery: { en: 'Battery', fr: 'Batterie', de: 'Akku', es: 'Batería' },
  temperature: { en: 'Battery temp.', fr: 'Temp. batterie', de: 'Akkutemp.', es: 'Temp. batería' },
  isOnline: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  isOffline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  state: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  charging: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },
  notCharging: { en: 'Not charging', fr: 'Pas en charge', de: 'Lädt nicht', es: 'Sin cargar' },
  power: { en: 'Power', fr: 'Alimentation', de: 'Strom', es: 'Alimentación' },
  security: { en: 'Motion detection', fr: 'Détection', de: 'Erkennung', es: 'Detección' },
  recording: { en: 'Recording', fr: 'Enregistrement', de: 'Aufnahme', es: 'Grabación' },
  on: { en: 'On', fr: 'Activée', de: 'An', es: 'Activada' },
  off: { en: 'Off', fr: 'Désactivée', de: 'Aus', es: 'Desactivada' },
  recordingOn: { en: 'In progress', fr: 'En cours', de: 'Läuft', es: 'En curso' },
  recordingOff: { en: 'Stopped', fr: 'Arrêté', de: 'Gestoppt', es: 'Detenida' },
  imageButton: { en: 'Image', fr: 'Image', de: 'Bild', es: 'Imagen' },
  torchButton: { en: 'Torch', fr: 'Lampe', de: 'Lampe', es: 'Linterna' },
  recordButton: { en: 'Record', fr: 'Enregistrer', de: 'Aufnehmen', es: 'Grabar' },
  stopButton: { en: 'Stop recording', fr: 'Arrêter', de: 'Stoppen', es: 'Detener' },
  imageAlt: { en: 'Last image', fr: 'Dernière image', de: 'Letztes Bild', es: 'Última imagen' },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

const isHot = (phone) =>
  phone.online &&
  phone.readings.batteryTemperature !== null &&
  phone.readings.batteryTemperature !== undefined &&
  phone.readings.batteryTemperature >= HOT_BATTERY_CELSIUS;

const isLow = (phone) =>
  phone.online &&
  Number.isFinite(phone.readings.battery) &&
  phone.readings.battery <= LOW_BATTERY_PERCENT &&
  phone.readings.charging !== true;

const number = (value, language) =>
  new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);

/** "87 % · 33,9 °C", what a status line of the overview says. */
export function batteryLine(phone, language) {
  if (!phone.online) {
    return t(TEXT.isOffline, language);
  }
  const parts = [];
  if (Number.isFinite(phone.readings.battery)) {
    parts.push(`${Math.round(phone.readings.battery)} %${phone.readings.charging ? ' ⚡' : ''}`);
  }
  if (Number.isFinite(phone.readings.batteryTemperature)) {
    parts.push(`${number(phone.readings.batteryTemperature, language)} °C`);
  }
  return parts.length > 0 ? parts.join(' · ') : t(TEXT.isOnline, language);
}

function overview(view, language) {
  const phones = view.phones;
  const online = phones.filter((phone) => phone.online).length;
  const components = [
    {
      type: 'value',
      value: `${online}/${phones.length}`,
      label: t(TEXT.online, language),
      icon: 'smartphone',
      color: online === phones.length ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
    },
  ];
  if (phones.some(isHot)) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.hot, language) });
  }
  components.push({
    type: 'status',
    items: phones.slice(0, 10).map((phone) => ({
      label: fit(phone.name, 40),
      icon: phone.online ? 'smartphone' : 'wifi-off',
      value: fit(batteryLine(phone, language), 40),
      color: !phone.online
        ? WIDGET_COLORS.DANGER
        : isHot(phone) || isLow(phone)
          ? WIDGET_COLORS.WARNING
          : WIDGET_COLORS.SUCCESS,
    })),
  });
  return { ttl_seconds: 60, components };
}

/** A tile: live from the device when it is added, else the value read. */
function tile(phone, key, value, unit, label, icon) {
  const color =
    key === FEATURE_KEYS.BATTERY_TEMPERATURE && isHot(phone) ? WIDGET_COLORS.WARNING : undefined;
  if (phone.created && phone.features.includes(key)) {
    return {
      type: 'value',
      device_feature: phone.ids.feature(key),
      label,
      icon,
      ...(color ? { color } : {}),
    };
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  return {
    type: 'value',
    value: Math.round(value * 10) / 10,
    unit,
    label,
    icon,
    ...(color ? { color } : {}),
  };
}

function single(phone, language) {
  const components = [];
  if (!phone.online && phone.error) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: fit(t(ERROR_TEXT[phone.error.kind] ?? ERROR_TEXT.http, language), 80),
    });
  } else if (!phone.known) {
    return message(TEXT.waiting, language);
  }
  if (phone.image) {
    components.push({
      type: 'image',
      key: phone.image,
      alt: t(TEXT.imageAlt, language),
      fit: 'cover',
    });
  }
  components.push(
    ...[
      tile(
        phone,
        FEATURE_KEYS.BATTERY,
        phone.readings.battery,
        '%',
        t(TEXT.battery, language),
        'battery',
      ),
      tile(
        phone,
        FEATURE_KEYS.BATTERY_TEMPERATURE,
        phone.readings.batteryTemperature,
        '°C',
        t(TEXT.temperature, language),
        'thermometer',
      ),
    ].filter(Boolean),
  );
  if (isHot(phone)) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.hot, language) });
  }

  const items = [
    {
      label: t(TEXT.state, language),
      icon: phone.online ? 'wifi' : 'wifi-off',
      value: t(phone.online ? TEXT.isOnline : TEXT.isOffline, language),
      color: phone.online ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
    },
  ];
  if (phone.online && typeof phone.readings.charging === 'boolean') {
    items.push({
      label: t(TEXT.power, language),
      icon: phone.readings.charging ? 'battery-charging' : 'battery',
      value: t(phone.readings.charging ? TEXT.charging : TEXT.notCharging, language),
      color: phone.readings.charging ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    });
  }
  if (phone.online && typeof phone.settings.motionDetect === 'boolean') {
    items.push({
      label: t(TEXT.security, language),
      icon: phone.settings.motionDetect ? 'shield' : 'shield-off',
      value: t(phone.settings.motionDetect ? TEXT.on : TEXT.off, language),
      color: phone.settings.motionDetect ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (phone.online && typeof phone.recording === 'boolean') {
    items.push({
      label: t(TEXT.recording, language),
      icon: phone.recording ? 'video' : 'video-off',
      value: t(phone.recording ? TEXT.recordingOn : TEXT.recordingOff, language),
      color: phone.recording ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items });

  if (phone.online) {
    const params = { phone: phone.externalId };
    components.push({
      type: 'button',
      label: t(TEXT.imageButton, language),
      icon: 'camera',
      style: 'secondary',
      action: { key: 'image', params },
    });
    if (phone.features.includes(FEATURE_KEYS.TORCH)) {
      const on = phone.settings.torch === true;
      components.push({
        type: 'button',
        label: t(TEXT.torchButton, language),
        icon: on ? 'check-circle' : 'sun',
        style: 'secondary',
        action: { key: on ? 'torch_off' : 'torch_on', params },
      });
    }
    const recording = phone.recording === true;
    components.push({
      type: 'button',
      label: t(recording ? TEXT.stopButton : TEXT.recordButton, language),
      icon: recording ? 'check-circle' : 'video',
      style: recording ? 'danger' : 'secondary',
      action: { key: recording ? 'record_stop' : 'record_start', params },
    });
  }
  return { ttl_seconds: 60, components };
}

async function get(hub, { settings, language = 'en' }) {
  const view = hub.view();
  if (!view.configured) {
    return message(TEXT.configure, language);
  }
  const phones = view.phones.map((phone) => ({
    ...phone,
    created: hub.isCreated(phone.externalId),
  }));
  if (settings?.phone) {
    const phone = phones.find((entry) => entry.externalId === settings.phone);
    return phone ? single(phone, language) : message(TEXT.unknown, language);
  }
  return overview({ ...view, phones }, language);
}

// Buttons of the single-phone view. The toasts are multi-language objects:
// the core shows the user's language.
async function action(hub, { actionKey, params = {} }) {
  switch (actionKey) {
    case 'image':
      await hub.refreshImage(params.phone);
      return ACTION_TEXT.imageTaken;
    case 'torch_on':
    case 'torch_off': {
      const on = actionKey === 'torch_on';
      await hub.setTorch(params.phone, on);
      return on ? ACTION_TEXT.torchOn : ACTION_TEXT.torchOff;
    }
    case 'record_start':
      await hub.startRecording(params.phone);
      return ACTION_TEXT.recordingStarted;
    case 'record_stop':
      await hub.stopRecording(params.phone);
      return ACTION_TEXT.recordingStopped;
    default:
      throw new Error(`Unknown widget action ${actionKey}`);
  }
}

export const WIDGET_ACTIONS = Object.freeze([
  'image',
  'torch_on',
  'torch_off',
  'record_start',
  'record_stop',
]);

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
