# IP Webcam for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
turns an **old Android phone** into a **camera and a set of sensors**, with the
free **IP Webcam** app by Pavel Khlebovich, over the app's local HTTP API (the
same API the Home Assistant integration
[`android_ip_webcam`](https://www.home-assistant.io/integrations/android_ip_webcam/)
uses). No cloud, nothing leaves your network.

> **Developed without the hardware: feedback welcome.** It was written from the
> Home Assistant integration, its library `pydroid-ipcam` and the real answers
> of a phone they keep in their tests, without a phone running IP Webcam at
> hand. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-ip-webcam/issues), with the logs
> (`LOG_LEVEL=debug`). `scripts/probe.mjs` (below) shows what a real phone
> answers.
>
> This integration is **not affiliated with the IP Webcam app** nor with its
> author.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## Features

One Gladys device per phone, with only what the phone offers:

- **Camera image** (`/shot.jpg`), resized in a worker thread to fit Gladys
  (150 KB): on a timer (every minute by default), at each motion, on request.
- **Sensors** (the app's "Data logging"): battery level, charging (when the app
  reports it), battery temperature, light level, sound level, motion (the app's
  own detection), proximity, pressure. A short motion between two reads is
  still seen (1 then 0), and the sound level is the loudest since the last
  read, so a short noise crosses a scene threshold.
- **Controls**: torch, focus lock, night vision, video recording, orientation,
  image quality.
- **Motion detection** (the app's "security mode"): read only on the device.
  Turning it on or off is a scene action; turning it **off** disarms the phone,
  so it is refused unless allowed in the configuration (off by default).
- **Scene actions**: take a fresh image, record a video for N minutes (stopped
  even after a restart; a recording started by hand is never stopped), stop a
  recording, turn the motion detection on or off.
- **Dashboard widget** "IP Webcam phones": every phone at a glance (online,
  battery, temperature, warning above 45 °C), or one phone with its image,
  status and buttons (image, torch, recording).
- **Configuration actions**: test the connection, show the RTSP address for the
  "RTSP camera" integration of Gladys (live video), password replaced by
  `PASSWORD`.
- No scene trigger of its own: motion, sound, charging and online are device
  states, and the scenes of Gladys already trigger on them. The image of a
  motion is published **before** its state, so "send camera image" sends the
  right one.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys **5.1.0** or later.
- An Android phone running **IP Webcam**, with its server started, reachable
  from Gladys, at a **fixed address** (the app has no serial number: address
  and port are the identity of the phone).
- Optional: "Data logging" on in the app for the sensors, a login/password
  set in the app.

## Installation

In Gladys: **Integrations → Install from GitHub**, then
`https://github.com/guim31/gladys-ip-webcam`. Fill in the addresses of the
phones (and the login, if set in the app) in the **Configuration** tab, then
add the phones from the **Discover** tab.

## How it works

```
index.js            SDK wiring (src/app.js registers every handler)
src/hub.js          every phone: reads on a timer, states, images, commands, timed recordings
src/devices.js      the Gladys device of a phone, feature names (4 languages), values
src/ipwebcam/       HTTP client (Basic auth, 2 requests in flight), the meaning of the answers
src/image*.js       JPEG → Gladys camera image (≤ 150 KB), pure JavaScript, in a worker
src/widgets.js      the dashboard widget
src/scenes.js       the scene actions
scripts/probe.mjs   read-only probe of a real phone
```

- **Refresh**: Gladys does not poll external devices reliably
  (GladysAssistant/Gladys#3198): the devices are published with
  `should_poll: false` and the integration reads each phone on its own timer
  (10 s by default: `/status.json?show_avail=1` and `/sensors.json`), with an
  `onPoll` fallback. Only the changed values are published, and the unchanged
  ones again every 6 hours.
- **What a phone offers** (its sensors and settings) is kept in
  `/data/ip-webcam-state.json`, with the end of the timed recordings, so a
  phone off at start keeps its features and a recording is stopped after a
  restart.
- **Logs**: the lifecycle at `info` (start, a phone lost and back, one line per
  user command); a problem that repeats is logged once and once when it clears;
  the rest at `debug`. Never a password.

## What could not be checked

There was no phone running IP Webcam, nor a Gladys instance, while writing
this integration. The test suite runs the whole integration against the SDK's
fake Gladys and a fake phone built from the Home Assistant fixtures. To be
confirmed on a real phone, with `scripts/probe.mjs`:

- the key of the charging sensor (`battery_charging` is assumed; absent from
  the Home Assistant fixtures, so the feature only appears if the app sends
  it);
- the value of `video_status.mode` while recording (anything but `none` is read
  as "recording");
- that `/focus` and `/nofocus` answer "Ok", and the effect of `/focus`.

```bash
node scripts/probe.mjs 192.168.1.50 30                       # no login in the app
IPWEBCAM_USER=me IPWEBCAM_PASSWORD=… node scripts/probe.mjs https://192.168.1.50:8080 30
```

It reads the status, the sensors and one frame, prints what the integration
makes of them, then watches the changes for 30 seconds (move, make noise, start
a recording, plug the charger). It writes nothing to the phone, and prints
neither the password nor the address the phone reports for itself.

## Limitations

- The identity of a phone is its address and port: a new address makes a new
  device.
- The sound level is the app's relative scale, not calibrated decibels.
- The focus lock is not reported by the app.
- Images, not video: use the "RTSP camera" integration of Gladys for live
  video. No audio.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and a simulated phone (`test/helpers/fakePhone.js`, built from
`test/fixtures/ipwebcam`). `test/gladys-rules.test.js` checks every device
against the category/type couples, units and rules of the Gladys core. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

### Releasing

Describe each change under `## [Unreleased]` in
[`CHANGELOG.md`](CHANGELOG.md), then **Actions → Release → Run workflow**
(`patch`, `minor` or `major`): the workflow bumps the version everywhere, moves
the changelog section, tags, builds the multi-arch image to `ghcr.io` and
publishes the GitHub Release.

> A hand-pushed tag (`git tag v1.2.3 && git push --tags`) triggers the same
> build and Release, but does **not** bump anything: update `version` in
> `package.json` and in `gladys-assistant-integration.json` (with the
> `docker_image` tag) and commit it before tagging.

## Credits

- [home-assistant-libs/pydroid-ipcam](https://github.com/home-assistant-libs/pydroid-ipcam)
  (Apache-2.0, Pascal Vizeli and contributors): the endpoints of the app, the
  commands and their "Ok", the orientations.
- The Home Assistant integration
  [`android_ip_webcam`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/android_ip_webcam)
  (Apache-2.0, the Home Assistant authors): the sensors and switches it reads,
  and the real answers of a phone kept in its tests, reused as fixtures
  (`test/fixtures/ipwebcam`, address anonymised).
- [jpeg-js](https://github.com/eugeneware/jpeg-js) (BSD-3-Clause) encodes the
  resized images.
- The architecture, the image pipeline, the conformity tests and the quiet logs
  follow [gladys-dahua](https://github.com/guim31/gladys-dahua),
  [gladys-unifi-protect](https://github.com/guim31/gladys-unifi-protect),
  [gladys-pihole](https://github.com/guim31/gladys-pihole) and
  [gladys-wled](https://github.com/guim31/gladys-wled).
- The IP Webcam app is the work of Pavel Khlebovich.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by the IP Webcam app
or its author. Android and Google Play are trademarks of Google LLC.

## License

Apache-2.0 — see [`LICENSE`](LICENSE).
