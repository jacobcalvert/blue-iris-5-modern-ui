# Vendored browser libraries

The application keeps its runtime dependencies local so it can be served directly by
Blue Iris without a CDN.

## Media player

`clappr.min.js` is the official minified browser bundle from:

`https://cdn.jsdelivr.net/npm/@clappr/player@0.11.16/dist/clappr.min.js`

Pinned components:

- `@clappr/player` 0.11.16
- `@clappr/core` 0.13.2
- `@clappr/plugins` 0.8.11
- `@clappr/hlsjs-playback` 1.9.4
- `hls.js` 1.6.2

SHA-256:

`953f06a26cb53645a0cf30ef9fbe449dc6644589abc1cdbc19ad529217901fd4`

The HLS playback package declares hls.js 1.6.2 as its exact peer dependency. The
official Clappr player bundle includes that implementation, so a second standalone
`hls.min.js` is neither loaded nor kept here.

This bundle is sourced from the official Clappr npm release and is independent of the
older player stored under `reference/`.

Licenses are retained in `licenses/CLAPPR.txt` and `licenses/HLS-JS.txt`.
