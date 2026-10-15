# IP Webcam fixtures

- `status.json` and `sensors.json`: the answers of `/status.json?show_avail=1`
  and `/sensors.json` of a real phone, as kept by the Home Assistant
  integration `android_ip_webcam` in its tests
  (`tests/components/android_ip_webcam/fixtures`, home-assistant/core, Apache-2.0,
  commit f5706e7 of 2026-10-15). Only change: the phone address of `curvals`
  replaced by `192.0.2.88` (documentation range). In this answer, the choices
  of the settings sit at the top level (`"night_vision": ["on", "off"]`).
- `status-avail-recording.json` (built here, not captured): the same phone
  with the choices under `avail`, as `pydroid-ipcam` reads them, the torch on,
  a quality of 90, a portrait orientation, and a `video_status.mode` other
  than `none`, which this integration reads as "recording" (not documented by
  the app: to confirm with `scripts/probe.mjs` on a real phone).
- `sensors-extended.json` (built here): `sensors.json` plus a `pressure` sensor
  and a `battery_charging` flag. Neither is in the Home Assistant fixture; the
  key `battery_charging` is an assumption, to confirm with the probe.
- `sensors-empty.json`: the answer when "Data logging" is off in the app.
