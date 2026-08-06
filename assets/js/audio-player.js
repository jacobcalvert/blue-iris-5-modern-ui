(function () {
  "use strict";

  let sharedAudioContext = null;

  function getSharedAudioContext() {
    if (sharedAudioContext) return sharedAudioContext;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("Web Audio is unavailable in this browser.");
    sharedAudioContext = new AudioContext();
    return sharedAudioContext;
  }

  async function unlockBlueIrisAudio() {
    const context = getSharedAudioContext();
    if (context.state !== "running") await context.resume();

    // Starting a silent buffer during the tap gives iOS an explicit media
    // activation to associate with this shared context.
    const buffer = context.createBuffer(1, 1, context.sampleRate || 44100);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);

    if (context.state !== "running") {
      throw new Error("Audio is blocked. Tap the audio control again to allow playback.");
    }
    return context;
  }

  class ByteQueue {
    constructor() {
      this.chunks = [];
      this.length = 0;
    }

    write(chunk) {
      this.chunks.push(chunk);
      this.length += chunk.length;
    }

    read(size) {
      if (this.length < size) return null;
      const result = new Uint8Array(size);
      let offset = 0;
      while (offset < size) {
        const chunk = this.chunks[0];
        const take = Math.min(chunk.length, size - offset);
        result.set(chunk.subarray(0, take), offset);
        offset += take;
        if (take === chunk.length) this.chunks.shift();
        else this.chunks[0] = chunk.subarray(take);
      }
      this.length -= size;
      return result;
    }
  }

  function uint16LE(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
  }

  function uint32LE(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
  }

  function uint32BE(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
  }

  function int32BE(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, false);
  }

  function decodeMuLaw(bytes) {
    const output = new Float32Array(bytes.length);
    for (let index = 0; index < bytes.length; index += 1) {
      const value = (~bytes[index]) & 0xff;
      const sign = value & 0x80;
      const exponent = (value >> 4) & 0x07;
      const mantissa = value & 0x0f;
      let sample = ((mantissa << 3) + 0x84) << exponent;
      sample -= 0x84;
      output[index] = (sign ? -sample : sample) / 32768;
    }
    return output;
  }

  class BlueIrisPcmAudioPlayer {
    constructor(onStatus) {
      this.onStatus = typeof onStatus === "function" ? onStatus : () => {};
      this.context = null;
      this.gain = null;
      this.controller = null;
      this.sources = new Set();
      this.nextTime = 0;
      this.volume = 0.65;
    }

    ensureContext() {
      if (this.context) return;
      this.context = getSharedAudioContext();
      this.gain = this.context.createGain();
      this.gain.connect(this.context.destination);
      this.setVolume(this.volume);
    }

    setVolume(value) {
      this.volume = Math.max(0, Math.min(1, Number(value) || 0));
      if (this.gain) this.gain.gain.value = this.volume * this.volume;
    }

    stop() {
      this.controller?.abort();
      this.controller = null;
      this.sources.forEach((source) => {
        try { source.stop(); } catch { /* The source may already have ended. */ }
      });
      this.sources.clear();
      this.nextTime = 0;
      this.onStatus("idle");
    }

    async start(url, volume = this.volume) {
      this.stop();
      if (!url || Number(volume) <= 0) return;
      try {
        this.ensureContext();
        this.setVolume(volume);
        await this.context.resume();
      } catch (error) {
        this.onStatus("error", error);
        return;
      }

      const controller = new AbortController();
      this.controller = controller;
      this.onStatus("loading");

      try {
        const target = new URL(url, window.location.href);
        const response = await fetch(target.href, {
          cache: "no-store",
          credentials: target.origin === window.location.origin ? "same-origin" : "omit",
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Blue Iris audio returned HTTP ${response.status}.`);
        if (!response.body?.getReader) throw new Error("Streaming audio is unavailable in this browser.");
        await this.consume(response.body.getReader(), controller);
      } catch (error) {
        if (error?.name !== "AbortError") this.onStatus("error", error);
      } finally {
        if (this.controller === controller) this.controller = null;
      }
    }

    schedule(bytes, format) {
      if (!this.context || !this.gain || format.tag !== 7 || format.channels !== 1) return;
      const samples = decodeMuLaw(bytes);
      const buffer = this.context.createBuffer(1, samples.length, format.sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain);
      source.onended = () => this.sources.delete(source);

      const now = this.context.currentTime;
      if (!this.nextTime || this.nextTime < now) this.nextTime = now + 0.12;
      if (this.nextTime - now > 0.75) return;
      source.start(this.nextTime);
      this.nextTime += buffer.duration;
      this.sources.add(source);
      this.onStatus("playing");
    }

    async consume(reader, controller) {
      const queue = new ByteQueue();
      let state = 0;
      let headerSize = 0;
      let blockType = -1;
      let blockSize = 0;
      let audioFormat = null;

      while (!controller.signal.aborted) {
        const result = await reader.read();
        if (result.done) break;
        queue.write(result.value);

        let progressed = true;
        while (progressed && !controller.signal.aborted) {
          progressed = false;
          if (state === 0) {
            const header = queue.read(6);
            if (!header) continue;
            if (header[0] !== 98 || header[1] !== 108 || header[2] !== 117 || header[3] !== 101) {
              throw new Error("Blue Iris returned an unexpected audio stream format.");
            }
            if (header[4] !== 2) {
              this.onStatus("unavailable");
              controller.abort();
              return;
            }
            headerSize = header[5];
            state = 1;
            progressed = true;
          } else if (state === 1) {
            const header = queue.read(headerSize);
            if (!header) continue;
            const bitmapSize = uint32LE(header, 0);
            if (bitmapSize < header.length && header.length - bitmapSize >= 14) {
              audioFormat = {
                tag: uint16LE(header, bitmapSize),
                channels: uint16LE(header, bitmapSize + 2),
                sampleRate: uint32LE(header, bitmapSize + 4)
              };
            }
            state = 2;
            progressed = true;
          } else if (state === 2) {
            const header = queue.read(5);
            if (!header) continue;
            if (header[0] !== 66 || header[1] !== 108 || header[2] !== 117 || header[3] !== 101) {
              throw new Error("Blue Iris audio framing was interrupted.");
            }
            blockType = header[4];
            state = 3;
            progressed = true;
          } else if (state === 3) {
            if (blockType === 0) {
              const header = queue.read(18);
              if (!header) continue;
              blockSize = uint32BE(header, 14);
            } else if (blockType === 1) {
              const header = queue.read(4);
              if (!header) continue;
              blockSize = int32BE(header, 0);
            } else if (blockType === 2) {
              const header = queue.read(1);
              if (!header) continue;
              blockSize = header[0] - 6;
            } else if (blockType === 4) {
              this.onStatus("ended");
              return;
            } else {
              throw new Error(`Unknown Blue Iris audio block type ${blockType}.`);
            }
            if (blockSize < 0 || blockSize > 10000000) {
              throw new Error("Blue Iris returned an invalid audio block size.");
            }
            state = 4;
            progressed = true;
          } else if (state === 4) {
            const payload = queue.read(blockSize);
            if (!payload) continue;
            if (blockType === 1 && audioFormat) this.schedule(payload, audioFormat);
            state = 2;
            progressed = true;
          }
        }
      }
    }
  }

  window.unlockBlueIrisAudio = unlockBlueIrisAudio;
  window.BlueIrisPcmAudioPlayer = BlueIrisPcmAudioPlayer;
})();
