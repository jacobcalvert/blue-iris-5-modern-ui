# Blue Iris Mobile

A responsive, static web client for Blue Iris 5. It includes one-second live camera tiles, aggregate and per-camera audio, a background audio-monitor mode, selectable UI3-style stream profiles, scrubbable recording playback with audio, alerts, press-and-hold PTZ controls, server-backed PTZ presets, manual recording, triggers, shield/profile controls, and system health.

## Run locally

The app has no runtime CDN dependencies. The checked-in `login.htm` is already built, so
you can serve this directory with any static HTTP server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`. The lightweight `index.html` entry redirects to
`login.htm`, matching the page Blue Iris uses for unauthenticated web sessions.

Opening `index.html` directly with a `file://` URL is not recommended because browsers restrict network and media behavior for local files.

## Connect to Blue Iris

1. Enter the Blue Iris web server origin or login-page URL, for example
   `http://192.168.1.20:81` or `http://192.168.1.20:81/login.htm`.
2. Sign in with a Blue Iris user account.
3. The app establishes a secure Blue Iris JSON session using the documented challenge/MD5 response flow. The password is not stored.

The active session key is saved in this site's browser storage so a hard refresh can resume without another password prompt. On startup the app asks Blue Iris to validate that key and refresh its permissions. An invalid or expired key is removed immediately; a temporary network failure leaves it cached for a later retry. Choosing **Sign out** also removes it.

When the app is served as Blue Iris's `login.htm`, the server field defaults to the
containing Blue Iris URL, including a configured virtual directory. The API client removes
entry-page names before requesting `json` and, like UI3, falls back to the server origin if
the virtual-directory endpoint returns 404 or HTML.

### Install in the Blue Iris WWW folder

Back up the original Blue Iris `login.htm`, then copy this project's generated `login.htm`
into the configured Blue Iris WWW root. Blue Iris protects ordinary static files before
login, so this entry file contains its Bootstrap CSS, application CSS, JavaScript, icons, and
demo images inline. It does not request a manifest or other application asset until a session
exists. After a successful same-origin JSON login, the app also sets Blue Iris's standard
`session` cookie so authenticated resource requests work normally.

Blue Iris upgrades may restore the bundled login page, so keep this project available to
copy back after an update.

### Rebuild `login.htm`

Edit `app.html` and the files under `assets`, then regenerate the deployable entry:

```bash
node scripts/build-login.mjs
```

The build fails if an external stylesheet, script, or manifest reference remains, or if the
result contains non-ASCII text that Blue Iris could serve with the wrong encoding. Commit
both the source changes and the regenerated `login.htm`.

### Remote-origin browser requirements

A static browser app cannot bypass browser security:

- Blue Iris must allow requests from the origin hosting this app.
- An HTTPS-hosted app cannot access an HTTP-only Blue Iris server due to mixed-content blocking.
- When the app and Blue Iris share a hostname, saved HTTP addresses are automatically upgraded to the page's HTTPS origin. Absolute `/h264/` URLs emitted inside Blue Iris HLS playlists are also routed back through the configured Blue Iris origin, preventing internal proxy hostnames from creating mixed-content or CORS failures.
- Serving the app from Blue Iris itself, or placing both behind the same HTTPS reverse proxy, avoids these issues.
- A reverse proxy must forward the complete Blue Iris media prefixes, especially `/h264/`. HLS playlists reference short-lived numbered `.ts` files under that same path, and `.m3u8` responses must not be cached.
- Audio requires the `/audio/`, low-latency `/video/`, and `/file/clips/` routes to pass through unchanged. Browser autoplay rules require an explicit click before audio can begin.

## Background audio monitor

The single-camera viewer's **Monitor** control starts Blue Iris's native
`/audio/{camera}/temp.wav` stream in a persistent HTML audio player. It keeps playing after
the camera dialog closes, exposes pause/stop metadata through the browser's lock-screen media
controls, and reconnects transiently interrupted streams. The floating monitor bar controls
volume, pause/resume, and stop.

This native media path is substantially more background-friendly than the app's Web Audio
decoder, but the operating system and browser retain final control over lock-screen playback.
Start Monitor with a tap before locking the phone. HTTPS, adding the app to the home screen,
and disabling browser-specific battery restrictions generally provide the most reliable result.

## PTZ, presets, and talkback

The eight-way directional and zoom controls send Blue Iris's paired movement commands:
pressing starts movement with `updown: 1`, and releasing repeats the command with
`updown: 0` to stop it. Diagonal movement uses commands `59-62`.
The center control sends the independent stop command (`64`), while Home remains available
as command `4`. The app also sends a safety stop when the camera dialog closes, the page
loses focus, or a movement remains active for ten seconds.

The camera control panel also reads the current IR mode from PTZ metadata and can explicitly
set supported camera IR LEDs to Off (`34`), On (`35`), or Auto (`36`).

Preset names and counts come from the camera's `ptz` metadata. Any user with PTZ permission
can call a preset. Blue Iris administrator access is required to assign the camera's current
position to a preset and save its description.

Blue Iris may report a `talksamplerate` for cameras configured for two-way audio. The
documented JSON web API does not define a microphone-upload transport, and UI3 does not
implement one, so this app reports the capability but keeps Talk disabled. This avoids
requesting microphone access for a control that the server cannot receive. Talkback can be
enabled later only if Blue Iris exposes a supported browser transport for it.

## Demo mode

Demo mode is hidden during normal use. Open `login.htm?demo=1` (or
`app.html?demo=1` while developing) to reveal **Explore demo dashboard** and use the full
interface with local sample data. The exact `demo=1` parameter is also checked before the
mock client can start, so the hidden control cannot activate demo mode accidentally.

## Files

- `app.html` - source application shell, login form, and dialogs
- `login.htm` - generated, self-contained Blue Iris login entry
- `index.html` - static-server redirect to `login.htm`
- `scripts/build-login.mjs` - bundles the application into `login.htm`
- `assets/css/app.css` - responsive visual system
- `assets/js/api.js` - Blue Iris JSON and media API client
- `assets/js/app.js` - UI state and interaction logic
- `assets/js/audio-player.js` - streamed Blue Iris clip-audio parser and Web Audio playback
- `assets/js/mock-data.js` - local demonstration adapter
- `assets/vendor/` - locally pinned Bootstrap and Blue Iris UI3-compatible Clappr playback libraries

## Supported API areas

- `login`, `logout`
- `camlist`, `camconfig`
- `alertlist`, `cliplist`
- `status`
- `ptz`
- `trigger`
- `/image`, `/mjpg`, `/h264`, `/audio`, `/video`, `/alerts`, `/thumbs`, and `/file/clips` media routes

Destructive administration operations such as deleting clips, rebooting the host, and database maintenance are intentionally not exposed.
