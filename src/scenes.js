// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+). Keys are
// permanent once published.
//
//   - take_image: a fresh image of a phone, sent to Gladys, so the next action
//     ("send the camera image" in a message) sends what it sees now;
//   - record_video: record on the phone for N minutes (the file stays on the
//     phone), then stop — a motion at night, a door opened. A recording already
//     running that the integration did not start is left alone;
//   - stop_recording: stop a recording;
//   - set_motion_detection: the "security mode" of the app. Turning it off
//     disarms the phone: refused unless allowed in the configuration, and
//     never a switch of the device (no dashboard toggle, no voice assistant).
// Gladys applies the field defaults to scene actions; a failure throws, the
// scene logs it and carries on.
// -----------------------------------------------------------------------------

export const RECORDING_MINUTES = Object.freeze(['1', '2', '5', '10', '30', '60']);
export const DEFAULT_RECORDING_MINUTES = '2';
export const MOTION_STATES = Object.freeze(['on', 'off']);

const minutesOf = (value) =>
  Number(RECORDING_MINUTES.includes(String(value)) ? value : DEFAULT_RECORDING_MINUTES);

// A recording tag names the file on the phone: letters, digits, - and _ only.
const tagOf = (value) =>
  typeof value === 'string' && value.trim()
    ? value
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, '_')
        .slice(0, 40)
    : null;

export const SCENE_ACTIONS = {
  async take_image(hub, { fields = {} }) {
    await hub.refreshImage(fields.phone);
  },

  async record_video(hub, { fields = {} }) {
    const started = await hub.startRecording(fields.phone, {
      minutes: minutesOf(fields.minutes),
      tag: tagOf(fields.tag),
    });
    return { started };
  },

  async stop_recording(hub, { fields = {} }) {
    await hub.stopRecording(fields.phone);
  },

  async set_motion_detection(hub, { fields = {} }) {
    await hub.setMotionDetection(fields.phone, String(fields.state ?? 'on') !== 'off');
  },
};
