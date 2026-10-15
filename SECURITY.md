# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes. In
particular:

- **Secrets**: the login of the IP Webcam app (user name and password) lives in
  the Gladys configuration of the integration (the password in a `secret`
  field). It is sent only to the configured phones, as HTTP Basic
  authentication, and is never written to the logs, to `/data`, to an error
  message or to the stream address shown to the user (`PASSWORD` stands in its
  place). An address typed with credentials (`user:pass@host`) is refused.
  Without HTTPS on the phone, Basic authentication travels in clear on the
  local network: turn on HTTPS in the app if your network is not trusted.
- **`/data`**: the only file is `ip-webcam-state.json`: what each phone offers
  (its sensors and settings) and the end time of the recordings started by a
  scene. No secret, no image.
- **Network**: the integration talks only to the configured addresses (HTTP,
  or HTTPS when chosen; the app only has a self-signed certificate, which is
  then accepted), never to a cloud. It only sends GET requests.
- **Safety**: turning off the motion detection of the phone (disarming it) is
  disabled by default and is never a device feature: only a scene action, once
  allowed in the configuration. Turning it on is always allowed.
- **Camera images** stay in memory (the last one per phone, for the widget) and
  go to Gladys only. Recordings stay on the phone.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the IP Webcam app and the phones (report those to the author of the app).
