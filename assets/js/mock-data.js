(function () {
  "use strict";

  const imageMap = {
    frontdoor: "assets/images/mock-front-door.svg",
    driveway: "assets/images/mock-driveway.svg",
    backyard: "assets/images/mock-backyard.svg",
    garage: "assets/images/mock-garage.svg",
    livingroom: "assets/images/mock-living-room.svg",
    sidegate: "assets/images/mock-side-gate.svg"
  };

  const cameraSeed = [
    {
      optionDisplay: "Front Door",
      optionValue: "frontdoor",
      FPS: 15,
      width: 2560,
      height: 1440,
      isOnline: true,
      isEnabled: true,
      isMotion: true,
      isTriggered: true,
      isRecording: true,
      isManRec: false,
      isNoSignal: false,
      ptz: false,
      audio: true,
      newalerts: 4,
      profile: 1,
      color: 5488154
    },
    {
      optionDisplay: "Driveway",
      optionValue: "driveway",
      FPS: 20,
      width: 3840,
      height: 2160,
      isOnline: true,
      isEnabled: true,
      isMotion: false,
      isTriggered: false,
      isRecording: true,
      isManRec: false,
      isNoSignal: false,
      ptz: true,
      audio: true,
      newalerts: 2,
      profile: 1,
      color: 16745808
    },
    {
      optionDisplay: "Backyard",
      optionValue: "backyard",
      FPS: 15,
      width: 1920,
      height: 1080,
      isOnline: true,
      isEnabled: true,
      isMotion: false,
      isTriggered: false,
      isRecording: false,
      isManRec: false,
      isNoSignal: false,
      ptz: true,
      audio: true,
      newalerts: 1,
      profile: 1,
      color: 9348223
    },
    {
      optionDisplay: "Garage",
      optionValue: "garage",
      FPS: 12,
      width: 1920,
      height: 1080,
      isOnline: true,
      isEnabled: true,
      isMotion: false,
      isTriggered: false,
      isRecording: true,
      isManRec: false,
      isNoSignal: false,
      ptz: false,
      audio: false,
      newalerts: 0,
      profile: 1,
      color: 6908265
    },
    {
      optionDisplay: "Living Room",
      optionValue: "livingroom",
      FPS: 10,
      width: 1920,
      height: 1080,
      isOnline: true,
      isEnabled: true,
      isMotion: false,
      isTriggered: false,
      isRecording: false,
      isManRec: false,
      isNoSignal: false,
      ptz: false,
      audio: true,
      newalerts: 0,
      profile: 1,
      color: 12099432
    },
    {
      optionDisplay: "Side Gate",
      optionValue: "sidegate",
      FPS: 0,
      width: 1920,
      height: 1080,
      isOnline: false,
      isEnabled: true,
      isMotion: false,
      isTriggered: false,
      isRecording: false,
      isManRec: false,
      isNoSignal: true,
      ptz: false,
      audio: false,
      newalerts: 0,
      profile: 1,
      error: "Network retry",
      color: 6645093
    }
  ];

  const groupSeed = [
    {
      optionDisplay: "All cameras",
      optionValue: "index",
      group: cameraSeed.map((camera) => camera.optionValue),
      xsize: 3,
      ysize: 2,
      isOnline: true,
      isEnabled: true
    },
    {
      optionDisplay: "Exterior",
      optionValue: "exterior",
      group: ["frontdoor", "driveway", "backyard", "sidegate"],
      xsize: 2,
      ysize: 2,
      isOnline: true,
      isEnabled: true
    },
    {
      optionDisplay: "Interior",
      optionValue: "interior",
      group: ["garage", "livingroom"],
      xsize: 2,
      ysize: 1,
      isOnline: true,
      isEnabled: true
    }
  ];

  const alertPlan = [
    ["frontdoor", 4, "Motion", 0],
    ["driveway", 22, "Vehicle", 0],
    ["backyard", 47, "Motion", 0],
    ["frontdoor", 83, "Person", 0],
    ["garage", 146, "Motion", 0],
    ["driveway", 218, "Vehicle", 0],
    ["frontdoor", 301, "Motion", 0],
    ["livingroom", 428, "Motion", 0]
  ];

  const clipPlan = [
    ["driveway", 17, 182000, "Continuous"],
    ["frontdoor", 66, 46000, "Alert recording"],
    ["garage", 124, 360000, "Continuous"],
    ["backyard", 271, 91000, "Motion"],
    ["driveway", 1480, 244000, "Continuous"],
    ["frontdoor", 1590, 53000, "Alert recording"],
    ["livingroom", 2940, 180000, "Continuous"],
    ["backyard", 4320, 118000, "Motion"]
  ];

  function cameraName(shortName) {
    return cameraSeed.find((camera) => camera.optionValue === shortName)?.optionDisplay || shortName;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function delay(ms = 220) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  class MockBlueIrisClient {
    constructor() {
      this.isDemo = true;
      this.baseUrl = "Demo server";
      this.serverName = "Blue Iris Home";
      this.session = "demo-session";
      this.username = "demo";
      this.permissions = {
        admin: true,
        changeprofile: true,
        ptz: true,
        audio: true,
        clips: true,
        clipcreate: true,
        version: "5.9.9.4 x64",
        tzone: 300,
        profiles: ["Inactive", "Home", "Away", "Night", "Weekend"],
        schedules: ["Default", "Vacation"],
        streams: ["Streaming 0", "Streaming 1"]
      };
      this.cameras = clone(cameraSeed);
      this.groups = clone(groupSeed);
      this.status = {
        profile: 1,
        lock: 0,
        signal: 1,
        cxns: 4,
        cpu: 23,
        ram: "2.8 GB",
        mem: "2.8 GB",
        memphys: "32.0 GB",
        memload: "38%",
        folders: ["New", "Stored", "", "Archive"],
        discs: [
          { name: "New", allocated: "2.00 TB", used: "1.28 TB", free: "720 GB", total: "2.00 TB" },
          { name: "Stored", allocated: "8.00 TB", used: "4.46 TB", free: "3.54 TB", total: "8.00 TB" }
        ],
        schedule: "Default",
        uptime: "18 days 7:42",
        clips: ["42,981 clips", "5.74 TB"],
        warnings: 1,
        alerts: 7,
        tzone: 300
      };
      this.exportJobs = new Map();
    }

    async login() {
      await delay(360);
      return this.permissions;
    }

    async logout() {
      await delay(100);
      this.session = null;
    }

    async loadDashboard(options = {}) {
      await delay(300);
      const now = Math.floor(Date.now() / 1000);
      const alerts = alertPlan.map(([camera, minutesAgo, type], index) => ({
        camera,
        cameraName: cameraName(camera),
        date: now - minutesAgo * 60,
        path: `@demo-alert-${index}.jpg`,
        clip: `@demo-clip-${index}.bvr`,
        offset: 0,
        res: index % 2 ? "2560x1440" : "1920x1080",
        flags: (index < 3 ? 1 : 0) | 65536,
        trigger: type,
        filetype: "bvr H264",
        filesize: `${12 + index} sec (${3 + index}.2M)`,
        zones: 1 << (index % 8)
      }));
      const clips = clipPlan.map(([camera, minutesAgo, msec, type], index) => ({
        camera,
        cameraName: cameraName(camera),
        date: now - minutesAgo * 60,
        path: `@demo-recording-${index}.bvr`,
        res: index % 2 ? "3840x2160" : "1920x1080",
        flags: index === 4 ? 1 : 0,
        msec,
        filesize: `${Math.max(38, Math.round(msec / 900))} MB`,
        filetype: type
      }));

      const rangeStart = Number(options.startdate || (now - (Number(options.hours) || 168) * 3600));
      const rangeEnd = Number(options.enddate || now);
      const scope = options.alertCamera || "index";
      const scopeGroup = this.groups.find((group) => group.optionValue === scope);
      const members = scopeGroup?.group || [scope];
      const filteredAlerts = alerts.filter((item) =>
        item.date >= rangeStart &&
        item.date <= rangeEnd &&
        (scope === "index" || members.includes(item.camera))
      );

      return {
        cameras: clone([...this.groups, ...this.cameras]),
        status: clone(this.status),
        alerts: filteredAlerts,
        clips
      };
    }

    async request(command, payload = {}) {
      await delay(120);
      if (command === "status") {
        if (typeof payload.signal === "number") this.status.signal = payload.signal;
        if (typeof payload.profile === "number" && payload.profile >= 0) this.status.profile = payload.profile;
        return clone(this.status);
      }
      if (command === "ptz") return { ok: true };
      if (command === "trigger") {
        const camera = this.cameras.find((item) => item.optionValue === payload.camera);
        if (camera) {
          camera.isTriggered = true;
          camera.isRecording = true;
        }
        return { ok: true };
      }
      if (command === "camconfig") {
        const camera = this.cameras.find((item) => item.optionValue === payload.camera);
        if (camera && typeof payload.manrec === "boolean") {
          camera.isManRec = payload.manrec;
          camera.isRecording = payload.manrec || camera.isRecording;
        }
        return clone(camera || {});
      }
      if (command === "export") {
        const existing = this.exportJobs.get(payload.path);
        if (existing) {
          existing.polls += 1;
          if (existing.polls >= 2) {
            existing.status = "done";
            existing.progress = 100;
          } else {
            existing.status = "active";
            existing.progress = 54;
          }
          return clone(existing);
        }
        const path = `@demo-export-${Date.now()}.mp4`;
        const job = {
          path,
          status: "queued",
          progress: 0,
          uri: `demo/${path.replace("@", "")}`,
          filesize: 5242880,
          polls: 0
        };
        this.exportJobs.set(path, job);
        return clone(job);
      }
      return { ok: true };
    }

    imageUrl(camera) {
      return imageMap[camera] || "assets/images/mock-front-door.svg";
    }

    liveStreamUrl(camera) {
      return this.imageUrl(camera);
    }

    liveAudioUrl() {
      return "";
    }

    viewerSnapshotUrl(camera) {
      return this.imageUrl(camera);
    }

    hlsUrl(camera) {
      return this.imageUrl(camera);
    }

    thumbnailUrl(item) {
      return this.imageUrl(item.camera);
    }

    alertImageUrl(item) {
      return this.imageUrl(item.camera);
    }

    recordingUrl(item) {
      return this.imageUrl(item.camera);
    }

    recordingFrameUrl(item, time = 0) {
      return `${this.imageUrl(item.camera)}?frame=${Math.max(0, Math.floor(Number(time) || 0))}`;
    }

    clipAudioUrl() {
      return "";
    }

    snapshotDownloadUrl(camera) {
      return this.imageUrl(camera);
    }

    queueExport(path, options = {}) {
      return this.request("export", { path, format: 1, audio: true, ...options });
    }

    exportStatus(path) {
      return this.request("export", { path });
    }

    exportDownloadUrl(uri) {
      return `data:video/mp4;base64,AAAA#${encodeURIComponent(uri)}`;
    }
  }

  window.MockBlueIrisClient = MockBlueIrisClient;
})();
