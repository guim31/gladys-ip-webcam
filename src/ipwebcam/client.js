// -----------------------------------------------------------------------------
// The HTTP client of one phone running IP Webcam (Pavel Khlebovich), as
// home-assistant-libs/pydroid-ipcam (Apache-2.0) speaks to it:
//
//   GET /status.json?show_avail=1   settings (`curvals`), their choices, video status
//   GET /sensors.json               the sensors the app logs, with recent samples
//   GET /shot.jpg                   the current frame
//   GET /enabletorch, /disabletorch, /focus, /nofocus
//   GET /startvideo?force=1[&tag=…], /stopvideo?force=1
//   GET /settings/<key>?set=<value> night_vision, motion_detect, orientation, quality…
//
// The commands answer a short text holding "Ok" when done. Authentication,
// when set in the app, is HTTP Basic (both user name and password). No account
// lockout is known: a refused password is still not retried in a loop, the
// next read tries again at its pace.
//
// At most two requests in flight per phone: the app serves the video to its
// viewers on the same small web server.
// -----------------------------------------------------------------------------

import { HttpError, request as httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable',
  AUTH: 'auth',
  NOT_IPWEBCAM: 'not_ipwebcam',
  REFUSED: 'refused',
  HTTP: 'http',
});

export class PhoneError extends Error {
  constructor(message, kind, status) {
    super(message);
    this.name = 'PhoneError';
    this.kind = kind;
    this.status = status;
  }
}

export const CLIENT_TIMINGS = {
  timeoutMs: 10_000,
  // A frame of a busy phone can take longer than a JSON answer.
  imageTimeoutMs: 15_000,
  maxInFlight: 2,
};

// The orientations the app accepts (pydroid-ipcam ALLOWED_ORIENTATIONS).
export const ORIENTATIONS = Object.freeze([
  'landscape',
  'upsidedown',
  'portrait',
  'upsidedown_portrait',
]);

// The settings this integration writes, and how.
const SETTING_KEYS = new Set(['night_vision', 'motion_detect', 'orientation', 'quality']);

export class IpWebcamClient {
  /**
   * @param {object} options
   * @param {object} options.host { origin, label, username, password }
   * @param {Function} [options.request] HTTP seam (src/ipwebcam/http.js)
   * @param {object} [options.timings] CLIENT_TIMINGS overrides
   */
  constructor({ host, request, timings }) {
    this.host = host;
    this.request = request ?? httpRequest;
    this.timings = { ...CLIENT_TIMINGS, ...timings };
    this.authorization =
      host.username && host.password
        ? `Basic ${Buffer.from(`${host.username}:${host.password}`, 'utf8').toString('base64')}`
        : null;
    this.inFlight = 0;
    this.waiting = [];
  }

  // --- Queue ------------------------------------------------------------------

  async slot() {
    if (this.inFlight < this.timings.maxInFlight) {
      this.inFlight += 1;
      return;
    }
    await new Promise((resolve) => this.waiting.push(resolve));
    this.inFlight += 1;
  }

  release() {
    this.inFlight -= 1;
    this.waiting.shift()?.();
  }

  // --- Requests ---------------------------------------------------------------

  /**
   * One GET. Never puts the password in a message: errors name the path only.
   * @returns {Promise<{ status, headers, body: Buffer }>}
   */
  async get(path, { timeoutMs = this.timings.timeoutMs } = {}) {
    await this.slot();
    let response;
    try {
      response = await this.request(`${this.host.origin}${path}`, {
        headers: this.authorization ? { Authorization: this.authorization } : {},
        timeoutMs,
      });
    } catch (err) {
      throw new PhoneError(
        `${this.host.label} does not answer (${err.code ?? err.message})`,
        ERROR_KINDS.UNREACHABLE,
      );
    } finally {
      this.release();
    }
    const route = path.split('?')[0];
    if (response.status === 401 || response.status === 403) {
      throw new PhoneError(
        this.authorization
          ? 'User name or password refused'
          : 'The app asks for a user name and password',
        ERROR_KINDS.AUTH,
        response.status,
      );
    }
    if (response.status === 404) {
      throw new PhoneError(`${route} not found: not IP Webcam?`, ERROR_KINDS.NOT_IPWEBCAM, 404);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new PhoneError(
        `${route} answered HTTP ${response.status}`,
        ERROR_KINDS.HTTP,
        response.status,
      );
    }
    return response;
  }

  async getJson(path) {
    const { body } = await this.get(path);
    try {
      const data = JSON.parse(body.toString('utf8'));
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        return data;
      }
    } catch {
      // handled below
    }
    throw new PhoneError(
      `${path.split('?')[0]} is not the JSON of IP Webcam`,
      ERROR_KINDS.NOT_IPWEBCAM,
    );
  }

  /** A command: done when the app answers "Ok". */
  async command(path) {
    const { body } = await this.get(path);
    const text = body.toString('utf8');
    if (!/\bok\b/i.test(text)) {
      throw new PhoneError(
        `${path.split('?')[0]} refused: ${text.trim().slice(0, 80) || 'empty answer'}`,
        ERROR_KINDS.REFUSED,
      );
    }
  }

  // --- Reads ------------------------------------------------------------------

  readStatus() {
    return this.getJson('/status.json?show_avail=1');
  }

  readSensors() {
    return this.getJson('/sensors.json');
  }

  /** The current frame, JPEG bytes. */
  async shot() {
    const { body } = await this.get('/shot.jpg', { timeoutMs: this.timings.imageTimeoutMs });
    if (body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8) {
      throw new PhoneError('/shot.jpg is not a JPEG image', ERROR_KINDS.NOT_IPWEBCAM);
    }
    return body;
  }

  // --- Commands ---------------------------------------------------------------

  torch(on) {
    return this.command(on ? '/enabletorch' : '/disabletorch');
  }

  focus(on) {
    return this.command(on ? '/focus' : '/nofocus');
  }

  /** Start or stop the recording on the phone; `tag` names the file. */
  record(on, tag) {
    if (!on) {
      return this.command('/stopvideo?force=1');
    }
    const suffix = tag ? `&tag=${encodeURIComponent(tag)}` : '';
    return this.command(`/startvideo?force=1${suffix}`);
  }

  /** A setting of /settings: booleans are on/off. */
  setSetting(key, value) {
    if (!SETTING_KEYS.has(key)) {
      throw new Error(`Unknown setting ${key}`);
    }
    if (key === 'orientation' && !ORIENTATIONS.includes(value)) {
      throw new Error(`Unknown orientation ${value}`);
    }
    const text = typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value);
    return this.command(`/settings/${key}?set=${encodeURIComponent(text)}`);
  }
}

export { HttpError };
