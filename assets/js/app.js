(function () {
  "use strict";

  const pageMeta = {
    live: { eyebrow: "Overview", title: "Live view" },
    alerts: { eyebrow: "Activity", title: "Alerts" },
    clips: { eyebrow: "Archive", title: "Recordings" },
    system: { eyebrow: "Operations", title: "System" }
  };

  const STREAM_PROFILES = [
    { id: "native", label: "Native", native: true, stream: 0 },
    { id: "2160p", label: "2160p · 4K", width: 3840, height: 2160, kbps: 8192, stream: 0 },
    { id: "1440p", label: "1440p · 4MP", width: 2560, height: 1440, kbps: 4096, stream: 0 },
    { id: "1080p", label: "1080p · 2MP", width: 1920, height: 1080, kbps: 2048, stream: 0 },
    { id: "720p", label: "720p · 1MP", width: 1280, height: 720, kbps: 1024, stream: 0 },
    { id: "480p", label: "480p", width: 856, height: 480, kbps: 456, stream: 0 },
    { id: "360p", label: "360p", width: 640, height: 360, kbps: 256, stream: 0 }
  ];
  const SESSION_STORAGE_KEY = "bi-mobile-session-v1";
  const ALERT_OFFSET_MS_FLAG = 65536;
  const EXPORT_POLL_INTERVAL_MS = 1800;

  const state = {
    client: null,
    permissions: {},
    cameras: [],
    groups: [],
    alerts: [],
    clips: [],
    status: {},
    currentView: "live",
    selectedGroup: "index",
    selectedTimelineDay: "all",
    activeCamera: null,
    activeRecording: null,
    recordingKind: null,
    refreshTimer: null,
    snapshotTimer: null,
    clockTimer: null,
    hls: null,
    clappr: null,
    refreshing: false,
    autoRefresh: true,
    compactCards: false,
    streamQuality: "1080p",
    activeStreamMode: "mjpeg",
    gridAudioPlayers: new Map(),
    gridAudioEnabled: false,
    gridVolume: 0.45,
    liveAudioPlayer: null,
    liveAudioEnabled: false,
    liveVolume: 0.65,
    recordingAudio: null,
    recordingVolume: 0.65,
    recordingDurationMs: 0,
    recordingPositionMs: 0,
    recordingStartedAt: 0,
    recordingPlaying: false,
    recordingTimer: null,
    recordingSeekPreviewTimer: null,
    recordingFramePending: false,
    exportJobs: new Map()
  };

  const el = {};

  function cacheElements() {
    [
      "loginScreen", "loginForm", "loginButton", "loginError", "serverInput", "usernameInput",
      "passwordInput", "appShell", "pageEyebrow", "pageTitle", "serverClock", "shieldButton",
      "shieldLabel", "topAlertBadge", "railAlertCount", "mobileAlertBadge", "railServerName",
      "railServerStatus", "accountName", "accountRole", "avatarInitials", "mainContent",
      "cameraSearch", "groupSelect", "cameraGrid", "cameraCountLabel", "liveHeading", "liveSubtitle",
      "gridAudioToggle", "gridVolume",
      "alertViewFilter", "alertCameraFilter", "alertTimeFilter", "alertCustomDates",
      "alertStartDate", "alertEndDate", "alertZoneFilter", "alertSortFilter", "alertSearch",
      "alertFilterStatus", "alertSummary", "alertGrid", "clipSearch",
      "clipViewFilter", "clipTimeline", "clipGrid", "healthMetrics", "shieldControl",
      "profileControl", "scheduleStatus", "storageList", "serverDetails", "cameraModal",
      "cameraModalTitle", "cameraModalStatus", "cameraViewport", "cameraStream", "cameraVideo",
      "cameraHlsPlayer", "liveAudioToggle", "liveVolume",
      "viewerTimestamp", "viewerResolution", "streamError", "streamErrorTitle",
      "streamErrorMessage", "streamQualitySelect", "manualRecordButton", "triggerButton",
      "ptzPanel", "presetControl", "snapshotDownload", "recordingModal", "recordingModalTitle",
      "recordingTypeLabel", "recordingStream", "recordingTimestamp", "recordingResolution",
      "recordingPlayToggle", "recordingCurrentTime", "recordingSeek", "recordingDuration",
      "recordingAudioToggle", "recordingVolume",
      "recordingExportButton", "recordingCameraName", "recordingDetails", "settingsModal", "settingsServerName",
      "settingsServerUrl", "autoRefreshToggle", "compactCardsToggle", "toastRegion"
    ].forEach((id) => { el[id] = document.getElementById(id); });
  }

  function readSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem("bi-mobile-settings") || "{}");
      state.autoRefresh = saved.autoRefresh !== false;
      state.compactCards = saved.compactCards === true;
      if (STREAM_PROFILES.some((profile) => profile.id === saved.streamQuality)) {
        state.streamQuality = saved.streamQuality;
      }
      state.gridVolume = clampVolume(saved.gridVolume, state.gridVolume);
      state.liveVolume = clampVolume(saved.liveVolume, state.liveVolume);
      state.recordingVolume = clampVolume(saved.recordingVolume, state.recordingVolume);
      const isWebPage = window.location.protocol === "http:" || window.location.protocol === "https:";
      const isBlueIrisLoginPage = /\/login\.html?$/i.test(window.location.pathname);
      const defaultServer = isWebPage
        ? (isBlueIrisLoginPage
            ? window.normalizeBlueIrisUrl(window.location.href)
            : window.location.origin)
        : "http://localhost:81";
      el.serverInput.value = saved.server || defaultServer;
      el.usernameInput.value = saved.username || "";
    } catch {
      el.serverInput.value = window.location.origin === "null" ? "http://localhost:81" : window.location.origin;
    }

    el.autoRefreshToggle.checked = state.autoRefresh;
    el.compactCardsToggle.checked = state.compactCards;
    el.gridVolume.value = String(state.gridVolume);
    el.liveVolume.value = String(state.liveVolume);
    el.recordingVolume.value = String(state.recordingVolume);
    el.appShell.classList.toggle("compact-cards", state.compactCards);
  }

  function saveSettings(extra = {}) {
    const settings = {
      server: el.serverInput.value.trim(),
      username: el.usernameInput.value.trim(),
      autoRefresh: state.autoRefresh,
      compactCards: state.compactCards,
      streamQuality: state.streamQuality,
      gridVolume: state.gridVolume,
      liveVolume: state.liveVolume,
      recordingVolume: state.recordingVolume,
      ...extra
    };
    localStorage.setItem("bi-mobile-settings", JSON.stringify(settings));
  }

  function readCachedSession() {
    try {
      const cached = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null");
      if (
        !cached ||
        typeof cached !== "object" ||
        !String(cached.server || "").trim() ||
        !String(cached.session || "").trim()
      ) return null;
      return cached;
    } catch {
      return null;
    }
  }

  function cacheCurrentSession() {
    const client = state.client;
    if (!client || client.isDemo || !client.session) return;
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        server: client.baseUrl,
        session: client.session,
        username: client.username || el.usernameInput.value.trim(),
        permissions: state.permissions,
        serverName: client.serverName,
        savedAt: Date.now()
      }));
    } catch {
      // A storage failure should not interrupt an otherwise valid Blue Iris session.
    }
  }

  function clearCachedSession() {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Signing out locally must continue even if browser storage is unavailable.
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function icon(name) {
    return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  }

  function toDate(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return new Date();
    return new Date(numeric > 100000000000 ? numeric : numeric * 1000);
  }

  function formatDateTime(value, includeDate = true) {
    const date = value instanceof Date ? value : toDate(value);
    const options = includeDate
      ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { hour: "numeric", minute: "2-digit" };
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }

  function formatDateTimeLocal(date) {
    const value = date instanceof Date ? date : new Date(date);
    const pad = (number) => String(number).padStart(2, "0");
    return [
      `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
      `${pad(value.getHours())}:${pad(value.getMinutes())}`
    ].join("T");
  }

  function initializeAlertDateRange() {
    const end = new Date();
    end.setSeconds(0, 0);
    const start = new Date(end.getTime() - 24 * 3600000);
    if (!el.alertStartDate.value) el.alertStartDate.value = formatDateTimeLocal(start);
    if (!el.alertEndDate.value) el.alertEndDate.value = formatDateTimeLocal(end);
  }

  function alertRequestOptions(showValidation = false) {
    const options = {
      alertCamera: el.alertCameraFilter.value || "index",
      alertView: el.alertViewFilter.value || "alerts",
      clipView: el.clipViewFilter.value || "all",
      clipHours: 168
    };
    const range = el.alertTimeFilter.value || "24";
    if (range !== "custom") {
      options.hours = Number(range) || 24;
      return options;
    }

    const start = new Date(el.alertStartDate.value);
    const end = new Date(el.alertEndDate.value);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
      if (showValidation) {
        showToast("Invalid alert range", "Choose a start time that is earlier than the end time.", "error", 6000);
      }
      return null;
    }
    options.startdate = Math.floor(start.getTime() / 1000);
    options.enddate = Math.floor(end.getTime() / 1000);
    return options;
  }

  function formatRelative(value) {
    const date = value instanceof Date ? value : toDate(value);
    const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function initials(name) {
    return String(name || "BI")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  function cameraById(id) {
    return state.cameras.find((camera) => camera.optionValue === id);
  }

  function cameraName(id) {
    return cameraById(id)?.optionDisplay || id || "Camera";
  }

  function hasPlayableRecording(item) {
    const clip = String(item?.clip || "");
    if (clip.startsWith("@-1.")) return false;
    const path = clip || String(item?.path || "");
    return /\.(?:bvr|mp4|avi|wmv|mkv|mov)$/i.test(path);
  }

  function clampVolume(value, fallback = 0.65) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
  }

  function recordingLengthMs(item) {
    const reported = Number(item?.msec || 0);
    if (reported > 0) return reported;

    const text = String(item?.duration || item?.filesize || "")
      .split("(")[0]
      .trim()
      .toLowerCase();
    const hours = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/)?.[1] || 0);
    const minutes = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes|m(?!\s*b))\b/)?.[1] || 0);
    const seconds = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/)?.[1] || 0);
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  }

  function setButtonIcon(button, name) {
    button?.querySelector("use")?.setAttribute("href", `#i-${name}`);
  }

  function setAudioButton(button, active, enabled, activeLabel, idleLabel) {
    button.disabled = !enabled;
    button.setAttribute("aria-pressed", String(Boolean(active)));
    button.setAttribute("aria-label", active ? activeLabel : idleLabel);
    button.classList.toggle("is-active", Boolean(active));
    setButtonIcon(button, active ? "volume" : "volume-off");
  }

  function getStreamProfile() {
    return STREAM_PROFILES.find((profile) => profile.id === state.streamQuality) || STREAM_PROFILES[3];
  }

  function renderStreamQualityOptions() {
    el.streamQualitySelect.innerHTML = STREAM_PROFILES.map((profile) =>
      `<option value="${profile.id}">${escapeHtml(profile.label)}</option>`
    ).join("");
    el.streamQualitySelect.value = getStreamProfile().id;
  }

  function updateViewerResolution() {
    if (!state.activeCamera) return;
    const profile = getStreamProfile();
    if (profile.native) {
      el.viewerResolution.textContent = state.activeCamera.width && state.activeCamera.height
        ? `${state.activeCamera.width} × ${state.activeCamera.height}`
        : "Native";
      return;
    }
    el.viewerResolution.textContent = profile.label.split(" · ")[0];
  }

  function isGroup(item) {
    return Array.isArray(item?.group);
  }

  function showToast(title, message, type = "info", duration = 4200) {
    const toast = document.createElement("div");
    toast.className = `app-toast${type === "error" ? " app-toast--error" : ""}`;
    toast.innerHTML = `
      ${icon(type === "error" ? "alert" : "check")}
      <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>
    `;
    el.toastRegion.appendChild(toast);
    window.setTimeout(() => toast.remove(), duration);
  }

  function alertExportKey(item) {
    return [item?.path, item?.clip, item?.offset].map((value) => String(value ?? "")).join("|");
  }

  function normalizeExportStatus(response, path) {
    if (Array.isArray(response)) {
      return response.find((item) => item?.path === path) || response[0] || {};
    }
    return response && typeof response === "object" ? response : {};
  }

  function exportFileName(uri) {
    const name = String(uri || "blue-iris-alert.mp4").split(/[\\/]/).pop();
    return name || "blue-iris-alert.mp4";
  }

  function ensureExportToast(job) {
    if (job.toast?.isConnected) return job.toast;
    const toast = document.createElement("div");
    toast.className = "app-toast app-toast--export";
    toast.innerHTML = `
      ${icon("download")}
      <div class="export-toast__content">
        <div class="export-toast__heading">
          <strong>Exporting ${escapeHtml(job.item.cameraName || "alert")}</strong>
          <button type="button" aria-label="Dismiss export status">${icon("x")}</button>
        </div>
        <span data-export-message>Waiting for Blue Iris…</span>
        <div class="export-progress" role="progressbar" aria-label="MP4 export progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <i data-export-progress></i>
        </div>
        <a data-export-download hidden>Download MP4 with sound</a>
      </div>
    `;
    toast.querySelector("button").addEventListener("click", () => toast.remove());
    el.toastRegion.appendChild(toast);
    job.toast = toast;
    return toast;
  }

  function updateExportButtons(job) {
    document.querySelectorAll('[data-action="export-alert"]').forEach((button) => {
      const item = state.alerts[Number(button.dataset.alertIndex)];
      if (!item || alertExportKey(item) !== job.key) return;
      const pending = ["queued", "active"].includes(job.status);
      button.disabled = pending;
      button.innerHTML = pending
        ? `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>`
        : icon(job.status === "done" ? "check" : "download");
      button.title = job.status === "done" ? "Download the completed MP4 again" : "Export alert as MP4 with sound";
    });

    if (state.activeRecording && alertExportKey(state.activeRecording) === job.key) {
      const pending = ["queued", "active"].includes(job.status);
      el.recordingExportButton.disabled = pending;
      el.recordingExportButton.innerHTML = pending
        ? `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><span>Exporting…</span>`
        : `${icon(job.status === "done" ? "check" : "download")}<span>${job.status === "done" ? "Download MP4" : "Export MP4"}</span>`;
    }
  }

  function updateExportToast(job, message) {
    const toast = ensureExportToast(job);
    const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
    toast.querySelector("[data-export-message]").textContent = message;
    toast.querySelector("[data-export-progress]").style.width = `${progress}%`;
    toast.querySelector(".export-progress").setAttribute("aria-valuenow", String(progress));
    const link = toast.querySelector("[data-export-download]");
    if (job.downloadUrl) {
      link.hidden = false;
      link.href = job.downloadUrl;
      link.download = exportFileName(job.uri);
    }
    toast.classList.toggle("app-toast--error", job.status === "error");
    updateExportButtons(job);
  }

  function beginExportDownload(job, force = false) {
    if (!job.downloadUrl || (job.downloadStarted && !force)) return;
    job.downloadStarted = true;
    const link = document.createElement("a");
    link.href = job.downloadUrl;
    link.download = exportFileName(job.uri);
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function failExport(job, error) {
    job.status = "error";
    if (job.timer) window.clearTimeout(job.timer);
    updateExportToast(job, error?.message || String(error || "Blue Iris could not create this export."));
  }

  async function pollAlertExport(job) {
    if (!state.client || job.status === "done" || job.status === "error") return;
    try {
      const response = await state.client.exportStatus(job.path);
      const status = normalizeExportStatus(response, job.path);
      job.status = String(status.status || job.status || "active").toLowerCase();
      job.progress = Number(status.progress || (job.status === "done" ? 100 : job.progress || 0));
      job.uri = status.uri || job.uri;

      if (job.status === "done") {
        if (!job.uri) throw new Error("Blue Iris completed the export but did not return a download path.");
        job.downloadUrl = state.client.exportDownloadUrl(job.uri);
        updateExportToast(job, "MP4 ready. The audio track is included.");
        beginExportDownload(job);
        return;
      }
      if (job.status === "error") {
        throw new Error(status.error || "Blue Iris reported an export error.");
      }

      updateExportToast(job, job.status === "queued"
        ? "Queued on the Blue Iris server…"
        : `Converting to MP4 with sound${job.progress ? ` · ${Math.round(job.progress)}%` : "…"}`);
      job.timer = window.setTimeout(() => pollAlertExport(job), EXPORT_POLL_INTERVAL_MS);
    } catch (error) {
      failExport(job, error);
    }
  }

  async function exportAlert(index) {
    const item = state.alerts[Number(index)];
    if (!item) return;
    if (state.permissions.clipcreate === false) {
      showToast("Export not permitted", "Your Blue Iris account cannot create clip exports.", "error", 6000);
      return;
    }
    if (!hasPlayableRecording(item)) {
      showToast("Video export unavailable", "This is a snapshot-only alert, so it has no video or audio track to export.", "error", 6500);
      return;
    }

    const key = alertExportKey(item);
    const existing = state.exportJobs.get(key);
    if (existing) {
      ensureExportToast(existing);
      if (existing.status === "done") beginExportDownload(existing, true);
      return;
    }

    const duration = recordingLengthMs(item);
    const hasReliableOffset = (Number(item.flags || 0) & ALERT_OFFSET_MS_FLAG) !== 0;
    const sourcePath = hasReliableOffset
      ? String(item.clip || item.path || "")
      : String(item.path || item.clip || "");
    if (!sourcePath) {
      showToast("Export unavailable", "Blue Iris did not provide a database path for this alert.", "error");
      return;
    }

    const exportOptions = {};
    if (hasReliableOffset && duration > 0) {
      exportOptions.startms = Math.max(0, Math.floor(Number(item.offset || 0)));
      exportOptions.msec = duration;
    }

    const job = {
      key,
      item,
      path: "",
      status: "queued",
      progress: 0,
      timer: null,
      toast: null,
      downloadStarted: false
    };
    state.exportJobs.set(key, job);
    updateExportToast(job, "Sending MP4 export to Blue Iris…");

    try {
      const response = await state.client.queueExport(sourcePath, exportOptions);
      const queued = normalizeExportStatus(response);
      if (!queued.path) throw new Error("Blue Iris did not return an export job identifier.");
      job.path = queued.path;
      job.status = String(queued.status || "queued").toLowerCase();
      job.progress = Number(queued.progress || 0);
      updateExportToast(job, job.status === "active" ? "Converting to MP4 with sound…" : "Queued on the Blue Iris server…");
      job.timer = window.setTimeout(() => pollAlertExport(job), 700);
    } catch (error) {
      failExport(job, error);
    }
  }

  function setLoginLoading(loading, message = "Connecting…") {
    el.loginButton.disabled = loading;
    el.loginButton.innerHTML = loading
      ? `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><span>${escapeHtml(message)}</span>`
      : `<span>Connect securely</span>${icon("chevron")}`;
  }

  function showLoginError(message) {
    el.loginError.textContent = message;
    el.loginError.hidden = !message;
  }

  async function handleLogin(event) {
    event.preventDefault();
    showLoginError("");
    setLoginLoading(true);

    try {
      const client = new window.BlueIrisClient(el.serverInput.value);
      const permissions = await client.login(el.usernameInput.value, el.passwordInput.value);
      state.client = client;
      state.permissions = permissions;
      saveSettings({ server: client.baseUrl, username: client.username });
      cacheCurrentSession();
      el.passwordInput.value = "";
      await enterApplication();
    } catch (error) {
      showLoginError(error?.message || "Unable to connect to Blue Iris.");
      el.passwordInput.focus();
    } finally {
      setLoginLoading(false);
    }
  }

  async function restoreCachedSession() {
    const cached = readCachedSession();
    if (!cached) return false;

    let client;
    try {
      client = new window.BlueIrisClient(el.serverInput.value);
    } catch {
      return false;
    }
    let cachedBaseUrl;
    try {
      cachedBaseUrl = window.normalizeBlueIrisUrl(cached.server);
    } catch {
      return false;
    }
    if (client.baseUrl !== cachedBaseUrl) return false;

    showLoginError("");
    setLoginLoading(true, "Restoring session…");
    try {
      const permissions = await client.resumeSession(cached.session, cached);
      state.client = client;
      state.permissions = permissions;
      el.usernameInput.value = client.username || cached.username || el.usernameInput.value;
      saveSettings({ server: client.baseUrl, username: el.usernameInput.value.trim() });
      cacheCurrentSession();
      await enterApplication();
      return true;
    } catch (error) {
      if (error?.code === "session") {
        clearCachedSession();
        showLoginError("Your saved Blue Iris session expired. Sign in again.");
      } else {
        showLoginError(`${error?.message || "The saved session could not be checked."} The session remains saved for the next retry.`);
      }
      return false;
    } finally {
      setLoginLoading(false);
    }
  }

  async function startDemo() {
    showLoginError("");
    state.client = new window.MockBlueIrisClient();
    state.permissions = await state.client.login();
    await enterApplication();
    showToast("Demo mode", "Explore the complete interface with sample camera data.");
  }

  async function enterApplication() {
    el.loginScreen.hidden = true;
    el.appShell.hidden = false;
    document.body.classList.add("is-connected");
    updateConnectionChrome();
    renderLoadingState();
    navigate("live");
    await refreshDashboard(true);
    if (!state.client) return;
    startTimers();
  }

  function updateConnectionChrome() {
    const client = state.client;
    const displayName = client.serverName || "Blue Iris";
    const userName = client.isDemo ? "Demo operator" : client.username;
    const role = state.permissions.admin ? "Administrator" : "Camera user";

    el.railServerName.textContent = displayName;
    el.railServerStatus.textContent = client.isDemo ? "Demo mode" : "Connected";
    el.accountName.textContent = userName;
    el.accountRole.textContent = `${role} · ${client.isDemo ? "Demo" : "Connected"}`;
    el.avatarInitials.textContent = initials(userName);
    el.settingsServerName.textContent = displayName;
    el.settingsServerUrl.textContent = client.isDemo ? "Local sample data" : client.baseUrl;
  }

  function renderLoadingState() {
    el.cameraGrid.innerHTML = Array.from({ length: 6 }, () => `
      <article class="camera-card" aria-hidden="true">
        <div class="camera-card__media skeleton"></div>
        <div class="camera-card__footer">
          <div class="skeleton" style="width:42%;height:24px;border-radius:6px"></div>
          <div class="skeleton" style="width:25%;height:18px;border-radius:6px"></div>
        </div>
      </article>
    `).join("");
  }

  async function refreshDashboard(initial = false) {
    if (!state.client || state.refreshing) return;
    const requestOptions = alertRequestOptions(!initial);
    if (!requestOptions) return;
    state.refreshing = true;

    try {
      const dashboard = await state.client.loadDashboard(requestOptions);
      applyDashboardData(dashboard);
      renderAll({ preserveCameraGrid: !initial });
    } catch (error) {
      if (error?.code === "session") {
        showToast("Session ended", "Sign in again to continue.", "error");
        await logout(false);
      } else {
        showToast("Refresh failed", error?.message || "Blue Iris did not return updated data.", "error", 6500);
        if (initial) renderEmptyCameraState("Blue Iris data could not be loaded.");
      }
    } finally {
      state.refreshing = false;
    }
  }

  function applyDashboardData(dashboard) {
    const allItems = Array.isArray(dashboard.cameras) ? dashboard.cameras : [];
    state.groups = allItems.filter(isGroup);
    state.cameras = allItems.filter((item) => !isGroup(item));

    if (!state.groups.length) {
      state.groups = [{
        optionDisplay: "All cameras",
        optionValue: "index",
        group: state.cameras.map((camera) => camera.optionValue)
      }];
    }

    if (!state.groups.some((group) => group.optionValue === state.selectedGroup)) {
      state.selectedGroup = state.groups[0]?.optionValue || "index";
    }

    state.status = dashboard.status || {};
    state.alerts = (dashboard.alerts || []).map((item) => ({
      ...item,
      cameraName: item.cameraName || cameraName(item.camera)
    })).sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
    state.clips = (dashboard.clips || []).map((item) => ({
      ...item,
      cameraName: item.cameraName || cameraName(item.camera)
    })).sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
  }

  function renderAll(options = {}) {
    renderFilters();
    renderCameraGrid({ preserveExisting: options.preserveCameraGrid === true });
    renderAlerts();
    renderClips();
    renderSystem();
    renderStatusChrome();
  }

  function renderFilters() {
    const groupOptions = state.groups.map((group) =>
      `<option value="${escapeHtml(group.optionValue)}">${escapeHtml(group.optionDisplay)}</option>`
    ).join("");
    el.groupSelect.innerHTML = groupOptions;
    el.groupSelect.value = state.selectedGroup;

    const currentAlertFilter = el.alertCameraFilter.value || "index";
    el.alertCameraFilter.innerHTML = `
      <optgroup label="Groups">
        ${state.groups.map((group) =>
          `<option value="${escapeHtml(group.optionValue)}">${escapeHtml(group.optionDisplay)}</option>`
        ).join("")}
      </optgroup>
      <optgroup label="Cameras">
        ${state.cameras.map((camera) =>
          `<option value="${escapeHtml(camera.optionValue)}">${escapeHtml(camera.optionDisplay)}</option>`
        ).join("")}
      </optgroup>
    `;
    if ([...el.alertCameraFilter.options].some((option) => option.value === currentAlertFilter)) {
      el.alertCameraFilter.value = currentAlertFilter;
    } else {
      el.alertCameraFilter.value = state.groups[0]?.optionValue || "index";
    }
  }

  function camerasForCurrentGroup() {
    const group = state.groups.find((item) => item.optionValue === state.selectedGroup);
    const members = group?.group || state.cameras.map((camera) => camera.optionValue);
    const query = el.cameraSearch.value.trim().toLowerCase();
    return state.cameras.filter((camera) =>
      members.includes(camera.optionValue) &&
      (!query ||
        camera.optionDisplay?.toLowerCase().includes(query) ||
        camera.optionValue?.toLowerCase().includes(query))
    );
  }

  function cameraCardState(camera) {
    const online = camera.isOnline !== false && !camera.isNoSignal;
    const status = !online ? "Offline" : camera.isTriggered ? "Triggered" : "Live";
    const statusClass = !online ? "" : camera.isTriggered ? "status-chip--alert" : "status-chip--online";
    const recording = camera.isRecording || camera.isManRec;
    const resolution = camera.width && camera.height ? `${camera.width} × ${camera.height}` : "Resolution n/a";
    const subtitle = !online ? (camera.error || "No signal") : `${Number(camera.FPS || 0).toFixed(0)} FPS · ${resolution}`;
    return { online, status, statusClass, recording, subtitle };
  }

  function cameraCardMarkup(camera) {
    const view = cameraCardState(camera);
    return `
      <article class="camera-card${view.online ? "" : " is-offline"}" tabindex="0" role="button"
        data-camera-id="${escapeHtml(camera.optionValue)}" aria-label="Open ${escapeHtml(camera.optionDisplay)}">
        <div class="camera-card__media">
          <img src="${escapeHtml(state.client.imageUrl(camera.optionValue, 900))}"
            alt="Live view from ${escapeHtml(camera.optionDisplay)}" data-camera="${escapeHtml(camera.optionValue)}">
          <div class="camera-card__top">
            <span class="status-chip ${view.statusClass}"><span></span>${escapeHtml(view.status)}</span>
            <div class="camera-card__badges">
              ${camera.audio ? `<span class="camera-card__badge" title="Audio">${icon("volume")}</span>` : ""}
              ${view.recording ? `<span class="camera-card__badge camera-card__badge--record" title="Recording">${icon("record")}</span>` : ""}
            </div>
          </div>
          ${view.online ? "" : `<div class="camera-card__offline">${icon("alert")}<span>No signal</span></div>`}
        </div>
        <div class="camera-card__footer">
          <div class="camera-card__title">
            <strong>${escapeHtml(camera.optionDisplay)}</strong>
            <span>${escapeHtml(view.subtitle)}</span>
          </div>
          <div class="camera-card__stats">
            ${camera.ptz ? `<span>PTZ</span>` : ""}
            ${Number(camera.newalerts || 0) ? `<span>${Number(camera.newalerts)} new</span>` : `<span>${view.recording ? "REC" : "Ready"}</span>`}
          </div>
        </div>
      </article>
    `;
  }

  function updateCameraCard(card, camera) {
    const view = cameraCardState(camera);
    card.classList.toggle("is-offline", !view.online);
    card.setAttribute("aria-label", `Open ${camera.optionDisplay}`);

    const image = card.querySelector("img[data-camera]");
    image.dataset.camera = camera.optionValue;
    image.alt = `Live view from ${camera.optionDisplay}`;

    const status = card.querySelector(".status-chip");
    status.className = `status-chip ${view.statusClass}`;
    status.innerHTML = `<span></span>${escapeHtml(view.status)}`;

    card.querySelector(".camera-card__badges").innerHTML = `
      ${camera.audio ? `<span class="camera-card__badge" title="Audio">${icon("volume")}</span>` : ""}
      ${view.recording ? `<span class="camera-card__badge camera-card__badge--record" title="Recording">${icon("record")}</span>` : ""}
    `;

    const media = card.querySelector(".camera-card__media");
    const offline = card.querySelector(".camera-card__offline");
    if (!view.online && !offline) {
      media.insertAdjacentHTML("beforeend", `<div class="camera-card__offline">${icon("alert")}<span>No signal</span></div>`);
    } else if (view.online && offline) {
      offline.remove();
    }

    card.querySelector(".camera-card__title strong").textContent = camera.optionDisplay;
    card.querySelector(".camera-card__title span").textContent = view.subtitle;
    card.querySelector(".camera-card__stats").innerHTML = `
      ${camera.ptz ? "<span>PTZ</span>" : ""}
      ${Number(camera.newalerts || 0) ? `<span>${Number(camera.newalerts)} new</span>` : `<span>${view.recording ? "REC" : "Ready"}</span>`}
    `;
  }

  function renderCameraGrid(options = {}) {
    const cameras = camerasForCurrentGroup();
    const onlineCount = cameras.filter((camera) => camera.isOnline !== false && !camera.isNoSignal).length;
    const currentGroup = state.groups.find((group) => group.optionValue === state.selectedGroup);

    el.liveHeading.textContent = currentGroup?.optionDisplay || "All cameras";
    el.liveSubtitle.textContent = cameras.length
      ? `A real-time view of ${cameras.length === 1 ? "this camera" : "your selected cameras"}.`
      : "No cameras match the current view.";
    el.cameraCountLabel.textContent = `${onlineCount} online`;

    if (!cameras.length) {
      renderEmptyCameraState("No cameras match this group or search.");
      if (state.gridAudioEnabled) syncGridAudio();
      updateGridAudioControls();
      return;
    }

    const currentCards = Array.from(el.cameraGrid.children)
      .filter((card) => card.matches(".camera-card[data-camera-id]"));
    const canPreserve =
      options.preserveExisting === true &&
      currentCards.length === cameras.length &&
      currentCards.every((card, index) => card.dataset.cameraId === cameras[index].optionValue);

    if (canPreserve) {
      currentCards.forEach((card, index) => updateCameraCard(card, cameras[index]));
    } else {
      el.cameraGrid.innerHTML = cameras.map(cameraCardMarkup).join("");
    }
    if (state.gridAudioEnabled) syncGridAudio();
    updateGridAudioControls();
  }

  function renderEmptyCameraState(message) {
    el.cameraCountLabel.textContent = "0 online";
    el.cameraGrid.innerHTML = `
      <div class="empty-state">
        <div>${icon("camera")}<strong>No cameras to show</strong><span>${escapeHtml(message)}</span></div>
      </div>
    `;
  }

  function filteredAlerts() {
    const scope = el.alertCameraFilter.value || "index";
    const group = state.groups.find((item) => item.optionValue === scope);
    const members = group?.group || [scope];
    const zone = el.alertZoneFilter.value || "all";
    const zoneMask = zone === "all" ? 0 : Number(zone);
    const query = el.alertSearch.value.trim().toLowerCase();
    const alerts = state.alerts.filter((item) => {
      const matchesScope = scope === "index" || members.includes(item.camera);
      const matchesZone = !zoneMask || (Number(item.zones || 0) & zoneMask) !== 0;
      const searchText = [
        item.cameraName,
        item.camera,
        item.path,
        item.clip,
        item.res,
        item.filetype
      ].filter(Boolean).join(" ").toLowerCase();
      return matchesScope && matchesZone && (!query || searchText.includes(query));
    });
    const direction = el.alertSortFilter.value === "oldest" ? -1 : 1;
    return alerts.sort((a, b) => direction * (Number(b.date || 0) - Number(a.date || 0)));
  }

  function renderAlerts() {
    const alerts = filteredAlerts();
    const now = Date.now();
    const lastHour = alerts.filter((item) => now - toDate(item.date).getTime() <= 3600000).length;
    const cameras = new Set(alerts.map((item) => item.camera)).size;
    const newCount = alerts.filter((item) => Number(item.flags || 0) & 1).length;
    const viewLabel = el.alertViewFilter.selectedOptions[0]?.textContent || "Alerts";
    const scopeLabel = el.alertCameraFilter.selectedOptions[0]?.textContent || "All cameras";
    const rangeLabel = el.alertTimeFilter.value === "custom"
      ? `${formatDateTime(new Date(el.alertStartDate.value))} – ${formatDateTime(new Date(el.alertEndDate.value))}`
      : el.alertTimeFilter.selectedOptions[0]?.textContent || "Current range";
    const localFilterCount = [
      el.alertZoneFilter.value !== "all",
      Boolean(el.alertSearch.value.trim())
    ].filter(Boolean).length;
    el.alertFilterStatus.textContent = `Showing ${alerts.length} of ${state.alerts.length} loaded · ${viewLabel} · ${scopeLabel} · ${rangeLabel}${localFilterCount ? ` · ${localFilterCount} local filter${localFilterCount === 1 ? "" : "s"}` : ""}`;

    el.alertSummary.innerHTML = [
      ["alert", "danger", alerts.length, "Alerts in this view"],
      ["clock", "blue", lastHour, "During the last hour"],
      ["camera", "", cameras, "Cameras with activity"]
    ].map(([iconName, theme, value, label]) => `
      <article class="summary-card">
        <div class="summary-card__icon${theme ? ` summary-card__icon--${theme}` : ""}">${icon(iconName)}</div>
        <div><strong>${value}</strong><span>${label}</span></div>
      </article>
    `).join("");

    if (!alerts.length) {
      el.alertGrid.innerHTML = `<div class="empty-state"><div>${icon("alert")}<strong>No alerts found</strong><span>Try another camera or time range.</span></div></div>`;
      return;
    }

    el.alertGrid.innerHTML = alerts.map((item, index) => {
      const sourceIndex = state.alerts.indexOf(item);
      const exportJob = state.exportJobs.get(alertExportKey(item));
      const exportPending = exportJob && ["queued", "active"].includes(exportJob.status);
      const exportAvailable = hasPlayableRecording(item) && state.permissions.clipcreate !== false;
      return `
      <article class="event-card" tabindex="0" role="button" data-event-kind="alert" data-event-index="${state.alerts.indexOf(item)}"
        aria-label="Open alert from ${escapeHtml(item.cameraName)}">
        <div class="event-card__media">
          <img src="${escapeHtml(state.client.thumbnailUrl(item))}" alt="Alert from ${escapeHtml(item.cameraName)}">
          <span class="event-card__marker">${escapeHtml(item.trigger || (index % 3 === 1 ? "Vehicle" : "Motion"))}</span>
          <span class="event-card__time">${escapeHtml(formatDateTime(item.date, false))}</span>
        </div>
        <div class="event-card__body">
          <div><strong>${escapeHtml(item.cameraName)}</strong><span>${escapeHtml(formatRelative(item.date))}${newCount && (Number(item.flags || 0) & 1) ? " · New" : ""}</span></div>
          <div class="event-card__actions">
            <button class="event-card__action event-card__export" type="button" data-action="export-alert" data-alert-index="${sourceIndex}"
              aria-label="Export ${escapeHtml(item.cameraName)} alert as MP4 with sound"
              title="${exportAvailable ? "Export alert as MP4 with sound" : "This alert cannot be exported as video"}"
              ${exportAvailable && !exportPending ? "" : "disabled"}>
              ${exportPending ? `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>` : icon("download")}
            </button>
            <span class="event-card__action">${icon("play")}</span>
          </div>
        </div>
      </article>
    `;
    }).join("");
  }

  function selectedDayClips() {
    const query = el.clipSearch.value.trim().toLowerCase();
    return state.clips.filter((item) => {
      const dayKey = toDate(item.date).toISOString().slice(0, 10);
      const matchesDay = state.selectedTimelineDay === "all" || dayKey === state.selectedTimelineDay;
      const matchesQuery = !query ||
        item.cameraName?.toLowerCase().includes(query) ||
        item.filetype?.toLowerCase().includes(query);
      return matchesDay && matchesQuery;
    });
  }

  function renderClips() {
    const days = new Map();
    state.clips.forEach((item) => {
      const date = toDate(item.date);
      const key = date.toISOString().slice(0, 10);
      days.set(key, (days.get(key) || 0) + 1);
    });

    el.clipTimeline.innerHTML = `
      <button class="timeline-day ${state.selectedTimelineDay === "all" ? "active" : ""}" data-timeline-day="all">
        <strong>All days</strong><span>${state.clips.length} recordings</span>
      </button>
      ${[...days.entries()].slice(0, 7).map(([key, count]) => {
        const date = new Date(`${key}T12:00:00`);
        const label = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
        return `<button class="timeline-day ${state.selectedTimelineDay === key ? "active" : ""}" data-timeline-day="${key}"><strong>${label}</strong><span>${count} recording${count === 1 ? "" : "s"}</span></button>`;
      }).join("")}
    `;

    const clips = selectedDayClips();
    if (!clips.length) {
      el.clipGrid.innerHTML = `<div class="empty-state"><div>${icon("play")}<strong>No recordings found</strong><span>Try a different day, search, or database view.</span></div></div>`;
      return;
    }

    el.clipGrid.innerHTML = clips.map((item) => `
      <article class="event-card" tabindex="0" role="button" data-event-kind="clip" data-event-index="${state.clips.indexOf(item)}"
        aria-label="Open recording from ${escapeHtml(item.cameraName)}">
        <div class="event-card__media">
          <img src="${escapeHtml(state.client.thumbnailUrl(item))}" alt="Recording from ${escapeHtml(item.cameraName)}">
          <span class="event-card__marker">${escapeHtml(item.filetype || "Recording")}</span>
          <span class="event-card__time">${formatDuration(item.msec)}</span>
        </div>
        <div class="event-card__body">
          <div><strong>${escapeHtml(item.cameraName)}</strong><span>${escapeHtml(formatDateTime(item.date))} · ${escapeHtml(item.filesize || "")}</span></div>
          <span class="event-card__action">${icon("play")}</span>
        </div>
      </article>
    `).join("");
  }

  function parsePercent(value, fallback = 0) {
    const number = Number.parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
  }

  function storagePercent(disc) {
    const used = parseSize(disc.used);
    const total = parseSize(disc.allocated || disc.total);
    return total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  }

  function parseSize(value) {
    const match = String(value || "").match(/([\d.]+)\s*(TB|GB|MB|KB)?/i);
    if (!match) return 0;
    const units = { KB: 1 / 1048576, MB: 1 / 1024, GB: 1, TB: 1024 };
    return Number(match[1]) * (units[(match[2] || "GB").toUpperCase()] || 1);
  }

  function parseMemoryBytes(value, assumeBytes = false) {
    if (value === null || value === undefined || value === "") return 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;

    const match = String(value).trim().replace(/,/g, "").match(/^([\d.]+)\s*([KMGT]?I?B|[KMGT])?$/i);
    if (!match) return 0;
    const amount = Number(match[1]);
    const unit = String(match[2] || (assumeBytes ? "B" : "GB")).toUpperCase();
    const multipliers = {
      B: 1,
      K: 1024,
      KB: 1024,
      KIB: 1024,
      M: 1048576,
      MB: 1048576,
      MIB: 1048576,
      G: 1073741824,
      GB: 1073741824,
      GIB: 1073741824,
      T: 1099511627776,
      TB: 1099511627776,
      TIB: 1099511627776
    };
    return Number.isFinite(amount) ? amount * (multipliers[unit] || 1) : 0;
  }

  function systemMemoryDisplay(status) {
    const ramBytes = parseMemoryBytes(status.ram, true);
    const bytes = ramBytes || parseMemoryBytes(status.mem);
    if (!bytes) return { value: "—", tooltip: "" };

    const gigabytes = bytes / 1073741824;
    const megabytes = bytes / 1048576;
    return {
      value: `${gigabytes.toFixed(gigabytes >= 10 ? 1 : 2)} GB`,
      tooltip: `${Math.round(megabytes).toLocaleString()} MB`
    };
  }

  function renderSystem() {
    const status = state.status || {};
    const cpu = parsePercent(status.cpu);
    const memory = parsePercent(status.memload);
    const memoryDisplay = systemMemoryDisplay(status);
    const online = state.cameras.filter((camera) => camera.isOnline !== false && !camera.isNoSignal).length;
    const cameraPercent = state.cameras.length ? Math.round((online / state.cameras.length) * 100) : 0;

    const metrics = [
      { label: "CPU load", value: `${cpu}%`, bar: cpu, icon: "pulse", detail: cpu < 70 ? "Operating normally" : "Elevated utilization" },
      { label: "Memory", value: memoryDisplay.value, tooltip: memoryDisplay.tooltip, bar: memory, icon: "server", detail: status.memload ? `${status.memload} physical memory used` : "Blue Iris process" },
      { label: "Connections", value: String(status.cxns ?? "—"), bar: Math.min(100, Number(status.cxns || 0) * 8), icon: "user", detail: "Active server connections" },
      { label: "Cameras online", value: `${online}/${state.cameras.length}`, bar: cameraPercent, icon: "camera", detail: `${cameraPercent}% available` }
    ];

    el.healthMetrics.innerHTML = metrics.map((metric) => `
      <article class="metric-card">
        <div class="metric-card__top"><span>${escapeHtml(metric.label)}</span>${icon(metric.icon)}</div>
        <strong${metric.tooltip ? ` title="${escapeHtml(metric.tooltip)}" tabindex="0" aria-label="${escapeHtml(`${metric.label}: ${metric.value}; ${metric.tooltip}`)}"` : ""}>${escapeHtml(metric.value)}</strong>
        <div class="metric-card__bar"><span style="width:${metric.bar}%"></span></div>
        <small>${escapeHtml(metric.detail)}</small>
      </article>
    `).join("");

    const signal = Number(status.signal ?? 1);
    const canChangeProfile = state.permissions.admin === true || state.permissions.changeprofile === true;
    const signalOptions = [
      [0, "Disarmed"],
      [1, "Armed"],
      [2, "Temporary"]
    ];
    el.shieldControl.innerHTML = signalOptions.map(([value, label]) => `
      <button class="shield-option ${signal === value ? "active" : ""}" data-shield-value="${value}" ${canChangeProfile ? "" : "disabled"}>
        <span></span>${label}
      </button>
    `).join("");

    const profiles = state.permissions.profiles || ["Inactive", "Profile 1", "Profile 2", "Profile 3"];
    const activeProfile = Number(status.profile ?? 0);
    el.profileControl.innerHTML = profiles.map((profile, index) => `
      <button class="profile-option ${activeProfile === index ? "active" : ""}" data-profile-value="${index}" ${canChangeProfile ? "" : "disabled"}>
        ${escapeHtml(profile || `Profile ${index}`)}
      </button>
    `).join("");
    el.scheduleStatus.textContent = Number(status.lock || 0) === 0 ? "Schedule running" : Number(status.lock) === 1 ? "Schedule held" : "Temporary hold";

    const discs = Array.isArray(status.discs) ? status.discs : [];
    el.storageList.innerHTML = discs.length
      ? discs.map((disc) => {
          const percent = storagePercent(disc);
          return `
            <div class="storage-item">
              <div class="storage-item__header">
                <div><strong>${escapeHtml(disc.name || "Storage")}</strong><span>${escapeHtml(disc.used || "—")} used of ${escapeHtml(disc.allocated || disc.total || "—")}</span></div>
                <small>${escapeHtml(disc.free || "—")} free</small>
              </div>
              <div class="storage-bar"><span style="width:${percent}%"></span></div>
            </div>
          `;
        }).join("")
      : `<div class="empty-state" style="min-height:170px"><div>${icon("server")}<strong>Storage details unavailable</strong><span>This server did not return disk statistics.</span></div></div>`;

    const details = [
      ["System", state.client?.serverName || "Blue Iris"],
      ["Version", state.permissions.version || "Not reported"],
      ["Server", state.client?.isDemo ? "Demo data" : state.client?.baseUrl],
      ["Session", state.client?.session ? "Secure session active" : "No session"],
      ["Uptime", status.uptime || "Not reported"],
      ["Schedule", status.schedule || "Default"],
      ["Access", state.permissions.admin ? "Administrator" : "Standard user"],
      ["Clip access", state.permissions.clips === false ? "Restricted" : "Allowed"]
    ];
    el.serverDetails.innerHTML = details.map(([term, value]) =>
      `<div><dt>${escapeHtml(term)}</dt><dd title="${escapeHtml(value)}">${escapeHtml(value)}</dd></div>`
    ).join("");
  }

  function renderStatusChrome() {
    const alerts = Number(state.status.alerts ?? state.alerts.filter((item) => Number(item.flags || 0) & 1).length);
    const badge = alerts > 99 ? "99+" : String(Math.max(0, alerts));
    el.topAlertBadge.textContent = badge;
    el.railAlertCount.textContent = badge;
    el.mobileAlertBadge.textContent = badge;
    el.topAlertBadge.hidden = alerts === 0;
    el.mobileAlertBadge.hidden = alerts === 0;

    const signal = Number(state.status.signal ?? 1);
    const labels = { 0: "Disarmed", 1: "Armed", 2: "Temporary" };
    el.shieldButton.dataset.signal = String(signal);
    el.shieldLabel.textContent = labels[signal] || "Shield";
    el.shieldButton.disabled = !(state.permissions.admin || state.permissions.changeprofile);
  }

  function gridAudioCameras() {
    return camerasForCurrentGroup().filter((camera) =>
      Boolean(camera.audio) &&
      camera.isOnline !== false &&
      !camera.isNoSignal
    );
  }

  function updateGridAudioControls() {
    const available = Boolean(
      state.client &&
      !state.client.isDemo &&
      state.permissions.audio !== false &&
      window.BlueIrisPcmAudioPlayer &&
      gridAudioCameras().length
    );
    setAudioButton(el.gridAudioToggle, state.gridAudioEnabled, available, "Mute all camera audio", "Listen to all cameras");
    el.gridAudioToggle.querySelector("span").textContent = state.gridAudioEnabled ? "Mute" : "Listen";
    el.gridVolume.disabled = !available;
  }

  function applyGridVolume() {
    const players = [...state.gridAudioPlayers.values()];
    const mixedVolume = state.gridVolume / Math.sqrt(Math.max(1, players.length));
    players.forEach((player) => player.setVolume(mixedVolume));
  }

  function stopGridAudio() {
    state.gridAudioPlayers.forEach((player) => player.stop());
    state.gridAudioPlayers.clear();
    state.gridAudioEnabled = false;
    updateGridAudioControls();
  }

  function syncGridAudio() {
    if (!state.gridAudioEnabled) return;
    const desired = new Map(gridAudioCameras().map((camera) => [camera.optionValue, camera]));

    state.gridAudioPlayers.forEach((player, cameraId) => {
      if (desired.has(cameraId)) return;
      player.stop();
      state.gridAudioPlayers.delete(cameraId);
    });

    desired.forEach((camera, cameraId) => {
      if (state.gridAudioPlayers.has(cameraId)) return;
      const source = state.client.liveAudioUrl(cameraId);
      if (!source) return;
      let player;
      const removeFailedPlayer = (status) => {
        if (state.gridAudioPlayers.get(cameraId) !== player) return;
        if (status === "ended" && state.gridAudioEnabled) {
          state.gridAudioPlayers.delete(cameraId);
          window.setTimeout(syncGridAudio, 250);
          return;
        }
        if (status !== "error" && status !== "unavailable") return;
        state.gridAudioPlayers.delete(cameraId);
        player.stop();
        if (!state.gridAudioPlayers.size) {
          state.gridAudioEnabled = false;
          updateGridAudioControls();
          showToast("Camera audio unavailable", "Blue Iris did not return a playable audio stream for the visible cameras.", "error");
        }
      };
      player = new window.BlueIrisPcmAudioPlayer(removeFailedPlayer);
      state.gridAudioPlayers.set(cameraId, player);
      player.start(source, state.gridVolume);
    });
    applyGridVolume();
  }

  function startGridAudio() {
    if (state.client?.isDemo) {
      showToast("Audio unavailable in demo", "Connect to Blue Iris to listen to camera audio.");
      return;
    }
    if (!gridAudioCameras().length) {
      showToast("No camera audio", "None of the visible online cameras report an audio channel.");
      return;
    }
    state.gridAudioEnabled = true;
    syncGridAudio();
    updateGridAudioControls();
  }

  function toggleGridAudio() {
    if (state.gridAudioEnabled) stopGridAudio();
    else startGridAudio();
  }

  function updateLiveAudioControls() {
    const camera = state.activeCamera;
    const available = Boolean(
      camera &&
      Boolean(camera.audio) &&
      camera.isOnline !== false &&
      !camera.isNoSignal &&
      !state.client?.isDemo &&
      state.permissions.audio !== false &&
      window.BlueIrisPcmAudioPlayer
    );
    setAudioButton(el.liveAudioToggle, state.liveAudioEnabled, available, "Mute live audio", "Play live audio");
    el.liveVolume.disabled = !available;
  }

  function stopLiveAudio() {
    state.liveAudioPlayer?.stop();
    state.liveAudioEnabled = false;
    updateLiveAudioControls();
  }

  function ensureLiveAudioPlayer() {
    if (state.liveAudioPlayer || !window.BlueIrisPcmAudioPlayer) return;
    state.liveAudioPlayer = new window.BlueIrisPcmAudioPlayer((status, error) => {
      if (status === "ended" && state.liveAudioEnabled && state.activeCamera) {
        window.setTimeout(() => {
          if (state.liveAudioEnabled && state.activeCamera) startLiveAudio();
        }, 250);
        return;
      }
      if (status !== "error" && status !== "unavailable") return;
      state.liveAudioEnabled = false;
      updateLiveAudioControls();
      showToast(
        "Live audio unavailable",
        error?.message || "Blue Iris did not return a supported audio stream for this camera.",
        "error"
      );
    });
  }

  function startLiveAudio() {
    const camera = state.activeCamera;
    if (
      !camera ||
      !camera.audio ||
      camera.isOnline === false ||
      camera.isNoSignal ||
      state.client?.isDemo ||
      state.permissions.audio === false
    ) {
      updateLiveAudioControls();
      return;
    }
    const source = state.client.liveAudioUrl(camera.optionValue);
    if (!source) return;
    ensureLiveAudioPlayer();
    if (!state.liveAudioPlayer) return;
    state.liveAudioEnabled = true;
    updateLiveAudioControls();
    state.liveAudioPlayer.start(source, state.liveVolume);
  }

  function toggleLiveAudio() {
    if (state.liveAudioEnabled) {
      stopLiveAudio();
      return;
    }
    if (state.liveVolume <= 0) {
      state.liveVolume = 0.65;
      el.liveVolume.value = String(state.liveVolume);
      saveSettings();
    }
    startLiveAudio();
  }

  function navigate(view) {
    if (!pageMeta[view]) return;
    if (view !== "live") stopGridAudio();
    state.currentView = view;
    document.querySelectorAll(".app-view").forEach((page) =>
      page.classList.toggle("active", page.dataset.page === view)
    );
    document.querySelectorAll("[data-view]").forEach((button) =>
      button.classList.toggle("active", button.dataset.view === view)
    );
    el.pageEyebrow.textContent = pageMeta[view].eyebrow;
    el.pageTitle.textContent = pageMeta[view].title;
    document.title = `${pageMeta[view].title} · Blue Iris Mobile`;
    el.mainContent.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startTimers() {
    stopTimers();
    updateClock();
    state.clockTimer = window.setInterval(updateClock, 1000);
    if (state.autoRefresh) {
      state.refreshTimer = window.setInterval(() => refreshDashboard(false), 15000);
    }
    state.snapshotTimer = window.setInterval(refreshVisibleSnapshots, 1000);
  }

  function stopTimers() {
    window.clearInterval(state.clockTimer);
    window.clearInterval(state.refreshTimer);
    window.clearInterval(state.snapshotTimer);
    state.clockTimer = null;
    state.refreshTimer = null;
    state.snapshotTimer = null;
  }

  function updateClock() {
    const date = new Date();
    el.serverClock.textContent = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit"
    }).format(date);
    if (state.activeCamera) {
      el.viewerTimestamp.textContent = `LIVE · ${formatDateTime(date, false)}`;
    }
  }

  function refreshVisibleSnapshots() {
    if (!state.client || state.currentView !== "live" || document.hidden) return;
    document.querySelectorAll("#cameraGrid img[data-camera]").forEach((image) => {
      const camera = cameraById(image.dataset.camera);
      if (camera?.isOnline !== false && !camera?.isNoSignal) {
        image.src = state.client.imageUrl(image.dataset.camera, 900);
      }
    });
  }

  function stopViewerMedia() {
    window.clearInterval(state.viewerSnapshotTimer);
    state.viewerSnapshotTimer = null;
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }
    if (state.clappr) {
      try {
        state.clappr.destroy();
      } catch {
        // A partially initialized player may already have released its media element.
      }
      state.clappr = null;
    }
    el.cameraHlsPlayer.replaceChildren();
    el.cameraHlsPlayer.hidden = true;
    el.cameraVideo.pause();
    el.cameraVideo.removeAttribute("src");
    el.cameraVideo.load();
    el.cameraStream.removeAttribute("src");
  }

  function openCamera(cameraId) {
    const camera = cameraById(cameraId);
    if (!camera) return;
    stopGridAudio();
    stopLiveAudio();
    state.activeCamera = camera;

    const online = camera.isOnline !== false && !camera.isNoSignal;
    el.cameraModalTitle.textContent = camera.optionDisplay;
    el.cameraModalStatus.className = `status-chip ${online ? "status-chip--online" : ""}`;
    el.cameraModalStatus.innerHTML = `<span></span>${online ? "Live" : "Offline"}`;
    renderStreamQualityOptions();
    updateViewerResolution();
    el.cameraStream.alt = `Live stream from ${camera.optionDisplay}`;
    el.snapshotDownload.href = state.client.snapshotDownloadUrl(camera.optionValue);
    el.snapshotDownload.download = `${camera.optionDisplay.replace(/[^\w-]+/g, "-")}-snapshot.jpg`;
    el.streamError.hidden = online;

    const canRecord = state.permissions.clipcreate !== false;
    el.manualRecordButton.disabled = !canRecord || !online;
    el.triggerButton.disabled = !canRecord || !online;
    el.manualRecordButton.classList.toggle("is-recording", Boolean(camera.isManRec));
    el.manualRecordButton.querySelector("span").textContent = camera.isManRec ? "Stop recording" : "Record";

    const canPtz = state.permissions.ptz !== false && camera.ptz === true && online;
    el.ptzPanel.querySelectorAll("button").forEach((button) => { button.disabled = !canPtz; });
    el.presetControl.innerHTML = Array.from({ length: 8 }, (_, index) =>
      `<button data-ptz="${101 + index}" ${canPtz ? "" : "disabled"} aria-label="Go to preset ${index + 1}">${index + 1}</button>`
    ).join("");

    setStreamMode(state.client.isDemo ? "snapshot" : "mjpeg");
    bootstrap.Modal.getOrCreateInstance(el.cameraModal).show();
    updateLiveAudioControls();
    if (state.liveVolume > 0) startLiveAudio();
  }

  function setStreamMode(mode) {
    if (!state.activeCamera) return;
    state.activeStreamMode = mode;
    stopViewerMedia();
    document.querySelectorAll("[data-stream-mode]").forEach((button) =>
      button.classList.toggle("active", button.dataset.streamMode === mode)
    );
    el.cameraStream.hidden = false;
    el.cameraVideo.hidden = true;
    el.cameraHlsPlayer.hidden = true;
    el.streamError.hidden = true;

    const cameraId = state.activeCamera.optionValue;
    const streamProfile = getStreamProfile();
    updateViewerResolution();
    if (state.client.isDemo) {
      el.cameraStream.src = state.client.viewerSnapshotUrl(cameraId, streamProfile, state.activeCamera);
      return;
    }

    if (mode === "snapshot") {
      const update = () => {
        el.cameraStream.src = state.client.viewerSnapshotUrl(cameraId, streamProfile, state.activeCamera);
      };
      update();
      state.viewerSnapshotTimer = window.setInterval(update, 1400);
      return;
    }

    if (mode === "mjpeg") {
      el.cameraStream.src = state.client.liveStreamUrl(cameraId, streamProfile, state.activeCamera);
      return;
    }

    if (mode === "hls") {
      el.cameraStream.hidden = true;
      el.cameraHlsPlayer.hidden = false;
      const source = state.client.hlsUrl(cameraId, streamProfile, state.activeCamera);
      startClapprHls(source);
    }
  }

  function startClapprHls(source) {
    if (!window.Clappr?.Player) {
      showStreamError(
        "HLS player unavailable",
        "The local HLS playback library did not load. Use MJPEG or snapshot mode."
      );
      return;
    }

    let errorShown = false;
    const handleError = (error) => {
      if (errorShown) return;
      errorShown = true;
      const status = Number(
        error?.raw?.response?.code ||
        error?.raw?.response?.status ||
        error?.response?.code ||
        error?.response?.status ||
        0
      );
      const failedUrl = String(
        error?.raw?.frag?.url ||
        error?.raw?.response?.url ||
        error?.raw?.url ||
        error?.response?.url ||
        ""
      );
      const description = String(error?.description || error?.message || "").toLowerCase();
      let message = "Blue Iris did not return a playable HLS stream. Try MJPEG or snapshot mode.";
      if (status === 401 || status === 403) {
        message = "Blue Iris rejected an HLS playlist or segment request. Reconnect to establish a new session.";
      } else if (status === 404 && /\.ts(?:\?|$)/i.test(failedUrl)) {
        message = "An HLS video segment was not found. Ensure the reverse proxy forwards the entire /h264/ path—including numbered .ts files—and does not cache .m3u8 playlists.";
      } else if (status === 404) {
        message = "The HLS playlist was not found. Confirm HLS streaming is enabled for this camera.";
      } else if (status === 0 || /network|manifest|cors|load/.test(description)) {
        message = state.client.isSameOrigin
          ? "The HLS playlist could not be loaded. Confirm this camera supports H.264 streaming."
          : "The browser could not read the remote HLS playlist. Blue Iris must allow CORS from this site, and both sites must use compatible HTTP/HTTPS schemes.";
      }
      console.error("Blue Iris HLS playback error", error);
      showStreamError("HLS stream unavailable", message);
    };

    try {
      state.clappr = new window.Clappr.Player({
        source,
        parentId: "#cameraHlsPlayer",
        autoPlay: true,
        mute: true,
        width: "100%",
        height: "100%",
        disableVideoTagContextMenu: true,
        allowUserInteraction: true,
        actualLiveTime: true,
        hlsMinimumDvrSize: 1,
        playback: {
          playInline: true,
          recycleVideo: true,
          minimumDvrSize: 1,
          hlsjsConfig: {
            liveSyncDurationCount: 2,
            liveMaxLatencyDurationCount: 5,
            manifestLoadingMaxRetry: 2,
            levelLoadingMaxRetry: 3,
            fragLoadingMaxRetry: 4,
            xhrSetup(xhr, url) {
              const authenticatedUrl = state.client?.hlsRequestUrl
                ? state.client.hlsRequestUrl(url)
                : url;
              xhr.open("GET", authenticatedUrl, true);
              xhr.withCredentials = Boolean(state.client?.isSameOrigin);
            }
          }
        },
        events: {
          onReady() {
            state.clappr?.play();
          },
          onError: handleError
        }
      });
      state.clappr.on("playererror", handleError);
    } catch (error) {
      handleError(error);
    }
  }

  function showStreamError(title, message) {
    el.streamErrorTitle.textContent = title;
    el.streamErrorMessage.textContent = message;
    el.streamError.hidden = false;
  }

  async function sendPtz(button) {
    if (!state.activeCamera) return;
    try {
      await state.client.request("ptz", {
        camera: state.activeCamera.optionValue,
        button: Number(button),
        updown: 1
      });
    } catch (error) {
      showToast("PTZ command failed", error?.message || "Blue Iris rejected the camera command.", "error");
    }
  }

  async function toggleManualRecord() {
    const camera = state.activeCamera;
    if (!camera) return;
    const next = !camera.isManRec;
    el.manualRecordButton.disabled = true;
    try {
      await state.client.request("camconfig", { camera: camera.optionValue, manrec: next });
      camera.isManRec = next;
      camera.isRecording = next || camera.isRecording;
      el.manualRecordButton.classList.toggle("is-recording", next);
      el.manualRecordButton.querySelector("span").textContent = next ? "Stop recording" : "Record";
      renderCameraGrid();
      showToast(next ? "Recording started" : "Recording stopped", `${camera.optionDisplay} manual recording ${next ? "is active" : "has stopped"}.`);
    } catch (error) {
      showToast("Recording command failed", error?.message || "Blue Iris rejected the command.", "error");
    } finally {
      el.manualRecordButton.disabled = false;
    }
  }

  async function triggerActiveCamera() {
    const camera = state.activeCamera;
    if (!camera) return;
    el.triggerButton.disabled = true;
    try {
      await state.client.request("trigger", { camera: camera.optionValue });
      camera.isTriggered = true;
      camera.isRecording = true;
      renderCameraGrid();
      showToast("Camera triggered", `${camera.optionDisplay} received an external trigger.`);
    } catch (error) {
      showToast("Trigger failed", error?.message || "Blue Iris rejected the command.", "error");
    } finally {
      el.triggerButton.disabled = false;
    }
  }

  function currentRecordingPosition() {
    if (!state.recordingPlaying) return state.recordingPositionMs;
    const elapsed = performance.now() - state.recordingStartedAt;
    const position = state.recordingPositionMs + elapsed;
    return state.recordingDurationMs > 0
      ? Math.min(state.recordingDurationMs, position)
      : position;
  }

  function updateRecordingTimeline(position = currentRecordingPosition()) {
    const safePosition = Math.max(0, Number(position) || 0);
    el.recordingCurrentTime.textContent = formatDuration(safePosition);
    el.recordingDuration.textContent = formatDuration(state.recordingDurationMs);
    if (state.recordingDurationMs > 0) {
      el.recordingSeek.value = String(Math.min(state.recordingDurationMs, safePosition));
    }
  }

  function updateRecordingPlayButton() {
    const available = Boolean(state.activeRecording && hasPlayableRecording(state.activeRecording));
    el.recordingPlayToggle.disabled = !available;
    el.recordingPlayToggle.setAttribute("aria-label", state.recordingPlaying ? "Pause recording" : "Play recording");
    setButtonIcon(el.recordingPlayToggle, state.recordingPlaying ? "pause" : "play");
  }

  function updateRecordingAudioControls(status = "idle") {
    const available = Boolean(
      state.activeRecording &&
      hasPlayableRecording(state.activeRecording) &&
      !state.client?.isDemo &&
      state.permissions.audio !== false &&
      window.BlueIrisPcmAudioPlayer
    );
    const audible = available && state.recordingVolume > 0;
    setAudioButton(el.recordingAudioToggle, audible, available, "Mute recording audio", "Play recording audio");
    el.recordingVolume.disabled = !available;
    el.recordingAudioToggle.classList.toggle("is-loading", status === "loading");
    el.recordingAudioToggle.classList.toggle("is-error", status === "error" || status === "unavailable");
    if (status === "unavailable") el.recordingAudioToggle.title = "This clip does not contain a supported audio track.";
    else if (status === "error") el.recordingAudioToggle.title = "Blue Iris clip audio could not be decoded.";
    else el.recordingAudioToggle.removeAttribute("title");
  }

  function ensureRecordingAudioPlayer() {
    if (!window.BlueIrisPcmAudioPlayer || state.recordingAudio) return;
    state.recordingAudio = new window.BlueIrisPcmAudioPlayer((status) => {
      updateRecordingAudioControls(status);
    });
  }

  function stopRecordingAudio() {
    state.recordingAudio?.stop();
  }

  function startRecordingAudio(position) {
    if (
      !state.activeRecording ||
      state.client?.isDemo ||
      state.permissions.audio === false ||
      state.recordingVolume <= 0
    ) return;
    ensureRecordingAudioPlayer();
    const source = state.client.clipAudioUrl(state.activeRecording, position);
    if (source) state.recordingAudio?.start(source, state.recordingVolume);
  }

  function stopRecordingClock() {
    window.clearInterval(state.recordingTimer);
    state.recordingTimer = null;
  }

  function showRecordingFrame(position) {
    if (!state.activeRecording || !hasPlayableRecording(state.activeRecording)) return;
    const maxPosition = state.recordingDurationMs > 0 ? Math.max(0, state.recordingDurationMs - 1) : position;
    const safePosition = Math.max(0, Math.min(maxPosition, Number(position) || 0));
    el.recordingStream.removeAttribute("data-fallback-applied");
    state.recordingFramePending = true;
    el.recordingStream.src = state.client.recordingFrameUrl(state.activeRecording, safePosition);
  }

  function pauseRecordingPlayback(showFrame = true) {
    if (state.recordingPlaying) state.recordingPositionMs = currentRecordingPosition();
    state.recordingPlaying = false;
    stopRecordingClock();
    stopRecordingAudio();
    if (showFrame) showRecordingFrame(state.recordingPositionMs);
    updateRecordingTimeline(state.recordingPositionMs);
    updateRecordingPlayButton();
    updateRecordingAudioControls();
  }

  function startRecordingPlayback(position = state.recordingPositionMs) {
    if (!state.activeRecording || !hasPlayableRecording(state.activeRecording)) return;
    stopRecordingClock();
    stopRecordingAudio();
    const maximum = state.recordingDurationMs > 0 ? Math.max(0, state.recordingDurationMs - 1) : Number.MAX_SAFE_INTEGER;
    state.recordingPositionMs = Math.max(0, Math.min(maximum, Number(position) || 0));
    state.recordingStartedAt = performance.now();
    state.recordingPlaying = true;
    el.recordingStream.removeAttribute("data-fallback-applied");
    showRecordingFrame(state.recordingPositionMs);
    startRecordingAudio(state.recordingPositionMs);
    updateRecordingPlayButton();
    updateRecordingAudioControls();
    updateRecordingTimeline(state.recordingPositionMs);

    state.recordingTimer = window.setInterval(() => {
      const positionNow = currentRecordingPosition();
      updateRecordingTimeline(positionNow);
      if (!state.recordingFramePending) {
        showRecordingFrame(positionNow);
      }
      if (state.recordingDurationMs > 0 && positionNow >= state.recordingDurationMs) {
        state.recordingPositionMs = state.recordingDurationMs;
        pauseRecordingPlayback(true);
      }
    }, 200);
  }

  function stopRecordingPlayback() {
    stopRecordingClock();
    window.clearTimeout(state.recordingSeekPreviewTimer);
    state.recordingSeekPreviewTimer = null;
    stopRecordingAudio();
    state.recordingPlaying = false;
    state.recordingFramePending = false;
    state.recordingPositionMs = 0;
    state.recordingStartedAt = 0;
    el.recordingStream.removeAttribute("src");
    updateRecordingPlayButton();
  }

  function toggleRecordingPlayback() {
    if (state.recordingPlaying) pauseRecordingPlayback(true);
    else {
      const position = state.recordingDurationMs > 0 && state.recordingPositionMs >= state.recordingDurationMs
        ? 0
        : state.recordingPositionMs;
      startRecordingPlayback(position);
    }
  }

  function previewRecordingSeek(position) {
    const safePosition = Math.max(0, Number(position) || 0);
    el.recordingCurrentTime.textContent = formatDuration(safePosition);
    window.clearTimeout(state.recordingSeekPreviewTimer);
    state.recordingSeekPreviewTimer = window.setTimeout(() => {
      if (!state.recordingPlaying) showRecordingFrame(safePosition);
    }, 100);
  }

  function commitRecordingSeek(position) {
    const safePosition = Math.max(0, Number(position) || 0);
    if (state.recordingPlaying) startRecordingPlayback(safePosition);
    else {
      state.recordingPositionMs = safePosition;
      showRecordingFrame(safePosition);
      updateRecordingTimeline(safePosition);
    }
  }

  function toggleRecordingAudio() {
    if (state.recordingVolume > 0) {
      state.recordingVolume = 0;
      stopRecordingAudio();
    } else {
      state.recordingVolume = 0.65;
      if (state.recordingPlaying) startRecordingAudio(currentRecordingPosition());
    }
    el.recordingVolume.value = String(state.recordingVolume);
    saveSettings();
    updateRecordingAudioControls();
  }

  function openRecording(kind, index) {
    const item = kind === "alert" ? state.alerts[index] : state.clips[index];
    if (!item) return;
    stopRecordingPlayback();
    state.activeRecording = item;
    state.recordingKind = kind;

    const title = `${item.cameraName} · ${kind === "alert" ? "Alert" : "Recording"}`;
    el.recordingModalTitle.textContent = title;
    el.recordingCameraName.textContent = item.cameraName;
    el.recordingTypeLabel.innerHTML = `<span></span>${kind === "alert" ? "Alert playback" : "Recording"}`;
    el.recordingTypeLabel.className = `status-chip ${kind === "alert" ? "status-chip--alert" : "status-chip--online"}`;
    el.recordingTimestamp.textContent = formatDateTime(item.date);
    el.recordingResolution.textContent = item.res || "";
    el.recordingStream.alt = title;
    const isSnapshotAlert = kind === "alert" && !hasPlayableRecording(item);
    const exportJob = kind === "alert" ? state.exportJobs.get(alertExportKey(item)) : null;
    const exportPending = exportJob && ["queued", "active"].includes(exportJob.status);
    el.recordingExportButton.hidden = kind !== "alert";
    el.recordingExportButton.disabled = isSnapshotAlert || state.permissions.clipcreate === false || exportPending;
    el.recordingExportButton.title = isSnapshotAlert
      ? "Snapshot alerts do not contain video or audio"
      : "Export this alert as an MP4 with sound";
    el.recordingExportButton.innerHTML = exportPending
      ? `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><span>Exporting…</span>`
      : `${icon(exportJob?.status === "done" ? "check" : "download")}<span>${exportJob?.status === "done" ? "Download MP4" : "Export MP4"}</span>`;
    state.recordingDurationMs = isSnapshotAlert ? 0 : recordingLengthMs(item);
    const requestedStart = kind === "alert" ? Number(item.offset || 0) : 0;
    state.recordingPositionMs = state.recordingDurationMs > 0
      ? Math.min(Math.max(0, requestedStart), Math.max(0, state.recordingDurationMs - 1))
      : Math.max(0, requestedStart);
    el.recordingSeek.max = String(state.recordingDurationMs);
    el.recordingSeek.value = String(state.recordingPositionMs);
    el.recordingSeek.disabled = isSnapshotAlert || state.recordingDurationMs <= 0;
    el.recordingVolume.value = String(state.recordingVolume);
    updateRecordingTimeline(state.recordingPositionMs);
    updateRecordingPlayButton();
    updateRecordingAudioControls();

    const details = [
      ["Camera", item.cameraName],
      ["Captured", formatDateTime(item.date)],
      ["Event", item.trigger || item.filetype || (kind === "alert" ? "Motion trigger" : "Recording")],
      ["Resolution", item.res || "Not reported"],
      ["Duration", state.recordingDurationMs ? formatDuration(state.recordingDurationMs) : (isSnapshotAlert ? "Alert frame" : "Not reported")],
      ["Size", item.filesize || "Not reported"]
    ];
    el.recordingDetails.innerHTML = details.map(([term, value]) =>
      `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`
    ).join("");
    bootstrap.Modal.getOrCreateInstance(el.recordingModal).show();
    if (isSnapshotAlert) el.recordingStream.src = state.client.alertImageUrl(item);
    else startRecordingPlayback(state.recordingPositionMs);
  }

  async function setShield(value) {
    if (!(state.permissions.admin || state.permissions.changeprofile)) return;
    try {
      const response = await state.client.request("status", { signal: Number(value) });
      state.status = { ...state.status, ...(response || {}), signal: Number(value) };
      renderSystem();
      renderStatusChrome();
      showToast("Shield updated", `Protection is now ${Number(value) === 1 ? "armed" : Number(value) === 0 ? "disarmed" : "temporary"}.`);
    } catch (error) {
      showToast("Shield update failed", error?.message || "Blue Iris rejected the status change.", "error");
    }
  }

  async function cycleShield() {
    const current = Number(state.status.signal ?? 1);
    const next = current === 1 ? 2 : current === 2 ? 0 : 1;
    await setShield(next);
  }

  async function setProfile(value) {
    if (!(state.permissions.admin || state.permissions.changeprofile)) return;
    try {
      const response = await state.client.request("status", { profile: Number(value) });
      state.status = { ...state.status, ...(response || {}), profile: Number(value) };
      renderSystem();
      const profileName = state.permissions.profiles?.[Number(value)] || `Profile ${value}`;
      showToast("Profile changed", `${profileName} is now active.`);
    } catch (error) {
      showToast("Profile change failed", error?.message || "Blue Iris rejected the profile change.", "error");
    }
  }

  async function logout(notify = true) {
    stopTimers();
    stopGridAudio();
    stopLiveAudio();
    stopRecordingPlayback();
    stopViewerMedia();
    state.exportJobs.forEach((job) => {
      if (job.timer) window.clearTimeout(job.timer);
      job.toast?.remove();
    });
    state.exportJobs.clear();
    clearCachedSession();
    try {
      await state.client?.logout();
    } catch {
      // Local sign-out must continue even when the remote server is unavailable.
    }

    document.querySelectorAll(".modal.show").forEach((modal) =>
      bootstrap.Modal.getOrCreateInstance(modal).hide()
    );
    state.client = null;
    state.permissions = {};
    state.cameras = [];
    state.groups = [];
    state.alerts = [];
    state.clips = [];
    state.status = {};
    state.activeCamera = null;
    el.appShell.hidden = true;
    el.loginScreen.hidden = false;
    document.body.classList.remove("is-connected");
    document.title = "Blue Iris Mobile";
    if (notify) showLoginError("");
    el.passwordInput.focus();
  }

  function handleGlobalClick(event) {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      event.preventDefault();
      navigate(viewButton.dataset.view);
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === "toggle-password") {
        const showing = el.passwordInput.type === "text";
        el.passwordInput.type = showing ? "password" : "text";
        actionButton.setAttribute("aria-label", showing ? "Show password" : "Hide password");
      } else if (action === "start-demo") {
        startDemo();
      } else if (action === "logout") {
        logout();
      } else if (action === "refresh") {
        refreshDashboard(false);
      } else if (action === "cycle-shield") {
        cycleShield();
      } else if (action === "fullscreen-viewer") {
        el.cameraViewport.requestFullscreen?.().catch(() => {});
      } else if (action === "toggle-record") {
        toggleManualRecord();
      } else if (action === "trigger-camera") {
        triggerActiveCamera();
      } else if (action === "fallback-snapshot") {
        setStreamMode("snapshot");
      } else if (action === "export-alert") {
        exportAlert(actionButton.dataset.alertIndex);
      } else if (action === "export-active-alert") {
        const activeKey = alertExportKey(state.activeRecording);
        const index = state.alerts.findIndex((item) => alertExportKey(item) === activeKey);
        if (index >= 0) exportAlert(index);
      }
      return;
    }

    const cameraCard = event.target.closest(".camera-card[data-camera-id]");
    if (cameraCard) {
      openCamera(cameraCard.dataset.cameraId);
      return;
    }

    const eventCard = event.target.closest(".event-card[data-event-kind]");
    if (eventCard) {
      openRecording(eventCard.dataset.eventKind, Number(eventCard.dataset.eventIndex));
      return;
    }

    const streamMode = event.target.closest("[data-stream-mode]");
    if (streamMode) {
      setStreamMode(streamMode.dataset.streamMode);
      return;
    }

    const ptzButton = event.target.closest("[data-ptz]");
    if (ptzButton && !ptzButton.disabled) {
      sendPtz(ptzButton.dataset.ptz);
      return;
    }

    const shieldOption = event.target.closest("[data-shield-value]");
    if (shieldOption && !shieldOption.disabled) {
      setShield(shieldOption.dataset.shieldValue);
      return;
    }

    const profileOption = event.target.closest("[data-profile-value]");
    if (profileOption && !profileOption.disabled) {
      setProfile(profileOption.dataset.profileValue);
      return;
    }

    const timelineDay = event.target.closest("[data-timeline-day]");
    if (timelineDay) {
      state.selectedTimelineDay = timelineDay.dataset.timelineDay;
      renderClips();
    }
  }

  function handleKeyboardActivation(event) {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches(".camera-card, .event-card")) {
      event.preventDefault();
      event.target.click();
    }
  }

  function handleImageError(event) {
    if (!(event.target instanceof HTMLImageElement)) return;
    if (event.target.id === "cameraStream" || event.target.id === "recordingStream") {
      if (event.target.id === "recordingStream") state.recordingFramePending = false;
      if (event.target.id === "cameraStream") {
        showStreamError("Stream unavailable", "Try snapshot mode or confirm this camera is online.");
      }
      return;
    }
    if (event.target.dataset.fallbackApplied) return;
    event.target.dataset.fallbackApplied = "true";
    event.target.src = "assets/images/mock-garage.svg";
    event.target.style.filter = "grayscale(.7) brightness(.5)";
  }

  function bindEvents() {
    el.loginForm.addEventListener("submit", handleLogin);
    document.addEventListener("click", handleGlobalClick);
    document.addEventListener("keydown", handleKeyboardActivation);
    document.addEventListener("error", handleImageError, true);
    el.recordingStream.addEventListener("load", () => {
      state.recordingFramePending = false;
    });

    el.groupSelect.addEventListener("change", () => {
      state.selectedGroup = el.groupSelect.value;
      renderCameraGrid();
    });
    el.cameraSearch.addEventListener("input", renderCameraGrid);
    el.gridAudioToggle.addEventListener("click", toggleGridAudio);
    el.gridVolume.addEventListener("input", () => {
      state.gridVolume = clampVolume(el.gridVolume.value, state.gridVolume);
      if (state.gridVolume <= 0) stopGridAudio();
      else if (!state.gridAudioEnabled) startGridAudio();
      else applyGridVolume();
      saveSettings();
    });
    el.alertViewFilter.addEventListener("change", () => refreshDashboard(false));
    el.alertCameraFilter.addEventListener("change", () => refreshDashboard(false));
    el.alertTimeFilter.addEventListener("change", () => {
      el.alertCustomDates.hidden = el.alertTimeFilter.value !== "custom";
      refreshDashboard(false);
    });
    [el.alertStartDate, el.alertEndDate].forEach((input) => {
      input.addEventListener("change", () => {
        if (el.alertTimeFilter.value === "custom") refreshDashboard(false);
      });
    });
    el.alertZoneFilter.addEventListener("change", renderAlerts);
    el.alertSortFilter.addEventListener("change", renderAlerts);
    el.alertSearch.addEventListener("input", renderAlerts);
    el.clipSearch.addEventListener("input", renderClips);
    el.clipViewFilter.addEventListener("change", () => {
      state.selectedTimelineDay = "all";
      refreshDashboard(false);
    });
    el.autoRefreshToggle.addEventListener("change", () => {
      state.autoRefresh = el.autoRefreshToggle.checked;
      saveSettings();
      startTimers();
      showToast("Refresh preference saved", state.autoRefresh ? "Automatic refresh is on." : "Automatic refresh is off.");
    });
    el.compactCardsToggle.addEventListener("change", () => {
      state.compactCards = el.compactCardsToggle.checked;
      el.appShell.classList.toggle("compact-cards", state.compactCards);
      saveSettings();
    });
    el.streamQualitySelect.addEventListener("change", () => {
      state.streamQuality = el.streamQualitySelect.value;
      saveSettings();
      setStreamMode(state.activeStreamMode);
      showToast("Stream quality changed", `${getStreamProfile().label} will be used for live streams.`);
    });
    el.liveAudioToggle.addEventListener("click", toggleLiveAudio);
    el.liveVolume.addEventListener("input", () => {
      state.liveVolume = clampVolume(el.liveVolume.value, state.liveVolume);
      if (state.liveVolume <= 0) stopLiveAudio();
      else if (!state.liveAudioEnabled) startLiveAudio();
      else {
        state.liveAudioPlayer?.setVolume(state.liveVolume);
        updateLiveAudioControls();
      }
      saveSettings();
    });
    el.recordingPlayToggle.addEventListener("click", toggleRecordingPlayback);
    el.recordingSeek.addEventListener("input", () => previewRecordingSeek(el.recordingSeek.value));
    el.recordingSeek.addEventListener("change", () => commitRecordingSeek(el.recordingSeek.value));
    el.recordingAudioToggle.addEventListener("click", toggleRecordingAudio);
    el.recordingVolume.addEventListener("input", () => {
      state.recordingVolume = clampVolume(el.recordingVolume.value, state.recordingVolume);
      state.recordingAudio?.setVolume(state.recordingVolume);
      if (state.recordingVolume <= 0) stopRecordingAudio();
      else if (state.recordingPlaying && !state.recordingAudio?.controller) {
        startRecordingAudio(currentRecordingPosition());
      }
      updateRecordingAudioControls();
      saveSettings();
    });

    el.cameraModal.addEventListener("hidden.bs.modal", () => {
      stopLiveAudio();
      stopViewerMedia();
      state.activeCamera = null;
    });
    el.recordingModal.addEventListener("hidden.bs.modal", () => {
      stopRecordingPlayback();
      state.activeRecording = null;
      state.recordingDurationMs = 0;
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshVisibleSnapshots();
    });
  }

  function init() {
    cacheElements();
    readSettings();
    initializeAlertDateRange();
    bindEvents();
    updateGridAudioControls();
    updateLiveAudioControls();
    updateRecordingPlayButton();
    updateRecordingAudioControls();
    restoreCachedSession().then((restored) => {
      if (!restored) el.usernameInput.focus();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
