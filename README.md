# Blue Iris Mobile

A responsive, static web client for Blue Iris 5. It includes one-second live camera tiles, aggregate and per-camera audio, selectable UI3-style stream profiles, scrubbable recording playback with audio, alerts, PTZ controls, manual recording, triggers, shield/profile controls, and system health.

## Run locally

The app has no build step and no runtime CDN dependencies. Serve this directory with any static HTTP server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Opening `index.html` directly with a `file://` URL is not recommended because browsers restrict network and media behavior for local files.

## Connect to Blue Iris

1. Enter the complete Blue Iris web server origin, for example `http://192.168.1.20:81`.
2. Sign in with a Blue Iris user account.
3. The app establishes a secure Blue Iris JSON session using the documented challenge/MD5 response flow. The password is not stored.

The active session key is saved in this site's browser storage so a hard refresh can resume without another password prompt. On startup the app asks Blue Iris to validate that key and refresh its permissions. An invalid or expired key is removed immediately; a temporary network failure leaves it cached for a later retry. Choosing **Sign out** also removes it.

When the app is served by the Blue Iris web server, the server field defaults to the current origin.

### Remote-origin browser requirements

A static browser app cannot bypass browser security:

- Blue Iris must allow requests from the origin hosting this app.
- An HTTPS-hosted app cannot access an HTTP-only Blue Iris server due to mixed-content blocking.
- Serving the app from Blue Iris itself, or placing both behind the same HTTPS reverse proxy, avoids these issues.
- A reverse proxy must forward the complete Blue Iris media prefixes, especially `/h264/`. HLS playlists reference short-lived numbered `.ts` files under that same path, and `.m3u8` responses must not be cached.
- Audio requires the low-latency `/video/` and `/file/clips/` routes to pass through unchanged. Browser autoplay rules require an explicit click before the all-camera audio mix can begin.

## Demo mode

Choose **Explore demo dashboard** on the login screen to use the full interface with local sample data. This is useful for evaluating the layout without a Blue Iris server.

## Files

- `index.html` - application shell and dialogs
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
- `/image`, `/mjpg`, `/h264`, `/video`, `/alerts`, `/thumbs`, and `/file/clips` media routes

Destructive administration operations such as deleting clips, rebooting the host, and database maintenance are intentionally not exposed.
