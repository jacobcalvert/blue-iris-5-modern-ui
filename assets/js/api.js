(function () {
  "use strict";

  class BlueIrisError extends Error {
    constructor(message, code = "request_failed", details = null) {
      super(message);
      this.name = "BlueIrisError";
      this.code = code;
      this.details = details;
    }
  }

  function normalizeBaseUrl(value) {
    let input = String(value || "").trim();
    if (!input) throw new BlueIrisError("Enter the address of your Blue Iris server.", "invalid_url");
    if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(input)) input = `http://${input}`;

    let url;
    try {
      url = new URL(input);
    } catch {
      throw new BlueIrisError("The server address is not a valid URL.", "invalid_url");
    }
    if (!/^https?:$/.test(url.protocol)) {
      throw new BlueIrisError("Use an HTTP or HTTPS Blue Iris server address.", "invalid_url");
    }
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname
      .replace(/\/(?:login|xlogin|default|ui3|index)\.html?\/?$/i, "/")
      .replace(/\/+$/, "");
    return url.href.replace(/\/+$/, "");
  }

  function mergeLoginData(data) {
    if (!Array.isArray(data)) return data && typeof data === "object" ? data : {};
    return data.reduce((result, item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) Object.assign(result, item);
      return result;
    }, {});
  }

  function appendPath(baseUrl, path) {
    return `${baseUrl}/${String(path).replace(/^\/+/, "")}`;
  }

  function apiBaseCandidates(baseUrl) {
    const normalized = normalizeBaseUrl(baseUrl);
    const url = new URL(normalized);
    const candidates = [normalized];
    if (url.pathname && url.pathname !== "/") candidates.push(url.origin);
    return [...new Set(candidates)];
  }

  function encodeMediaPath(value) {
    return String(value || "")
      .replace(/\\/g, "/")
      .split("/")
      .map((segment) => encodeURIComponent(segment).replace(/%40/gi, "@"))
      .join("/");
  }

  function alertImageReference(value) {
    const path = String(value || "");
    return /^@[^/]+(?:\.[^./]+)?$/.test(path)
      ? path.replace(/\.[^./]+$/, "")
      : path;
  }

  class BlueIrisClient {
    constructor(baseUrl, options = {}) {
      this.isDemo = false;
      this.baseUrl = normalizeBaseUrl(baseUrl);
      this.serverName = new URL(this.baseUrl).host;
      this.session = null;
      this.username = "";
      this.permissions = {};
      this.timeout = options.timeout || 14000;
      this.apiBaseUrl = null;
      this.apiCandidates = apiBaseCandidates(this.baseUrl);
      // Blue Iris reports camera talk capability in PTZ metadata, but its
      // documented JSON API does not define a browser microphone upload route.
      this.talkbackTransportSupported = false;
    }

    isSameOrigin(baseUrl = this.baseUrl) {
      return window.location.protocol !== "file:" && new URL(baseUrl).origin === window.location.origin;
    }

    syncSessionCookie() {
      if (!this.session || !this.isSameOrigin()) return;
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `session=${encodeURIComponent(this.session)}; Path=/; SameSite=Lax${secure}`;
    }

    clearSessionCookie() {
      if (!this.isSameOrigin()) return;
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `session=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    }

    useResolvedBaseUrl(baseUrl) {
      this.apiBaseUrl = baseUrl;
      this.baseUrl = baseUrl;
      this.serverName = new URL(baseUrl).host;
    }

    async postToBase(baseUrl, body, allowFailure = false) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), this.timeout);
      let response;
      const endpoint = appendPath(baseUrl, "json");

      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify(body),
          credentials: this.isSameOrigin(baseUrl) ? "same-origin" : "omit",
          cache: "no-store",
          signal: controller.signal
        });
      } catch (error) {
        if (error.name === "AbortError") {
          throw new BlueIrisError("The Blue Iris server did not respond in time.", "timeout", error);
        }
        const crossOrigin = !this.isSameOrigin(baseUrl);
        const hint = crossOrigin
          ? " Confirm the server is reachable, allows browser cross-origin requests, and uses a compatible HTTP/HTTPS scheme."
          : " Confirm the Blue Iris web server is running and the address is correct.";
        throw new BlueIrisError(`Could not reach the Blue Iris JSON API.${hint}`, "network", error);
      } finally {
        window.clearTimeout(timeoutId);
      }

      if (!response.ok) {
        throw new BlueIrisError(
          `Blue Iris returned HTTP ${response.status} ${response.statusText}.`,
          `http_${response.status}`,
          { endpoint, responseUrl: response.url }
        );
      }

      const responseUrl = String(response.url || "");
      const redirectedToLogin = response.redirected && /\/login\.html?(?:[?#]|$)/i.test(responseUrl);
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (error) {
        const looksLikeLoginPage =
          redirectedToLogin ||
          contentType.includes("text/html") ||
          /<(?:!doctype\s+html|html|form)\b|blue\s+iris\s+login/i.test(responseText.slice(0, 1200));
        throw new BlueIrisError(
          looksLikeLoginPage
            ? `The JSON endpoint at ${endpoint} redirected to the Blue Iris login page.`
            : `The Blue Iris endpoint at ${endpoint} did not return JSON.`,
          looksLikeLoginPage ? "login_redirect" : "invalid_response",
          { endpoint, responseUrl, cause: error }
        );
      }

      if (!allowFailure && String(data?.result).toLowerCase() === "fail") {
        const reason =
          data?.data?.reason ||
          data?.data?.status ||
          data?.data?.error ||
          data?.reason ||
          data?.status ||
          data?.error ||
          "The request was rejected by Blue Iris.";
        const sessionRejected =
          /(?:invalid|missing|expired|unknown|no such)\s+session|session\s+(?:invalid|missing|expired|unknown)/i.test(reason) ||
          (Boolean(body?.session) && !data?.data && !data?.reason);
        if (sessionRejected) {
          this.session = null;
          this.clearSessionCookie();
        }
        throw new BlueIrisError(reason, sessionRejected ? "session" : "api_failure", data);
      }
      return data;
    }

    async post(body, allowFailure = false) {
      const candidates = this.apiBaseUrl ? [this.apiBaseUrl] : this.apiCandidates;
      let lastError = null;

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        try {
          const data = await this.postToBase(candidate, body, allowFailure);
          this.useResolvedBaseUrl(candidate);
          return data;
        } catch (error) {
          lastError = error;
          const canTryNext =
            !this.apiBaseUrl &&
            index < candidates.length - 1 &&
            ["http_404", "invalid_response", "login_redirect"].includes(error?.code);
          if (!canTryNext) throw error;
        }
      }

      throw lastError || new BlueIrisError("Could not locate the Blue Iris JSON API.", "api_not_found");
    }

    async login(username, password) {
      this.username = String(username || "").trim();
      if (!this.username || !password) {
        throw new BlueIrisError("Enter both a username and password.", "missing_credentials");
      }

      const challenge = await this.post({ cmd: "login" }, true);
      if (!challenge?.session) {
        throw new BlueIrisError("Blue Iris did not provide a login session.", "invalid_challenge");
      }

      this.session = challenge.session;
      const responseHash = window.biMd5(`${this.username}:${this.session}:${password}`);
      const result = await this.post(
        {
          cmd: "login",
          session: this.session,
          response: responseHash,
          uuid: this.deviceId(),
          devicename: "Blue Iris Mobile Web",
          devicetype: "Web"
        },
        true
      );

      if (String(result?.result).toLowerCase() !== "success") {
        this.session = null;
        this.clearSessionCookie();
        const reason = result?.data?.reason || result?.reason || "The username or password was not accepted.";
        throw new BlueIrisError(reason, "authentication");
      }

      this.session = result.session || this.session;
      this.syncSessionCookie();
      this.permissions = mergeLoginData(result.data);
      this.serverName =
        this.permissions.systemname ||
        this.permissions["system name"] ||
        this.permissions.system ||
        this.permissions.name ||
        new URL(this.baseUrl).host;
      return this.permissions;
    }

    async resumeSession(session, cached = {}) {
      const sessionKey = String(session || "").trim();
      if (!sessionKey) {
        throw new BlueIrisError("No saved Blue Iris session is available.", "session");
      }

      this.session = sessionKey;
      const result = await this.post({ cmd: "login", session: this.session }, true);
      if (String(result?.result).toLowerCase() !== "success") {
        this.session = null;
        this.clearSessionCookie();
        const reason = result?.data?.reason || result?.reason || "The saved Blue Iris session is invalid or expired.";
        throw new BlueIrisError(reason, "session", result);
      }

      this.session = result.session || this.session;
      this.syncSessionCookie();
      const resumedPermissions = mergeLoginData(result.data);
      this.permissions = Object.keys(resumedPermissions).length
        ? resumedPermissions
        : (cached.permissions && typeof cached.permissions === "object" ? cached.permissions : {});
      this.username =
        this.permissions.user ||
        cached.username ||
        "";
      this.serverName =
        this.permissions.systemname ||
        this.permissions["system name"] ||
        this.permissions.system ||
        this.permissions.name ||
        cached.serverName ||
        new URL(this.baseUrl).host;
      return this.permissions;
    }

    deviceId() {
      const key = "bi-mobile-device-id";
      let value = localStorage.getItem(key);
      if (!value) {
        value = window.crypto?.randomUUID?.() || `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        localStorage.setItem(key, value);
      }
      return value;
    }

    async request(command, payload = {}) {
      if (!this.session) throw new BlueIrisError("Your Blue Iris session has ended. Sign in again.", "session");
      const response = await this.post({ cmd: command, session: this.session, ...payload });
      return Object.prototype.hasOwnProperty.call(response, "data") ? response.data : response;
    }

    emergencyPtzStop(camera, movementButton) {
      if (!this.session || !camera || !Number.isFinite(Number(movementButton))) return false;
      const baseUrl = this.apiBaseUrl || this.baseUrl;
      const body = JSON.stringify({
        cmd: "ptz",
        session: this.session,
        camera,
        button: Number(movementButton),
        updown: 0
      });
      try {
        fetch(appendPath(baseUrl, "json"), {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body,
          credentials: this.isSameOrigin(baseUrl) ? "same-origin" : "omit",
          cache: "no-store",
          keepalive: true
        }).catch(() => {});
        return true;
      } catch {
        return false;
      }
    }

    async logout() {
      if (!this.session) {
        this.clearSessionCookie();
        return;
      }
      try {
        await this.post({ cmd: "logout", session: this.session }, true);
      } finally {
        this.session = null;
        this.clearSessionCookie();
      }
    }

    async loadDashboard(options = {}) {
      const now = Math.floor(Date.now() / 1000);
      const startdate = Number.isFinite(Number(options.startdate))
        ? Math.floor(Number(options.startdate))
        : now - (Number(options.hours) || 168) * 3600;
      const enddate = Number.isFinite(Number(options.enddate))
        ? Math.floor(Number(options.enddate))
        : now;
      const clipStartdate = now - (Number(options.clipHours) || 168) * 3600;
      const canReadClips = this.permissions.clips !== false;

      const [cameras, status, alerts, clips] = await Promise.all([
        this.request("camlist"),
        this.request("status").catch(() => ({})),
        canReadClips
          ? this.request("alertlist", {
              camera: options.alertCamera || options.camera || "index",
              startdate,
              enddate,
              view: options.alertView || "alerts"
            }).catch(() => [])
          : Promise.resolve([]),
        canReadClips
          ? this.request("cliplist", {
              camera: options.camera || "index",
              startdate: clipStartdate,
              enddate: now,
              view: options.clipView || "all"
            }).catch(() => [])
          : Promise.resolve([])
      ]);

      return {
        cameras: Array.isArray(cameras) ? cameras : [],
        status: status && typeof status === "object" ? status : {},
        alerts: Array.isArray(alerts) ? alerts : [],
        clips: Array.isArray(clips) ? clips : []
      };
    }

    queueExport(path, options = {}) {
      return this.request("export", {
        path,
        format: 1,
        profile: 0,
        audio: true,
        reencode: true,
        overlay: true,
        ...options
      });
    }

    exportStatus() {
      // UI3 polls the export queue without a path. Sending the returned export
      // product path back here can be interpreted as a new (non-BVR) source.
      return this.request("export");
    }

    exportDownloadUrl(uri) {
      return this.mediaUrl(`clips/${encodeMediaPath(uri)}`, { dl: 1 });
    }

    updateFlags(path, flags) {
      return this.request("update", {
        path,
        flags: Math.trunc(Number(flags) || 0)
      });
    }

    mediaUrl(path, parameters = {}) {
      const url = new URL(appendPath(this.baseUrl, path));
      if (this.session) url.searchParams.set("session", this.session);
      Object.entries(parameters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
      });
      return url.href;
    }

    imageUrl(camera, width = 960) {
      return this.mediaUrl(`image/${encodeURIComponent(camera)}`, {
        w: width,
        q: 68,
        cache: 1,
        time: Date.now()
      });
    }

    liveStreamUrl(camera, profile = {}, cameraInfo = {}) {
      return this.mediaUrl(`mjpg/${encodeURIComponent(camera)}/video.mjpg`, {
        q: 72,
        fps: 15,
        cache: 1,
        ...this.streamProfileParameters(profile, cameraInfo)
      });
    }

    liveAudioUrl(camera) {
      return this.mediaUrl(`video/${encodeURIComponent(camera)}/2.0`, {
        audio: 1,
        stream: 0,
        h: 180,
        kbps: 64,
        extend: 2
      });
    }

    hlsUrl(camera, profile = {}, cameraInfo = {}) {
      return this.mediaUrl(
        `h264/${encodeURIComponent(camera)}/temp.m3u8`,
        {
          cache: 1,
          ...this.streamProfileParameters(profile, cameraInfo)
        }
      );
    }

    viewerSnapshotUrl(camera, profile = {}, cameraInfo = {}) {
      return this.mediaUrl(`image/${encodeURIComponent(camera)}`, {
        q: 72,
        cache: 1,
        time: Date.now(),
        ...this.streamProfileParameters(profile, cameraInfo)
      });
    }

    streamProfileParameters(profile = {}, cameraInfo = {}) {
      const parameters = { stream: Number(profile.stream ?? 0) };
      if (profile.native) return parameters;

      const maxWidth = Number(profile.width || 0);
      const maxHeight = Number(profile.height || 0);
      const sourceWidth = Number(cameraInfo.width || 1280);
      const sourceHeight = Number(cameraInfo.height || 720);
      if (maxWidth > 0 && maxHeight > 0 && sourceWidth > 0 && sourceHeight > 0) {
        const sourceIsPortrait = sourceWidth < sourceHeight;
        const profileIsPortrait = maxWidth < maxHeight;
        const widthLimit = sourceIsPortrait === profileIsPortrait ? maxWidth : maxHeight;
        const heightLimit = sourceIsPortrait === profileIsPortrait ? maxHeight : maxWidth;
        const sourceAspect = sourceWidth / sourceHeight;
        const profileAspect = widthLimit / heightLimit;
        parameters.h = profileAspect >= sourceAspect
          ? heightLimit
          : Math.max(1, Math.floor(widthLimit / sourceAspect));
      }
      if (Number(profile.kbps) >= 10) parameters.kbps = Number(profile.kbps);
      if (Number(profile.fps) > 0) parameters.fps = Number(profile.fps);
      if (Number(profile.quality) >= 0) parameters.q = Number(profile.quality);
      return parameters;
    }

    hlsRequestUrl(requestUrl) {
      if (!this.session) return requestUrl;
      try {
        const url = new URL(requestUrl, `${this.baseUrl}/`);
        if (/^https?:$/.test(url.protocol) && url.origin === new URL(this.baseUrl).origin) {
          url.searchParams.set("session", this.session);
          if (/\.m3u8?$/i.test(url.pathname)) url.searchParams.set("cache", "1");
        }
        return url.href;
      } catch {
        return requestUrl;
      }
    }

    thumbnailUrl(item) {
      return this.mediaUrl(`thumbs/${encodeMediaPath(item.path || item.clip || "")}`, {
        w: 640,
        q: 68,
        cache: 1,
        v: Number(item.date || 0) || undefined
      });
    }

    alertImageUrl(item) {
      return this.mediaUrl(`alerts/${encodeMediaPath(alertImageReference(item.path))}`, {
        fulljpeg: 1,
        w: 1280,
        q: 80
      });
    }

    recordingUrl(item, time) {
      const path = item.playbackPath || item.clip || item.path || "";
      const parameters = {
        mode: "mjpeg",
        speed: 100,
        addoverlay: 1,
        w: 1280,
        q: 72,
        cache: 1
      };
      if (time !== undefined) parameters.time = time;
      return this.mediaUrl(`file/clips/${encodeMediaPath(path)}`, parameters);
    }

    recordingFrameUrl(item, time = 0) {
      const path = item.playbackPath || item.clip || item.path || "";
      return this.mediaUrl(`file/clips/${encodeMediaPath(path)}`, {
        speed: 0,
        audio: 0,
        stream: 0,
        extend: 2,
        addoverlay: 1,
        time: Math.max(0, Math.floor(Number(time) || 0)),
        w: 1280,
        q: 72,
        cache: 1
      });
    }

    clipAudioUrl(item, time = 0) {
      const path = item.playbackPath || item.clip || item.path || "";
      return this.mediaUrl(`file/clips/${encodeMediaPath(path)}`, {
        speed: 100,
        audio: 1,
        stream: 0,
        extend: 2,
        time: Math.max(0, Math.floor(Number(time) || 0)),
        cache: 1
      });
    }

    snapshotDownloadUrl(camera) {
      return this.mediaUrl(`image/${encodeURIComponent(camera)}`, {
        decode: 1,
        w: 99999,
        q: 90,
        time: Date.now()
      });
    }
  }

  window.BlueIrisClient = BlueIrisClient;
  window.BlueIrisError = BlueIrisError;
  window.normalizeBlueIrisUrl = normalizeBaseUrl;
})();
