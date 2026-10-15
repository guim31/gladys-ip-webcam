// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// The phones are typed by address. Most installations use the same user name
// and password (or none) on every phone, so they are shared. A password lives
// in a `secret` field only: an address carrying credentials (`user:pass@ip`)
// is refused rather than kept in a plain text field.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two reads of every phone (status and sensors). Home
// Assistant reads every 10 s; two small JSON answers on the local network.
export const REFRESH_INTERVALS = ['5', '10', '30', '60'];

// Seconds between two images of every camera added to Gladys (`0`: only on a
// motion, a scene action or a request of Gladys). The camera box of the
// dashboard shows the last image the integration published.
export const SNAPSHOT_INTERVALS = ['0', '10', '30', '60', '300', '900'];

export const DEFAULT_PORT = 8080;

export const DEFAULT_CONFIG = {
  hosts: '',
  port: DEFAULT_PORT,
  https: false,
  username: '',
  password: '',
  refresh_interval: '10',
  snapshot_interval: '60',
  allow_motion_detection_off: false,
  language: 'fr',
};

// A host name or an IPv4 address; an IPv6 address goes between brackets.
const HOST_PATTERN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/**
 * One address as typed: `192.0.2.10`, `192.0.2.10:8081`, `https://phone.lan`,
 * `[2001:db8::10]:8080`. Without a port, `port`; without a scheme, `https`
 * says which one.
 * @returns {{ origin: string, label: string, key: string } | null} null when unusable
 */
export function parseHost(raw, { port = DEFAULT_PORT, https = false } = {}) {
  const text = String(raw ?? '').trim();
  if (!text || text.includes('@')) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    ? text
    : `${https ? 'https' : 'http'}://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return null;
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    return null;
  }
  const host = url.hostname;
  const ipv6 = host.startsWith('[') && host.endsWith(']');
  if (!ipv6 && !HOST_PATTERN.test(host)) {
    return null;
  }
  if (!url.port) {
    // new URL() drops a port equal to the scheme default: put the chosen one back.
    const effective = Number(port) || DEFAULT_PORT;
    const isDefault = effective === (url.protocol === 'https:' ? 443 : 80);
    if (!isDefault) {
      url.port = String(effective);
    }
  }
  const effectivePort = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
  return {
    origin: url.origin,
    label: `${host}:${effectivePort}`,
    // The identity of the phone in Gladys (src/devices.js): its address and
    // port, the only identity the app exposes. Lower case, no separator of the
    // external ids.
    key: `${host
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')}-${effectivePort}`,
  };
}

/**
 * The addresses of the field: separated by commas, semicolons, spaces or new
 * lines, duplicates dropped.
 * @returns {{ hosts: Array<{ origin, label, key }>, invalid: string[] }}
 */
export function parseHosts(raw, options) {
  const hosts = [];
  const invalid = [];
  const seen = new Set();
  const text = typeof raw === 'string' ? raw : '';
  for (const entry of text.split(/[\s,;]+/).filter(Boolean)) {
    const host = parseHost(entry, options);
    if (!host) {
      // Never the entry itself in a message: it may hold a password.
      invalid.push(entry.includes('@') ? '…@…' : entry);
    } else if (!seen.has(host.key)) {
      seen.add(host.key);
      hosts.push(host);
    }
  }
  return { hosts, invalid };
}

const pickOption = (value, options, fallback) =>
  options.includes(String(value ?? '')) ? String(value) : fallback;

// A boolean field may arrive as a string from older form engines.
const flag = (value, fallback) =>
  value === undefined || value === null || value === ''
    ? fallback
    : value === true || value === 'true';

function portOf(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  // A password may legitimately start or end with a space: kept as typed.
  const secret = (key) => (typeof source[key] === 'string' ? source[key] : '');
  const port = portOf(source.port);
  const https = flag(source.https, DEFAULT_CONFIG.https);
  const { hosts, invalid } = parseHosts(source.hosts, { port, https });
  const username = text('username');
  const password = secret('password');
  const language = text('language');
  return {
    phones: hosts.map((host) => ({ ...host, username, password })),
    invalidHosts: invalid,
    // IP Webcam asks for both or none: a user name alone is a refused login.
    credentialsIncomplete: Boolean(username) !== Boolean(password),
    refreshMs:
      Number(
        pickOption(source.refresh_interval, REFRESH_INTERVALS, DEFAULT_CONFIG.refresh_interval),
      ) * 1000,
    snapshotIntervalMs:
      Number(
        pickOption(source.snapshot_interval, SNAPSHOT_INTERVALS, DEFAULT_CONFIG.snapshot_interval),
      ) * 1000,
    allowMotionDetectionOff: flag(
      source.allow_motion_detection_off,
      DEFAULT_CONFIG.allow_motion_detection_off,
    ),
    language: LANGUAGES.includes(language) ? language : DEFAULT_CONFIG.language,
  };
}
