// -----------------------------------------------------------------------------
// A simulated phone running IP Webcam, built from the fixtures
// (test/fixtures/ipwebcam): a `request` double for the client
// (src/ipwebcam/http.js) that checks HTTP Basic authentication like the app,
// answers /status.json, /sensors.json, /shot.jpg and the commands, and keeps
// the sensors logging with the clock of the test (new samples on demand).
// `serve()` exposes the same phone over real HTTP on 127.0.0.1, for the probe
// and the node:http transport (nothing leaves the machine).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import http from 'node:http';
import jpeg from 'jpeg-js';

process.env.LOG_LEVEL ??= 'silent';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/ipwebcam/${name}`, import.meta.url), 'utf8'));

export const USERNAME = 'gladys';
export const PASSWORD = 'Phone-Secret-1';

/** A small valid JPEG (a grey frame). */
export function smallJpeg(width = 64, height = 36, shade = 120) {
  const data = Buffer.alloc(width * height * 4, shade);
  return Buffer.from(jpeg.encode({ width, height, data }, 80).data);
}

const text = (status, body, type = 'text/plain') => ({
  status,
  headers: { 'content-type': type },
  body: Buffer.from(body),
});

export class FakePhone {
  /**
   * @param {object} [options]
   * @param {string} [options.status] fixture of /status.json
   * @param {string} [options.sensors] fixture of /sensors.json
   * @param {string|null} [options.username] null: no login set in the app
   * @param {string|null} [options.password]
   * @param {() => number} [options.now] the clock of the phone
   */
  constructor({
    status = 'status.json',
    sensors = 'sensors.json',
    username = null,
    password = null,
    now = () => Date.now(),
  } = {}) {
    this.status = fixture(status);
    this.sensors = fixture(sensors);
    this.username = username;
    this.password = password;
    this.now = now;
    this.online = true;
    this.statusCode = 200;
    this.shotCode = 200;
    this.refuseCommands = false;
    this.image = smallJpeg();
    this.requests = [];
    // The fixture samples are of 2022: move them to the test clock, so new
    // samples (later timestamps) follow them.
    this.rebase();
  }

  /** Shift every sample so the newest one is "now" on the phone clock. */
  rebase() {
    const newest = Math.max(
      0,
      ...Object.values(this.sensors).flatMap((node) => node.data.map(([t]) => t)),
    );
    const shift = this.now() - 1000 - newest;
    for (const node of Object.values(this.sensors)) {
      node.data = node.data.map(([t, values]) => [t + shift, values]);
    }
  }

  get curvals() {
    return this.status.curvals;
  }

  /** A new sample of a sensor (the app keeps the recent ones, oldest first). */
  sample(key, value, { unit = '', at = this.now() } = {}) {
    this.sensors[key] ??= { unit, data: [] };
    this.sensors[key].data.push([at, [value]]);
    this.sensors[key].data = this.sensors[key].data.slice(-15);
  }

  /** A motion that started and ended between two reads. */
  shortMotion() {
    this.sample('motion_active', 1, { at: this.now() - 2000 });
    this.sample('motion_active', 0, { at: this.now() - 500 });
  }

  authorized(headers = {}) {
    if (!this.username) {
      return true;
    }
    const expected = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
    return headers.Authorization === expected || headers.authorization === expected;
  }

  async request(url, { headers = {} } = {}) {
    const target = new URL(url);
    const path = target.pathname;
    const query = target.searchParams;
    const authorized = this.authorized(headers);
    this.requests.push({ path: `${path}${target.search}`, authorized });
    if (!this.online) {
      const err = new Error('connect EHOSTUNREACH');
      err.code = 'EHOSTUNREACH';
      throw err;
    }
    if (!authorized) {
      return text(401, '401 Unauthorized');
    }
    switch (path) {
      case '/status.json':
        if (this.statusCode !== 200) {
          return text(this.statusCode, 'error');
        }
        return text(200, JSON.stringify(this.status), 'application/json');
      case '/sensors.json':
        return text(200, JSON.stringify(this.sensors), 'application/json');
      case '/shot.jpg':
        if (this.shotCode !== 200) {
          return text(this.shotCode, 'error');
        }
        return { status: 200, headers: { 'content-type': 'image/jpeg' }, body: this.image };
      default:
        return this.command(path, query);
    }
  }

  command(path, query) {
    const done = () => text(200, this.refuseCommands ? 'Error' : 'Ok');
    if (this.refuseCommands) {
      return done();
    }
    switch (path) {
      case '/enabletorch':
        this.curvals.torch = 'on';
        return done();
      case '/disabletorch':
        this.curvals.torch = 'off';
        return done();
      case '/focus':
        this.focused = true;
        return done();
      case '/nofocus':
        this.focused = false;
        return done();
      case '/startvideo':
        this.status.video_status = { ...this.status.video_status, mode: 'manual' };
        this.tag = query.get('tag');
        return done();
      case '/stopvideo':
        this.status.video_status = { ...this.status.video_status, mode: 'none' };
        return done();
      default:
        if (path.startsWith('/settings/')) {
          const key = path.slice('/settings/'.length);
          this.curvals[key] = query.get('set');
          return done();
        }
        return text(404, 'Not found');
    }
  }

  get recording() {
    return this.status.video_status?.mode !== 'none';
  }

  /** The same phone over real HTTP on 127.0.0.1. */
  async serve() {
    const server = http.createServer(async (req, res) => {
      const answer = await this.request(`http://127.0.0.1${req.url}`, { headers: req.headers });
      res.writeHead(answer.status, answer.headers);
      res.end(answer.body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
      origin: `http://127.0.0.1:${port}`,
      port,
      close: () => new Promise((resolve) => server.close(resolve)),
    };
  }
}

/** A request double routing each origin to its fake phone. */
export function network(byOrigin) {
  return (url, options) => {
    const phone = byOrigin[new URL(url).origin];
    if (!phone) {
      const err = new Error('connect EHOSTUNREACH');
      err.code = 'EHOSTUNREACH';
      return Promise.reject(err);
    }
    return phone.request(url, options);
  };
}
