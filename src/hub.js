// -----------------------------------------------------------------------------
// The IP Webcam hub: every configured phone, read again on a timer.
//
//   - each phone is read every few seconds (status and sensors, 10 s by
//     default, as Home Assistant does): the container refreshes itself,
//     Gladys never polls (should_poll: false, GladysAssistant/Gladys#3198);
//   - what a phone offers (its logged sensors and its settings) is kept in
//     /data, so a phone off at the next start keeps its features;
//   - motion: the app's own detection (`motion_active`). Every sample since
//     the last read is looked at, so a short motion between two reads is
//     still seen (published 1, then 0 a few seconds later). A fresh image is
//     taken BEFORE the motion state is published, so a scene "motion → send
//     the camera image" sends what the phone saw;
//   - sound level: the loudest sample since the last read, so a short noise
//     between two reads crosses a threshold of a scene;
//   - images: on a motion, on the timer chosen in the configuration, on
//     demand (scene action, widget, Gladys);
//   - a recording started by a scene for N minutes is stopped by the hub,
//     even after a restart (its end is kept in /data).
//
// States go through publishChangedStates (only the changes, plus a heartbeat
// every 6 hours: the front shows "no recent value" past 48 hours), and only
// for the devices the user added: Gladys drops the others.
//
// Logs: info keeps the lifecycle (connected, a phone lost and back, user
// commands); a problem that repeats is logged once, and once when it clears;
// the rest goes to debug (LOG_LEVEL=debug). Never a password, never an
// address with credentials.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { ERROR_KINDS, IpWebcamClient, ORIENTATIONS } from './ipwebcam/client.js';
import {
  SENSORS,
  capabilities,
  celsius,
  latest,
  parseSensors,
  parseStatus,
  samplesSince,
} from './ipwebcam/model.js';
import {
  FEATURE_KEYS,
  QUALITIES,
  buildDevice,
  featureKeys,
  featureValues,
  phoneIds,
  phoneName,
} from './devices.js';
import { toCameraImage } from './image.js';
import { ACTION_TEXT, CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, localized, pick } from './texts.js';

const logger = createLogger({ name: 'ipwebcam-hub' });

export const WIDGET_KEY = 'ip_webcam';

export const HUB_TIMINGS = {
  heartbeatMs: 6 * 60 * 60_000,
  // A motion seen between two reads: 1, then 0 after this.
  pulseMs: 10_000,
  // The core takes 12 images a minute per camera at most.
  imageSpacingMs: 5_000,
  // A motion state waits this long at most for the fresh image of its phone.
  eventImageWaitMs: 4_000,
};

// Recording durations a scene may ask for, in minutes.
export const MAX_RECORDING_MINUTES = 240;

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

const phonesSignature = (config) =>
  JSON.stringify(config.phones.map((p) => [p.origin, p.username, p.password]));

export class IpWebcamHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/ipwebcam/http.js)
   * @param {Function} [options.toImage] JPEG → camera image (src/image.js)
   * @param {boolean} [options.timers] periodic timers (off in most tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {object} [options.clientTimings] CLIENT_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, toImage, timers = true, timings, clientTimings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.toImage = toImage ?? toCameraImage;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.clientTimings = clientTimings;
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.signature = null;
    /** By key (src/config.js parseHost): the state of each phone. */
    this.phones = new Map();
    this.saved = { phones: {}, recordings: {} };
    this.reading = null;
    this.discovery = null;
    this.connection = null;
    this.transports = new Map();
    this.refreshTimer = null;
    this.snapshotTimer = null;
    this.recordingTimers = new Map();
    this.imageCount = 0;
    this.stopped = false;
    /** Problems already logged, by key: their repeats go to debug. */
    this.warned = new Set();
  }

  get language() {
    return this.config?.language ?? 'en';
  }

  // --- Logs ------------------------------------------------------------------

  /** Log a problem once (`level` info, warn or error), its repeats at debug. */
  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(message);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  /** The problem `key` is gone: say so once, the next occurrence logs again. */
  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      phones: saved.phones && typeof saved.phones === 'object' ? saved.phones : {},
      recordings: saved.recordings && typeof saved.recordings === 'object' ? saved.recordings : {},
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovery = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const next = phonesSignature(config);
    const changed = next !== this.signature;
    this.config = config;
    if (changed) {
      this.signature = next;
      for (const phone of this.phones.values()) {
        clearTimeout(phone.pulseTimer);
      }
      this.phones.clear();
      for (const host of config.phones) {
        const saved = this.saved.phones[host.key];
        this.phones.set(host.key, {
          key: host.key,
          label: host.label,
          origin: host.origin,
          host,
          client: new IpWebcamClient({
            host,
            request: this.request,
            timings: this.clientTimings,
          }),
          caps: saved && Array.isArray(saved.sensors) ? saved : null,
          settings: {},
          readings: {},
          recording: null,
          focus: false,
          motion: null,
          pulseTimer: null,
          seen: { motion: null, sound: null },
          read: { ok: null, error: null, downSince: null },
          image: null,
          imageRead: null,
          widgetImage: null,
        });
      }
      if (config.invalidHosts.length > 0) {
        this.problem(
          'invalid-hosts',
          `Addresses not understood in the configuration: ${config.invalidHosts.join(', ')}`,
        );
      } else {
        this.resolved('invalid-hosts');
      }
    }
    // A new language renames the features: the Discovery tab shows them.
    this.discovery = null;
    if (this.phones.size === 0) {
      clearTimeout(this.refreshTimer);
      clearTimeout(this.snapshotTimer);
      await this.publishDevices();
      await this.publishConnectionStatus();
      return;
    }
    await this.refresh();
    this.scheduleRefresh();
    this.scheduleSnapshots();
    this.scheduleRecordings();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.refreshTimer);
    clearTimeout(this.snapshotTimer);
    for (const timer of this.recordingTimers.values()) {
      clearTimeout(timer);
    }
    this.recordingTimers.clear();
    for (const phone of this.phones.values()) {
      clearTimeout(phone.pulseTimer);
    }
    await this.store.flush();
  }

  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    if (!this.timersEnabled || this.stopped || this.phones.size === 0) {
      return;
    }
    this.refreshTimer = setTimeout(async () => {
      await this.refresh().catch((err) =>
        this.problem('refresh', `Refresh failed: ${err.message}`),
      );
      this.scheduleRefresh();
    }, this.config.refreshMs);
  }

  scheduleSnapshots() {
    clearTimeout(this.snapshotTimer);
    const interval = this.config?.snapshotIntervalMs ?? 0;
    if (!this.timersEnabled || this.stopped || this.phones.size === 0 || interval <= 0) {
      return;
    }
    this.snapshotTimer = setTimeout(async () => {
      await this.snapshotAll().catch(() => {});
      this.scheduleSnapshots();
    }, interval);
  }

  // --- Phones ------------------------------------------------------------------

  /** The phone of a Gladys external id, null when unknown. */
  findPhone(externalId) {
    if (!externalId) {
      return null;
    }
    return (
      [...this.phones.values()].find(
        (phone) => phoneIds(this.gladys, phone).device === externalId,
      ) ?? null
    );
  }

  isOnline(phone) {
    return phone.read.ok === true;
  }

  /** Whether the user added the device to Gladys. */
  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  /** The name the user sees: the one given in Gladys, else ours. */
  displayName(phone) {
    const externalId = phoneIds(this.gladys, phone).device;
    const created = (this.gladys.devices ?? []).find((device) => device.external_id === externalId);
    return created?.name || phoneName(phone);
  }

  // --- Reading the phones -----------------------------------------------------------

  /** Read every phone. Concurrent calls share the read. */
  refresh() {
    this.reading ??= this.readAll().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  async readAll() {
    const phones = [...this.phones.values()];
    const results = await Promise.all(phones.map((phone) => this.readPhone(phone)));
    if (this.phones.size === 0 || phones.some((phone) => this.phones.get(phone.key) !== phone)) {
      return false; // reconfigured while reading
    }
    await this.publishDevices();
    await this.publishAllStates();
    await this.afterChanges();
    await this.checkRecordings();
    return results.every(Boolean);
  }

  async readPhone(phone) {
    let status;
    let sensors;
    try {
      // One after the other: the app serves its viewers on the same server.
      status = parseStatus(await phone.client.readStatus());
      sensors = parseSensors(await phone.client.readSensors());
    } catch (err) {
      if (this.phones.get(phone.key) === phone) {
        this.readFailed(
          phone,
          err.kind ? err : { kind: ERROR_KINDS.NOT_IPWEBCAM, message: err.message },
        );
      }
      return false;
    }
    if (this.phones.get(phone.key) !== phone) {
      return false;
    }
    const caps = capabilities(status, sensors);
    if (JSON.stringify(caps) !== JSON.stringify(phone.caps)) {
      phone.caps = caps;
      this.saved.phones[phone.key] = caps;
      this.save();
    }
    phone.settings = status.settings;
    if (status.recording !== null) {
      phone.recording = status.recording;
    }
    this.readSensors(phone, sensors);
    this.readSucceeded(phone, caps);
    const motionStarted = this.readMotion(phone, sensors);
    if (motionStarted) {
      // The image first: a scene on the motion state sends the camera image.
      await this.imageForEvent(phone);
    }
    return true;
  }

  readSensors(phone, sensors) {
    const value = (key) => latest(sensors, key)?.v ?? null;
    const temperature = latest(sensors, SENSORS.BATTERY_TEMP);
    const charging = value(SENSORS.BATTERY_CHARGING);
    phone.readings = {
      battery: value(SENSORS.BATTERY_LEVEL),
      charging: charging === null ? null : charging >= 1,
      batteryTemperature: temperature
        ? celsius(temperature.v, sensors.get(SENSORS.BATTERY_TEMP).unit)
        : null,
      light: value(SENSORS.LIGHT),
      sound: this.peakSound(phone, sensors),
      proximity: value(SENSORS.PROXIMITY),
      pressure: value(SENSORS.PRESSURE),
    };
  }

  /** The samples of a sensor not seen yet; resets when the phone clock went back. */
  newSamples(phone, sensors, key, name) {
    const last = latest(sensors, key);
    if (!last) {
      phone.seen[name] = null;
      return { last: null, fresh: [], first: true };
    }
    const since = phone.seen[name];
    const first = since === null || last.t < since;
    phone.seen[name] = last.t;
    return { last, fresh: first ? [last] : samplesSince(sensors, key, since), first };
  }

  peakSound(phone, sensors) {
    const { last, fresh } = this.newSamples(phone, sensors, SENSORS.SOUND, 'sound');
    if (!last) {
      return null;
    }
    // No new sample: the app stopped logging the sound for a while; keep its last.
    return fresh.length > 0 ? Math.max(...fresh.map((sample) => sample.v)) : last.v;
  }

  /** The motion of this read; true when a motion starts now. */
  readMotion(phone, sensors) {
    const { last, fresh } = this.newSamples(phone, sensors, SENSORS.MOTION_ACTIVE, 'motion');
    const before = this.motionValue(phone);
    if (!last) {
      phone.motion = null;
      return false;
    }
    const now = last.v >= 1;
    const seen = fresh.some((sample) => sample.v >= 1);
    phone.motion = now;
    if (!now && seen) {
      this.pulse(phone);
    }
    return this.motionValue(phone) === true && before !== true;
  }

  /** The motion published: the app's, or a pulse of a motion seen between two reads. */
  motionValue(phone) {
    if (phone.pulseTimer) {
      return true;
    }
    return phone.motion;
  }

  /** A motion seen between two reads: on now, off after `pulseMs`. */
  pulse(phone) {
    clearTimeout(phone.pulseTimer);
    phone.pulseTimer = setTimeout(() => {
      phone.pulseTimer = null;
      if (!this.stopped && this.phones.get(phone.key) === phone) {
        this.publishStates(phone).catch(() => {});
      }
    }, this.timings.pulseMs);
    phone.pulseTimer.unref?.();
  }

  readSucceeded(phone, caps) {
    const read = phone.read;
    const first = read.ok === null;
    const wasDown = read.ok === false;
    read.ok = true;
    read.error = null;
    if (first) {
      logger.info(
        `Connected to IP Webcam at ${phone.label}: ${caps.sensors.length} sensor(s) logged, ${caps.settings.length} setting(s)`,
      );
    } else if (wasDown) {
      const minutes = Math.max(1, Math.round((this.now() - read.downSince) / 60_000));
      this.warned.delete(`read-${phone.key}`);
      logger.info(`IP Webcam at ${phone.label} answers again after ${minutes} min`);
    }
    read.downSince = null;
  }

  readFailed(phone, err) {
    const read = phone.read;
    if (read.ok !== false) {
      read.downSince = this.now();
    }
    read.ok = false;
    read.error = err;
    // A phone off or out of Wi-Fi is lifecycle (info); a refused password is
    // a problem to fix (warn). Once per outage either way.
    const level = err.kind === ERROR_KINDS.UNREACHABLE ? 'info' : 'warn';
    this.problem(
      `read-${phone.key}`,
      `Cannot read IP Webcam at ${phone.label}: ${err.message}`,
      level,
    );
    // Nothing moves on a phone we cannot read.
    if (phone.motion || phone.pulseTimer) {
      clearTimeout(phone.pulseTimer);
      phone.pulseTimer = null;
    }
    phone.motion = phone.motion === null ? null : false;
  }

  save() {
    return this.store.save({ phones: this.saved.phones, recordings: this.saved.recordings });
  }

  // --- Publishing to Gladys ----------------------------------------------------

  /** The phones whose features are known (read once, now or before a restart). */
  knownPhones() {
    return [...this.phones.values()].filter((phone) => phone.caps);
  }

  async publishDevices() {
    const devices = this.knownPhones().map((phone) =>
      buildDevice(this.gladys, phone, { language: this.language }),
    );
    const key = JSON.stringify(devices);
    if (key === this.discovery) {
      return;
    }
    try {
      // Even an empty list: the Discovery tab then shows no stale device.
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovery = key;
      this.resolved('discovery');
    } catch (err) {
      this.problem('discovery', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the phones again. */
  async rediscover() {
    this.discovery = null;
    if (!(await this.refresh())) {
      await this.publishDevices();
    }
  }

  /** The user added a device: the SDK forgot its values, send them again. */
  async onDeviceCreated(device) {
    const phone = this.findPhone(device.external_id);
    if (!phone) {
      return;
    }
    await this.publishStates(phone);
    await this.publishTransports();
    if (this.isOnline(phone)) {
      this.cameraImage(phone).catch(() => {});
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  async publishAllStates() {
    for (const phone of this.knownPhones()) {
      await this.publishStates(phone);
    }
  }

  /** The current values of one phone, sent if they changed. */
  async publishStates(phone) {
    const ids = phoneIds(this.gladys, phone);
    if (!phone.caps || !this.isCreated(ids.device)) {
      return;
    }
    const online = this.isOnline(phone);
    const values = featureValues({
      online,
      readings: phone.readings,
      settings: phone.settings,
      recording: phone.recording,
      focus: phone.focus,
      motion: this.motionValue(phone),
    });
    const states = featureKeys(phone.caps)
      // Offline: only "online" is news; the last readings stay as they were.
      .filter((key) => online || key === FEATURE_KEYS.ONLINE || key === FEATURE_KEYS.MOTION)
      .filter((key) => values[key] !== undefined && values[key] !== null)
      .map((key) =>
        typeof values[key] === 'object'
          ? { device_feature_external_id: ids.feature(key), text: values[key].text }
          : { device_feature_external_id: ids.feature(key), state: values[key] },
      );
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States of ${phone.label} refused: ${err.message}`);
    }
  }

  /** After any read: phones offline and back, transports, status, widget. */
  async afterChanges() {
    let changed = false;
    for (const phone of this.phones.values()) {
      const online = this.isOnline(phone);
      if (phone.wasOnline !== online) {
        changed = true;
        phone.wasOnline = online;
      }
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (changed) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishTransports() {
    const entries = [];
    for (const phone of this.knownPhones()) {
      const externalId = phoneIds(this.gladys, phone).device;
      if (!this.isCreated(externalId)) {
        continue;
      }
      const transport = this.isOnline(phone)
        ? DEVICE_TRANSPORTS.LOCAL
        : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name, in the Configuration screen. */
  connectionStatus() {
    const config = this.config;
    if (!config || config.phones.length === 0) {
      return {
        connected: false,
        message:
          config?.invalidHosts.length > 0 ? CONNECTION_TEXT.invalidHost : CONNECTION_TEXT.noHost,
      };
    }
    const reads = [...this.phones.values()].map((phone) => phone.read);
    if (reads.some((read) => read.ok === null)) {
      return null; // first read not done yet
    }
    const failed = reads.filter((read) => read.ok === false);
    if (failed.length === reads.length) {
      const refused = failed.find((read) => read.error?.kind === ERROR_KINDS.AUTH);
      if (refused && config.credentialsIncomplete) {
        return { connected: false, message: CONNECTION_TEXT.credentials };
      }
      const error = refused?.error ?? failed[0].error;
      return { connected: false, message: ERROR_TEXT[error?.kind] ?? ERROR_TEXT.http };
    }
    if (failed.length > 0 || config.invalidHosts.length > 0) {
      return { connected: true, message: CONNECTION_TEXT.someDown };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    if (!status) {
      return;
    }
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Camera images -------------------------------------------------------------

  /**
   * A fresh image of a phone, sent to Gladys when the phone is added.
   * Concurrent calls share the read; a read younger than `imageSpacingMs` is
   * reused (the core takes 12 images a minute per camera).
   * @returns {Promise<string|null>} the `image/jpg;base64,…` string
   */
  cameraImage(phone) {
    if (phone.image && this.now() - phone.image.at < this.timings.imageSpacingMs) {
      return Promise.resolve(phone.image.data);
    }
    phone.imageRead ??= this.readImage(phone).finally(() => {
      phone.imageRead = null;
    });
    return phone.imageRead;
  }

  async readImage(phone) {
    let image;
    try {
      image = await this.toImage(await phone.client.shot());
      this.resolved(`image-${phone.key}`, `Images of ${phone.label}: back`);
    } catch (err) {
      const level = err.kind === ERROR_KINDS.UNREACHABLE ? 'info' : 'warn';
      this.problem(`image-${phone.key}`, `No image from ${phone.label}: ${err.message}`, level);
      return null;
    }
    this.imageCount += 1;
    phone.image = { at: this.now(), data: image };
    // Widget images are cached one hour by key: a new key for each image.
    phone.widgetImage = `img-${this.imageCount.toString(36)}-${this.now().toString(36)}`;
    const externalId = phoneIds(this.gladys, phone).device;
    if (this.isCreated(externalId)) {
      try {
        await this.gladys.publishCameraImage(externalId, image);
        this.resolved('camera-image');
      } catch (err) {
        this.problem('camera-image', `Image of ${phone.label} refused: ${err.message}`);
      }
    }
    return image;
  }

  /** A motion: a fresh image of an added phone, waited for a few seconds at most. */
  async imageForEvent(phone) {
    if (!this.isCreated(phoneIds(this.gladys, phone).device)) {
      return;
    }
    await Promise.race([this.cameraImage(phone), delay(this.timings.eventImageWaitMs)]);
  }

  /** The timer of the configuration: every added phone online, one after the other. */
  async snapshotAll() {
    const half = (this.config?.snapshotIntervalMs ?? 0) / 2;
    for (const phone of this.knownPhones()) {
      const externalId = phoneIds(this.gladys, phone).device;
      // Skip a phone imaged less than half a period ago (a motion did it).
      if (
        !this.isOnline(phone) ||
        !this.isCreated(externalId) ||
        (phone.image && this.now() - phone.image.at < half)
      ) {
        continue;
      }
      await this.cameraImage(phone);
    }
  }

  /** Gladys asks for a fresh image (scene "send camera image", AI). */
  async getImage(device) {
    const phone = this.findPhone(device.external_id);
    if (!phone) {
      throw new Error(pick(ACTION_TEXT.unknownPhone, this.language));
    }
    const image = await this.cameraImage(phone);
    if (!image) {
      throw new Error(pick(ACTION_TEXT.snapshotFailed, this.language));
    }
    return image;
  }

  /** The raw base64 of a widget image. */
  widgetImage(key) {
    const phone = [...this.phones.values()].find((entry) => entry.widgetImage === key);
    if (!phone?.image) {
      throw new Error(`Unknown image ${key}`);
    }
    return phone.image.data.slice(phone.image.data.indexOf(',') + 1);
  }

  // --- Commands --------------------------------------------------------------------

  requirePhone(externalId) {
    if (this.phones.size === 0) {
      throw new Error(pick(ACTION_TEXT.notConfigured, this.language));
    }
    if (!externalId) {
      throw new Error(pick(ACTION_TEXT.pickPhone, this.language));
    }
    const phone = this.findPhone(externalId);
    if (!phone) {
      throw new Error(pick(ACTION_TEXT.unknownPhone, this.language));
    }
    return phone;
  }

  /** A command failed: one warning, and the reason in the user's language. */
  failed(phone, what, err) {
    logger.warn(`${phone.label}: ${what} failed: ${err.message}`);
    return new Error(pick(ERROR_TEXT[err.kind] ?? ERROR_TEXT.http, this.language), { cause: err });
  }

  /** A command of a feature: torch, focus, night vision, recording, orientation, quality. */
  async setValue(device, feature, value) {
    const phone = this.findPhone(device.external_id);
    const ids = phone ? phoneIds(this.gladys, phone) : null;
    const key = ids
      ? Object.values(FEATURE_KEYS).find((name) => ids.feature(name) === feature.external_id)
      : null;
    const commands = [
      FEATURE_KEYS.TORCH,
      FEATURE_KEYS.FOCUS,
      FEATURE_KEYS.NIGHT_VISION,
      FEATURE_KEYS.RECORDING,
      FEATURE_KEYS.ORIENTATION,
      FEATURE_KEYS.QUALITY,
    ];
    if (!key || !commands.includes(key) || !featureKeys(phone.caps).includes(key)) {
      throw new Error(`No command for ${feature.external_id}`);
    }
    const on = Number(value) === 1;
    let done;
    try {
      switch (key) {
        case FEATURE_KEYS.TORCH:
          await phone.client.torch(on);
          phone.settings = { ...phone.settings, torch: on };
          done = `torch ${on ? 'on' : 'off'}`;
          break;
        case FEATURE_KEYS.FOCUS:
          await phone.client.focus(on);
          phone.focus = on;
          done = on ? 'focus held' : 'focus continuous';
          break;
        case FEATURE_KEYS.NIGHT_VISION:
          await phone.client.setSetting('night_vision', on);
          phone.settings = { ...phone.settings, nightVision: on };
          done = `night vision ${on ? 'on' : 'off'}`;
          break;
        case FEATURE_KEYS.RECORDING:
          await phone.client.record(on);
          phone.recording = on;
          // A recording stopped by hand ends the timed one of a scene.
          this.forgetRecording(phone);
          done = `recording ${on ? 'started' : 'stopped'}`;
          break;
        case FEATURE_KEYS.ORIENTATION: {
          const orientation = String(value);
          if (!ORIENTATIONS.includes(orientation)) {
            throw new Error(`Unknown orientation ${orientation}`);
          }
          await phone.client.setSetting('orientation', orientation);
          phone.settings = { ...phone.settings, orientation };
          done = `orientation ${orientation}`;
          break;
        }
        case FEATURE_KEYS.QUALITY: {
          const quality = String(value);
          if (!QUALITIES.includes(quality)) {
            throw new Error(`Unknown quality ${quality}`);
          }
          await phone.client.setSetting('quality', Number(quality));
          phone.settings = { ...phone.settings, quality: Number(quality) };
          done = `image quality ${quality} %`;
          break;
        }
        default:
          throw new Error(`No command for ${feature.external_id}`);
      }
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      throw this.failed(phone, key, err);
    }
    logger.info(`${phone.label}: ${done}`);
    await this.publishStates(phone);
  }

  /** Scene action and widget: a fresh image now, sent to Gladys. */
  async refreshImage(externalId) {
    const phone = this.requirePhone(externalId);
    logger.info(`${phone.label}: fresh image asked`);
    // A user asked: never the image of 5 seconds ago.
    phone.image = null;
    const image = await this.cameraImage(phone);
    if (!image) {
      throw new Error(pick(ACTION_TEXT.snapshotFailed, this.language));
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
    return image;
  }

  /**
   * Scene action: turn the motion detection of the app on or off. Turning it
   * off disarms the phone: refused unless allowed in the configuration, and
   * never a switch of the device (no dashboard toggle, no voice assistant).
   */
  async setMotionDetection(externalId, on) {
    const phone = this.requirePhone(externalId);
    if (!on && !this.config?.allowMotionDetectionOff) {
      throw new Error(pick(ACTION_TEXT.motionOffDisabled, this.language));
    }
    if (phone.caps && !phone.caps.settings.includes('motionDetect')) {
      throw new Error(pick(ACTION_TEXT.noMotionDetection, this.language));
    }
    try {
      await phone.client.setSetting('motion_detect', on);
    } catch (err) {
      throw this.failed(phone, 'motion detection', err);
    }
    phone.settings = { ...phone.settings, motionDetect: on };
    logger.info(`${phone.label}: motion detection ${on ? 'on' : 'off'}`);
    await this.publishStates(phone);
  }

  /** Widget: torch on or off. */
  async setTorch(externalId, on) {
    const phone = this.requirePhone(externalId);
    if (phone.caps && !phone.caps.settings.includes('torch')) {
      throw new Error(pick(ACTION_TEXT.noTorch, this.language));
    }
    try {
      await phone.client.torch(on);
    } catch (err) {
      throw this.failed(phone, 'torch', err);
    }
    phone.settings = { ...phone.settings, torch: on };
    logger.info(`${phone.label}: torch ${on ? 'on' : 'off'}`);
    await this.publishStates(phone);
  }

  // --- Recordings -------------------------------------------------------------

  /**
   * Start a recording on the phone. With `minutes`, the hub stops it after
   * that long (kept in /data across restarts). A recording already running
   * that the hub did not start is left alone: it is never stopped by a scene
   * timer.
   * @returns {Promise<boolean>} whether this call started the recording
   */
  async startRecording(externalId, { minutes = null, tag = null } = {}) {
    const phone = this.requirePhone(externalId);
    const ours = this.saved.recordings[phone.key];
    if (phone.recording === true && !ours) {
      logger.info(`${phone.label}: already recording, left as is`);
      return false;
    }
    let started = false;
    if (phone.recording !== true) {
      try {
        await phone.client.record(true, tag);
      } catch (err) {
        throw this.failed(phone, 'recording', err);
      }
      phone.recording = true;
      started = true;
    }
    if (minutes) {
      const until = this.now() + minutes * 60_000;
      this.saved.recordings[phone.key] = Math.max(until, ours ?? 0);
      this.save();
      this.scheduleRecordings();
    }
    logger.info(
      `${phone.label}: recording ${started ? 'started' : 'extended'}${minutes ? ` for ${minutes} min` : ''}`,
    );
    await this.publishStates(phone);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
    return started;
  }

  async stopRecording(externalId) {
    const phone = this.requirePhone(externalId);
    try {
      await phone.client.record(false);
    } catch (err) {
      throw this.failed(phone, 'recording', err);
    }
    phone.recording = false;
    this.forgetRecording(phone);
    logger.info(`${phone.label}: recording stopped`);
    await this.publishStates(phone);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  forgetRecording(phone) {
    if (phone.key in this.saved.recordings) {
      delete this.saved.recordings[phone.key];
      clearTimeout(this.recordingTimers.get(phone.key));
      this.recordingTimers.delete(phone.key);
      this.save();
    }
  }

  /** One timer per timed recording; checkRecordings is also run after each read. */
  scheduleRecordings() {
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    for (const [key, until] of Object.entries(this.saved.recordings)) {
      clearTimeout(this.recordingTimers.get(key));
      const timer = setTimeout(
        () => this.checkRecordings().catch(() => {}),
        Math.max(0, until - this.now()),
      );
      timer.unref?.();
      this.recordingTimers.set(key, timer);
    }
  }

  /** Stop the timed recordings that are due, on the phones that answer. */
  async checkRecordings() {
    for (const [key, until] of Object.entries(this.saved.recordings)) {
      const phone = this.phones.get(key);
      if (!phone) {
        continue; // a phone removed from the configuration: kept until it is back
      }
      if (until > this.now() || !this.isOnline(phone)) {
        continue;
      }
      try {
        await phone.client.record(false);
      } catch (err) {
        this.problem(`record-${key}`, `${phone.label}: cannot stop the recording: ${err.message}`);
        continue;
      }
      this.resolved(`record-${key}`);
      phone.recording = false;
      this.forgetRecording(phone);
      logger.info(`${phone.label}: timed recording stopped`);
      await this.publishStates(phone);
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  // --- Configuration actions -------------------------------------------------------

  /** "Test the connection": read every phone again and report, in four languages. */
  async testConnection() {
    if (this.phones.size === 0) {
      return this.connectionStatus().message;
    }
    await this.refresh();
    const phones = [...this.phones.values()];
    const ok = phones.filter((phone) => this.isOnline(phone)).length;
    logger.info(`Connection test: ${ok} of ${phones.length} phone(s) answered`);
    return localized((language) =>
      phones
        .map((phone) => {
          const text = REPORT_TEXT[language];
          if (this.isOnline(phone)) {
            const commands = phone.caps.settings.length;
            return phone.caps.sensors.length > 0
              ? text.ok(phone.label, phone.caps.sensors.length, commands)
              : text.noSensor(phone.label);
          }
          return text.failed(
            phone.label,
            pick(ERROR_TEXT[phone.read.error?.kind] ?? ERROR_TEXT.http, language),
          );
        })
        .join(' '),
    );
  }

  /**
   * "Video stream address": the RTSP address of a phone (H.264), for the
   * "RTSP camera" integration of Gladys, with the user name and a PASSWORD
   * placeholder: the password is never shown nor logged.
   */
  streamUrl(externalId) {
    const phone = this.requirePhone(externalId);
    const url = new URL(phone.origin);
    const scheme = url.protocol === 'https:' ? 'rtsps' : 'rtsp';
    const user = phone.host.username ? encodeURIComponent(phone.host.username) : 'user';
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const rtsp = `${scheme}://${user}:PASSWORD@${url.hostname}:${port}/h264_aac.sdp`;
    logger.info(`Configuration action: stream address of ${phone.label} shown`);
    return localized((language) => `${pick(ACTION_TEXT.stream, language)} ${rtsp}`);
  }

  // --- Widget ------------------------------------------------------------------------

  /** What the widget shows. */
  view() {
    return {
      configured: this.phones.size > 0,
      phones: [...this.phones.values()].map((phone) => ({
        key: phone.key,
        label: phone.label,
        name: this.displayName(phone),
        externalId: phoneIds(this.gladys, phone).device,
        ids: phoneIds(this.gladys, phone),
        online: this.isOnline(phone),
        known: Boolean(phone.caps),
        features: phone.caps ? featureKeys(phone.caps) : [],
        readings: phone.readings,
        settings: phone.settings,
        recording: phone.recording,
        timedRecording: this.saved.recordings[phone.key] ?? null,
        motion: this.motionValue(phone),
        image: phone.image ? phone.widgetImage : null,
        imageAt: phone.image?.at ?? null,
        error: phone.read.error,
      })),
    };
  }
}
