// -----------------------------------------------------------------------------
// scripts/probe.mjs against the fake phone served on 127.0.0.1: it reads,
// lists, watches, writes nothing, and prints no secret nor the address the
// phone reports for itself.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { FakePhone, PASSWORD, USERNAME } from './helpers/fakePhone.js';

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/probe.mjs', ...args], {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        IPWEBCAM_USER: '',
        IPWEBCAM_PASSWORD: '',
        ...env,
        LOG_LEVEL: 'silent',
      },
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', (code) => resolve({ code, output }));
  });
}

test('the probe reads a phone, watches it, writes nothing, prints no secret', async (t) => {
  const phone = new FakePhone({
    sensors: 'sensors-extended.json',
    username: USERNAME,
    password: PASSWORD,
  });
  const server = await phone.serve();
  t.after(() => server.close());
  const moving = setInterval(() => phone.sample('motion_active', Math.round(Math.random())), 500);
  t.after(() => clearInterval(moving));
  const { code, output } = await run([server.origin, '3'], {
    IPWEBCAM_USER: USERNAME,
    IPWEBCAM_PASSWORD: PASSWORD,
  });
  assert.equal(code, 0, output);
  assert.match(output, /"motion_detect"\s+"on"/);
  assert.match(output, /battery_charging\s+unit "", 1 sample/);
  assert.match(output, /Features\s+image, online, battery, charging/);
  assert.match(output, /Frame \/shot\.jpg\s+\d+ KB, 64×36/);
  assert.match(output, /"ip_address"\s+\(hidden\)/);
  assert.match(output, /Nothing was written/);
  for (const secret of [PASSWORD, '192.0.2.88']) {
    assert.ok(!output.includes(secret), secret);
  }
  const reads = new Set(phone.requests.map((r) => r.path.split('?')[0]));
  assert.deepEqual([...reads].sort(), ['/sensors.json', '/shot.jpg', '/status.json']);
});

test('the probe says why it cannot read, and how to use it', async () => {
  const phone = new FakePhone({ username: USERNAME, password: PASSWORD });
  const server = await phone.serve();
  const refused = await run([server.origin], {
    IPWEBCAM_USER: USERNAME,
    IPWEBCAM_PASSWORD: 'wrong-secret',
  });
  await server.close();
  assert.equal(refused.code, 1);
  assert.match(refused.output, /password refused/);
  assert.ok(!refused.output.includes('wrong-secret'));
  assert.equal((await run([])).code, 2);
  assert.equal((await run(['192.0.2.10'], { IPWEBCAM_USER: 'only-user' })).code, 2);
});
