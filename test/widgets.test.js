// -----------------------------------------------------------------------------
// The dashboard widget: every content it can produce fits the vocabulary and
// the budget of the core (validateWidgetContent), its tiles point at features
// that exist, its buttons act on the phone, and its image is served.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { WIDGET_ACTIONS, batteryLine } from '../src/widgets.js';
import { BASE_CONFIG, createAll, createWorld, ids } from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  const found = validateWidgetContent(ack.data.content);
  assert.deepEqual(found, [], JSON.stringify(ack.data.content));
  return ack.data.content;
}

const byType = (c, type) => c.components.filter((component) => component.type === type);

test('every phone: one tile, one status line per phone', async (t) => {
  const w = await world(t);
  await createAll(w);
  for (const language of ['en', 'fr', 'de', 'es']) {
    const c = await content(w, {}, language);
    assert.equal(byType(c, 'value')[0].value, '2/2');
    assert.equal(byType(c, 'status')[0].items.length, 2);
  }
  const c = await content(w);
  assert.equal(byType(c, 'status')[0].items[0].value, '87 % ⚡ · 33.9 °C');
  w.phones.kitchen.online = false;
  await w.hub.refresh();
  const down = await content(w);
  assert.equal(byType(down, 'value')[0].value, '1/2');
  assert.equal(byType(down, 'status')[0].items[0].value, 'Offline');
  assert.equal(byType(down, 'status')[0].items[0].color, 'danger');
});

test('a hot battery is a warning', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.clock.advance(10_000);
  w.phones.garage.sample('battery_temp', 47.5, { unit: '℃' });
  await w.hub.refresh();
  const c = await content(w);
  assert.match(byType(c, 'text')[0].text, /above 45 °C/);
  assert.equal(byType(c, 'status')[0].items[1].color, 'warning');
  const single = await content(w, { phone: ids(w.gladys, 'garage').device });
  assert.ok(byType(single, 'text').some((text) => /above 45 °C/.test(text.text)));
});

test('one phone: image, live tiles of features that exist, status, buttons', async (t) => {
  const w = await world(t);
  await createAll(w);
  const kitchen = ids(w.gladys, 'kitchen');
  const c = await content(w, { phone: kitchen.device }, 'fr');
  const features = new Set(
    w.fake.discoveredDevices.flatMap((d) => d.features.map((f) => f.external_id)),
  );
  for (const tile of byType(c, 'value')) {
    assert.ok(features.has(tile.device_feature), tile.device_feature);
  }
  assert.equal(byType(c, 'image').length, 1);
  const image = await w.fake.widgetGetImage(byType(c, 'image')[0].key);
  assert.equal(image.success, true, image.error);
  assert.deepEqual(validateWidgetImage(image.data.image), []);
  const keys = byType(c, 'button').map((button) => button.action.key);
  assert.deepEqual(keys, ['image', 'torch_on', 'record_start']);
  assert.ok(keys.every((key) => WIDGET_ACTIONS.includes(key)));
  assert.equal(new Set(keys).size, keys.length, 'the core drops a repeated action key');
});

test('a phone not added yet shows the values read, not live tiles', async (t) => {
  const w = await world(t);
  const c = await content(w, { phone: ids(w.gladys, 'kitchen').device });
  const tiles = byType(c, 'value');
  assert.equal(tiles[0].value, 87);
  assert.equal(tiles[0].device_feature, undefined);
});

test('the buttons act on the phone, and show the choice in use by an icon', async (t) => {
  const w = await world(t);
  await createAll(w);
  const phone = ids(w.gladys, 'kitchen').device;
  const tap = (key) => w.fake.widgetAction(WIDGET_KEY, key, { phone }, { settings: { phone } });

  let ack = await tap('torch_on');
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.phones.kitchen.curvals.torch, 'on');
  assert.equal(ack.data.message.fr, 'Lampe torche allumée.');
  let c = await content(w, { phone });
  const torch = byType(c, 'button').find((b) => b.action.key === 'torch_off');
  assert.equal(torch.icon, 'check-circle');
  assert.equal(torch.style, 'secondary', 'never `primary`: invisible in dark mode');

  assert.equal((await tap('record_start')).success, true);
  assert.equal(w.phones.kitchen.recording, true);
  c = await content(w, { phone });
  assert.ok(byType(c, 'button').some((b) => b.action.key === 'record_stop'));
  assert.equal((await tap('record_stop')).success, true);
  assert.equal(w.phones.kitchen.recording, false);
  assert.equal((await tap('torch_off')).success, true);
  assert.equal(w.phones.kitchen.curvals.torch, 'off');
  const images = w.fake.cameraImages.length;
  ack = await tap('image');
  assert.equal(ack.success, true);
  assert.equal(w.fake.cameraImages.length, images + 1);
  const unknown = await tap('explode');
  assert.equal(unknown.success, false);
});

test('an offline phone: the reason, no button; an unknown phone; nothing configured', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.phones.kitchen.online = false;
  await w.hub.refresh();
  const c = await content(w, { phone: ids(w.gladys, 'kitchen').device });
  assert.match(byType(c, 'text')[0].text, /does not answer/);
  assert.equal(byType(c, 'button').length, 0);
  const unknown = await content(w, { phone: 'ext:test-integration:phone:gone' });
  assert.match(unknown.components[0].text, /no longer configured/);
  const empty = await world(t, { config: { ...BASE_CONFIG, hosts: '' } });
  const none = await content(empty);
  assert.match(none.components[0].text, /Enter the address/);
});

test('the status line of a phone', () => {
  const phone = {
    online: true,
    readings: { battery: 54.4, batteryTemperature: 31.25, charging: false },
  };
  assert.equal(batteryLine(phone, 'fr'), '54 % · 31,3 °C');
  assert.equal(batteryLine({ online: true, readings: {} }, 'de'), 'Online');
  assert.equal(batteryLine({ online: false, readings: {} }, 'es'), 'Sin conexión');
});
