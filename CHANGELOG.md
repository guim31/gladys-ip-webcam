# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- An old Android phone running the IP Webcam app becomes a Gladys device,
  locally: camera image, battery level, charging, battery temperature, light
  level, sound level, motion, proximity and pressure (each when the phone
  offers it), and the controls torch, focus lock, night vision, video
  recording, orientation and image quality.
- The motion detection of the app, shown on the device and turned on or off by
  a scene action; turning it off is refused unless allowed in the
  configuration.
- A fresh image at each motion, published before the motion, so a scene sends
  the right image. A short motion between two reads is still seen, and the
  sound level is the loudest since the last read.
- Scene actions: take an image, record a video for a chosen time (stopped even
  after a restart), stop a recording, phone motion detection.
- Dashboard widget "IP Webcam phones": every phone with its battery and
  temperature, or one phone with its image and buttons.
- Configuration actions: test the connection, show the RTSP address for live
  video.
- Several phones, HTTP or HTTPS, optional login; the phones are read every 10
  seconds by default, the images renewed every minute by default.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/guim31/gladys-ip-webcam/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-ip-webcam/releases/tag/v1.0.1
