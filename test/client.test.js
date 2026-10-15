// -----------------------------------------------------------------------------
// The HTTP client of one phone: Basic authentication, the errors a user can
// act on, the commands and their "Ok", the queue, and the real node:http
// transport against the fake phone served on 127.0.0.1.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, IpWebcamClient, PhoneError } from '../src/ipwebcam/client.js';
import { FakePhone, PASSWORD, USERNAME, network } from './helpers/fakePhone.js';

const ORIGIN = 'http://192.0.2.10:8080';

function client(phone, host = {}) {
  return new IpWebcamClient({
    host: { origin: ORIGIN, label: '192.0.2.10:8080', username: '', password: '', ...host },
    request: network({ [ORIGIN]: phone }),
  });
}

test('reads the status, the sensors and a frame, with Basic authentication', async () => {
  const phone = new FakePhone({ username: USERNAME, password: PASSWORD });
  const c = client(phone, { username: USERNAME, password: PASSWORD });
  assert.equal((await c.readStatus()).curvals.quality, '49');
  assert.ok((await c.readSensors()).light);
  const jpeg = await c.shot();
  assert.equal(jpeg[0], 0xff);
  assert.deepEqual(
    phone.requests.map((r) => [r.path, r.authorized]),
    [
      ['/status.json?show_avail=1', true],
      ['/sensors.json', true],
      ['/shot.jpg', true],
    ],
  );
});

test('a refused or missing login is an authentication error, without the password', async () => {
  const phone = new FakePhone({ username: USERNAME, password: PASSWORD });
  await assert.rejects(
    client(phone, { username: USERNAME, password: 'wrong-pass' }).readStatus(),
    (err) => {
      assert.equal(err.kind, ERROR_KINDS.AUTH);
      assert.ok(!err.message.includes('wrong-pass'));
      assert.match(err.message, /refused/);
      return true;
    },
  );
  await assert.rejects(client(phone).readStatus(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.AUTH);
    assert.match(err.message, /asks for a user name/);
    return true;
  });
});

test('a phone off, something else at the address, an HTTP error', async () => {
  const phone = new FakePhone();
  phone.online = false;
  await assert.rejects(client(phone).readStatus(), { kind: ERROR_KINDS.UNREACHABLE });
  phone.online = true;
  phone.statusCode = 404;
  await assert.rejects(client(phone).readStatus(), { kind: ERROR_KINDS.NOT_IPWEBCAM });
  phone.statusCode = 500;
  await assert.rejects(client(phone).readStatus(), { kind: ERROR_KINDS.HTTP, status: 500 });
  const html = {
    request: async () => ({ status: 200, headers: {}, body: Buffer.from('<html>router</html>') }),
  };
  await assert.rejects(client(html).readStatus(), { kind: ERROR_KINDS.NOT_IPWEBCAM });
  phone.shotCode = 200;
  phone.image = Buffer.from('not a jpeg');
  await assert.rejects(client(phone).shot(), { kind: ERROR_KINDS.NOT_IPWEBCAM });
});

test('the commands: paths of the app, "Ok" expected', async () => {
  const phone = new FakePhone();
  const c = client(phone);
  await c.torch(true);
  await c.focus(false);
  await c.record(true, 'front door');
  await c.record(false);
  await c.setSetting('night_vision', true);
  await c.setSetting('quality', 70);
  await c.setSetting('orientation', 'portrait');
  assert.deepEqual(
    phone.requests.map((r) => r.path),
    [
      '/enabletorch',
      '/nofocus',
      '/startvideo?force=1&tag=front%20door',
      '/stopvideo?force=1',
      '/settings/night_vision?set=on',
      '/settings/quality?set=70',
      '/settings/orientation?set=portrait',
    ],
  );
  assert.throws(() => c.setSetting('orientation', 'sideways'), /Unknown orientation/);
  assert.throws(() => c.setSetting('ffc', true), /Unknown setting/);
  phone.refuseCommands = true;
  await assert.rejects(
    c.torch(false),
    (err) => err instanceof PhoneError && err.kind === ERROR_KINDS.REFUSED,
  );
});

test('at most two requests in flight per phone', async () => {
  let inFlight = 0;
  let peak = 0;
  const slow = {
    request: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { status: 200, headers: {}, body: Buffer.from('Ok') };
    },
  };
  const c = client(slow);
  await Promise.all([c.torch(true), c.torch(false), c.focus(true), c.focus(false), c.torch(true)]);
  assert.equal(peak, 2);
});

test('over real HTTP (node:http), the fake phone on 127.0.0.1', async (t) => {
  const phone = new FakePhone({ username: USERNAME, password: PASSWORD });
  const server = await phone.serve();
  t.after(() => server.close());
  const c = new IpWebcamClient({
    host: { origin: server.origin, label: 'local', username: USERNAME, password: PASSWORD },
  });
  assert.ok((await c.readStatus()).curvals);
  assert.equal((await c.shot())[1], 0xd8);
  await c.torch(true);
  assert.equal(phone.curvals.torch, 'on');
  await server.close();
  await assert.rejects(c.readStatus(), { kind: ERROR_KINDS.UNREACHABLE });
});
