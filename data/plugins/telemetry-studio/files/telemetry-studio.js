// Telemetry Studio — a 3D ride-analytics view: lean angle, friction-circle
// g-force, and a speed/lean sparkline, all synced to a 3D playback of a
// recorded ride's own real GPS/lean/speed samples (js/dashboard.js's
// ride.trackPoints — {lat,lng,speed,heading,lean,elevation,timestamp}).
// Nothing here is simulated: the 3D track ribbon is built by projecting a
// real ride's lat/lng onto a local flat-earth plane (equirectangular, same
// approximation RydRUtils.haversineMiles's distance math already relies
// on), lateral/longitudinal g are derived from real lean + real speed
// deltas between consecutive real samples (same tan(lean)/speed-delta
// approximations plugins/gforce-vector/gforce-vector.js uses live), and
// "Live" mode reads real telemetry (RydROrientation + the dashboard's own
// speed/heading readouts) rather than any of the above.
//
// ---- theme framework ----
// THEMES below is a small, self-contained accent-color registry — "default"
// (Apex Blue) is a literal copy of the app's own --neon-green/--cyan
// tokens so an unthemed rider sees Telemetry Studio blend right into the
// rest of RydR. Applied by writing --tls-accent/--tls-accent-dim/--tls-glow as
// inline custom properties on this plugin's own root elements (read by
// this file's CSS in css/style.css, and by the Three.js scene for its
// material colors) — never anything global. Persisted alongside the rest
// of this plugin's app preferences (3D on/off, ambient motion, which
// widgets show) in one settings object; see getSettings()/DEFAULT_SETTINGS.
(function (root) {
  const SETTINGS_KEY = "rydr_telemetry_studio_settings";

  const THEMES = {
    default: { id: "default", label: "Apex Blue", accent: "#4f8cff", accentDim: "#2c5fc7", glow: "rgba(79,140,255,0.30)" },
  };
  const DEFAULT_SETTINGS = {
    theme: "default",
    show3D: true,
    ambientMotion: true,
    showFrictionCircle: true,
    showSparkline: true,
    autoPlay: true,
  };

  // Friction-circle full-scale choices (g). "auto" fits the loaded ride.
  const FRICTION_AUTO_STEPS = [0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2.5];
  const FRICTION_DEFAULT_G = 0.5;

  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const p = raw ? JSON.parse(raw) : {};
      return {
        theme: DEFAULT_SETTINGS.theme,
        show3D: p.show3D !== false,
        ambientMotion: p.ambientMotion !== false,
        showFrictionCircle: p.showFrictionCircle !== false,
        showSparkline: p.showSparkline !== false,
        autoPlay: p.autoPlay !== false,
      };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  }
  function saveSettings(next) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }
  function applyTheme(rootEl, themeId) {
    if (!rootEl) return;
    const t = THEMES[themeId] || THEMES.default;
    rootEl.style.setProperty("--tls-accent", t.accent);
    rootEl.style.setProperty("--tls-accent-dim", t.accentDim);
    rootEl.style.setProperty("--tls-glow", t.glow);
  }

  // ---------- shared math (mirrors plugins/gforce-vector/gforce-vector.js's
  // real-telemetry g-force approximations — duplicated rather than shared
  // since plugins here are self-contained files with no import system) ----------
  const DEG2RAD = Math.PI / 180;
  const MAX_LEAN_FOR_TAN = 85;
  const SANE_G_CLAMP = 2.5;
  const MPH_PER_S_PER_G = 21.94;
  const MIN_DT_SEC = 0.25;
  const MAX_DT_SEC = 8;
  // A stop or GPS dropout longer than this replays as this many seconds, so a
  // long recording never sits frozen on one spot.
  const MAX_REPLAY_GAP_SEC = 3;

  function computeLatG(leanDeg) {
    if (typeof leanDeg !== "number" || !Number.isFinite(leanDeg)) return 0;
    const clamped = RydRUtils.clamp(leanDeg, -MAX_LEAN_FOR_TAN, MAX_LEAN_FOR_TAN);
    return RydRUtils.clamp(Math.tan(clamped * DEG2RAD), -SANE_G_CLAMP, SANE_G_CLAMP);
  }
  // Equirectangular projection of lat/lng onto a local flat-earth plane
  // (meters) around an origin point — the same small-area approximation
  // RydRUtils.haversineMiles's own trig already leans on; good enough for
  // a single ride's real-world footprint, never used for navigation.
  const EARTH_R_M = 6371000;
  function projectMeters(lat, lng, lat0, lng0) {
    const dLat = (lat - lat0) * DEG2RAD;
    const dLng = (lng - lng0) * DEG2RAD;
    const x = dLng * Math.cos(lat0 * DEG2RAD) * EARTH_R_M;
    const z = dLat * EARTH_R_M;
    return { x, z };
  }

  // Turns one real recorded ride's trackPoints into a per-sample analytics
  // frame array — every field here is derived directly from that ride's
  // own real lat/lng/speed/lean/elevation/timestamp, nothing invented.
  function buildFrames(trackPoints) {
    if (!Array.isArray(trackPoints) || trackPoints.length < 2) return [];
    const origin = trackPoints[0];
    const frames = [];
    let clock = 0; // replay clock (s): real elapsed time, with long stops/gaps compressed
    for (let i = 0; i < trackPoints.length; i++) {
      const p = trackPoints[i];
      if (typeof p.lat !== "number" || typeof p.lng !== "number") continue;
      const { x, z } = projectMeters(p.lat, p.lng, origin.lat, origin.lng);
      const y =
        typeof p.elevation === "number" && typeof origin.elevation === "number"
          ? RydRUtils.clamp(p.elevation - origin.elevation, -200, 200)
          : 0;
      const roll = typeof p.lean === "number" ? p.lean : 0;
      const speed = typeof p.speed === "number" ? p.speed : 0;
      const gLat = computeLatG(roll);
      let gLon = 0;
      const prev = frames[frames.length - 1];
      if (prev) {
        const dtSec = (p.timestamp - trackPoints[i - 1].timestamp) / 1000;
        if (dtSec >= MIN_DT_SEC && dtSec <= MAX_DT_SEC) {
          gLon = RydRUtils.clamp((speed - trackPoints[i - 1].speed) / dtSec / MPH_PER_S_PER_G, -SANE_G_CLAMP, SANE_G_CLAMP);
        } else {
          gLon = prev.gLon;
        }
      }
      if (i > 0) {
        const gap = (p.timestamp - trackPoints[i - 1].timestamp) / 1000;
        if (Number.isFinite(gap) && gap > 0) clock += Math.min(gap, MAX_REPLAY_GAP_SEC);
      }
      const tSec = clock;
      frames.push({ x, y, z, roll, speed, gLat, gLon, tSec, lat: p.lat, lng: p.lng });
    }
    return frames;
  }

  // Canvas widgets sit on the app's own card background, which is dark in
  // dark themes and white in light ones — pick ink colors by its luminance
  // (cached briefly; getComputedStyle every frame is wasteful).
  const INK_DARK = { ring: "#2a313b", axis: "#3a424d", label: "#8b949e", scale: "#59616d", value: "#c9d1d9", dot: "#ffffff" };
  const INK_LIGHT = { ring: "#c4ccd6", axis: "#8a95a5", label: "#374151", scale: "#4b5563", value: "#111827", dot: "#111827" };
  const inkCache = new WeakMap();
  function inkFor(canvas) {
    const now = performance.now();
    const hit = inkCache.get(canvas);
    if (hit && now - hit.at < 1000) return hit.ink;
    let ink = INK_DARK;
    try {
      const host = canvas.closest(".tls-widget") || canvas;
      const m = getComputedStyle(host).backgroundColor.match(/[\d.]+/g);
      if (m && m.length >= 3 && (m[3] === undefined || Number(m[3]) > 0.5)) {
        const lum = (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255;
        if (lum > 0.6) ink = INK_LIGHT;
      }
    } catch (e) {
      /* keep dark ink */
    }
    inkCache.set(canvas, { at: now, ink });
    return ink;
  }

  // ---------- Lean Angle Gauge (canvas arc gauge) ----------
  class LeanAngleGauge {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.maxLeanLeft = 0;
      this.maxLeanRight = 0;
      this.accent = "#4f8cff";
    }
    reset() {
      this.maxLeanLeft = 0;
      this.maxLeanRight = 0;
    }
    draw(currentLean) {
      const { ctx } = this;
      const w = this.canvas.width;
      const h = this.canvas.height;
      const cx = w / 2;
      const cy = h - 22;
      const radius = Math.min(w * 0.4, h - 34);
      const lean = typeof currentLean === "number" && Number.isFinite(currentLean) ? currentLean : 0;

      if (lean < -1) this.maxLeanLeft = Math.min(this.maxLeanLeft, lean);
      if (lean > 1) this.maxLeanRight = Math.max(this.maxLeanRight, lean);

      ctx.clearRect(0, 0, w, h);
      const startAngle = Math.PI * 1.15;
      const endAngle = Math.PI * 1.85;

      ctx.lineWidth = 12;
      ctx.strokeStyle = "#212632";
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.stroke();

      for (let a = -60; a <= 60; a += 15) {
        const rad = (a - 90) * DEG2RAD;
        const x1 = cx + (radius - 16) * Math.cos(rad);
        const y1 = cy + (radius - 16) * Math.sin(rad);
        const x2 = cx + (radius - 6) * Math.cos(rad);
        const y2 = cy + (radius - 6) * Math.sin(rad);
        ctx.lineWidth = a === 0 ? 2 : 1;
        ctx.strokeStyle = a === 0 ? "#6e7681" : "#333c4c";
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      this._peakTick(cx, cy, radius, this.maxLeanLeft);
      this._peakTick(cx, cy, radius, this.maxLeanRight);

      const pointerRad = (RydRUtils.clamp(lean, -60, 60) - 90) * DEG2RAD;
      const px = cx + (radius - 6) * Math.cos(pointerRad);
      const py = cy + (radius - 6) * Math.sin(pointerRad);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = Math.abs(lean) > 42 ? "#ef4444" : this.accent;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(px, py);
      ctx.stroke();

      ctx.fillStyle = inkFor(this.canvas).dot;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    _peakTick(cx, cy, radius, angleDeg) {
      if (!angleDeg) return;
      const { ctx } = this;
      const rad = (RydRUtils.clamp(angleDeg, -60, 60) - 90) * DEG2RAD;
      const x1 = cx + (radius - 16) * Math.cos(rad);
      const y1 = cy + (radius - 16) * Math.sin(rad);
      const x2 = cx + (radius + 3) * Math.cos(rad);
      const y2 = cy + (radius + 3) * Math.sin(rad);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#f59e0b";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  // ---------- Friction Circle (canvas polar plot) ----------
  // maxG is the full-scale (outer ring) g value. It is deliberately small by
  // default (0.5g) so real riding forces fill the plot instead of hugging the
  // center; the outer ring clamps anything beyond it.
  class FrictionCircle {
    constructor(canvas, maxG = FRICTION_DEFAULT_G) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.maxG = maxG;
      this.accent = "#4f8cff";
    }
    draw(gLat, gLon, trail) {
      const { ctx } = this;
      const w = this.canvas.width;
      const h = this.canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) / 2 - 32;
      const lat = Number.isFinite(gLat) ? gLat : 0;
      const lon = Number.isFinite(gLon) ? gLon : 0;
      const maxG = this.maxG > 0 ? this.maxG : FRICTION_DEFAULT_G;

      const ink = inkFor(this.canvas);
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;
      ctx.strokeStyle = ink.ring;
      [0.25, 0.5, 0.75, 1.0].forEach((ratio) => {
        ctx.beginPath();
        ctx.arc(cx, cy, radius * ratio, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.strokeStyle = ink.axis;
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.stroke();

      ctx.fillStyle = ink.label;
      ctx.font = "15px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("BRAKE", cx, cy + radius + 20);
      ctx.fillText("ACCEL", cx, cy - radius - 10);
      ctx.fillText("L", cx - radius - 12, cy + 4);
      ctx.fillText("R", cx + radius + 12, cy + 4);
      // ring scale (g) along the lower-right diagonal so it never sits on an axis
      ctx.fillStyle = ink.scale;
      ctx.font = "12px 'JetBrains Mono', monospace";
      [0.5, 1.0].forEach((ratio) => {
        const d = (radius * ratio) / Math.SQRT2;
        ctx.fillText(`${(maxG * ratio).toFixed(maxG * ratio < 1 ? 2 : 1)}g`, cx + d + 12, cy + d + 4);
      });
      ctx.textAlign = "left";

      if (Array.isArray(trail)) {
        trail.forEach((p, i) => {
          const alpha = (i + 1) / trail.length;
          const px = cx + RydRUtils.clamp(p.gLat / maxG, -1, 1) * radius;
          const py = cy - RydRUtils.clamp(p.gLon / maxG, -1, 1) * radius;
          ctx.fillStyle = `rgba(34,211,238,${(alpha * 0.45).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(px, py, 1.5 + i * 0.1, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      const curX = cx + RydRUtils.clamp(lat / maxG, -1, 1) * radius;
      const curY = cy - RydRUtils.clamp(lon / maxG, -1, 1) * radius;
      ctx.strokeStyle = "rgba(79,140,255,0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(curX, curY);
      ctx.stroke();

      const ratio = Math.sqrt(lat * lat + lon * lon) / maxG;
      ctx.fillStyle = ratio >= 0.8 ? "#ef4444" : ratio >= 0.5 ? "#f59e0b" : this.accent;
      ctx.beginPath();
      ctx.arc(curX, curY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = ink.value;
      ctx.font = "15px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText(`LAT ${lat.toFixed(2)}g`, 6, 18);
      ctx.fillText(`LON ${lon.toFixed(2)}g`, 6, 36);
    }
  }

  // Smallest "nice" full-scale that holds ~97% of a ride's real g samples.
  function computeAutoFrictionRange(frames) {
    if (!Array.isArray(frames) || frames.length < 5) return FRICTION_DEFAULT_G;
    const mags = frames.map((f) => Math.max(Math.abs(f.gLat), Math.abs(f.gLon))).sort((x, y) => x - y);
    const p97 = mags[Math.min(mags.length - 1, Math.floor(mags.length * 0.97))];
    const target = p97 * 1.1;
    return FRICTION_AUTO_STEPS.find((v) => v >= target) || FRICTION_AUTO_STEPS[FRICTION_AUTO_STEPS.length - 1];
  }

  // ---------- Sparkline (lean + speed over the ride/session) ----------
  class Sparkline {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
    }
    draw(frames, currentIndex, windowSize) {
      const { ctx } = this;
      const w = this.canvas.width;
      const h = this.canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (!frames || frames.length < 2) return;
      const start = Math.max(0, currentIndex - windowSize);
      const slice = frames.slice(start, currentIndex + 1);
      if (slice.length < 2) return;

      if (this._maxFor !== frames) {
        let m = 80;
        for (let i = 0; i < frames.length; i++) if (frames[i].speed > m) m = frames[i].speed;
        this._maxFor = frames;
        this._maxSpeed = m;
      }
      const maxSpeed = this._maxSpeed;

      ctx.lineWidth = 2;
      ctx.strokeStyle = "#10b981";
      ctx.beginPath();
      slice.forEach((f, idx) => {
        const x = (idx / windowSize) * w;
        const y = h / 2 - RydRUtils.clamp(f.roll / 60, -1, 1) * (h / 2 - 8);
        idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.lineWidth = 2;
      ctx.strokeStyle = "#22d3ee";
      ctx.beginPath();
      slice.forEach((f, idx) => {
        const x = (idx / windowSize) * w;
        const y = h - (RydRUtils.clamp(f.speed, 0, maxSpeed) / maxSpeed) * (h - 8);
        idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }

  // ---------- Three.js loader (minimal — no GLTF/Draco needed, this
  // plugin only ever draws simple primitives) — same CDN-tiered fallback
  // (unpkg -> jsdelivr -> same-origin vendor copy) as
  // plugins/chase-cam-3d/chase-cam-3d.js and js/ride-detail.js use for the
  // exact same three.module.js build, so a rider who already paid the
  // download cost there gets this for free from cache. ----------
  const THREE_VERSION = "0.160.0";
  // Same-origin vendor copy first: GLTFLoader/DRACOLoader (needed for the
  // rider-bike.glb model below) import three via a relative path there, so
  // loader and scene are guaranteed to share one three.js instance — a CDN
  // core with a vendor loader would not. CDNs stay as fallbacks for the
  // core only (the model then simply doesn't load; the box bike remains).
  const THREE_VENDOR_URL = "/vendor/three/build/three.module.js";
  const THREE_MODULE_URLS = [
    THREE_VENDOR_URL,
    `https://unpkg.com/three@${THREE_VERSION}/build/three.module.js`,
    `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`,
  ];
  const GLTF_LOADER_URL = "/vendor/three/examples/jsm/loaders/GLTFLoader.js";
  const DRACO_LOADER_URL = "/vendor/three/examples/jsm/loaders/DRACOLoader.js";
  const DRACO_DECODER_PATH = "/vendor/draco/";
  // models/rider-bike.glb: model-space +Z is forward, Y up, origin at its
  // bounding-box center (±0.63 x, ±0.80 y, ±1.0 z). Scaled so it reads at
  // the same size as the track ribbon it rides on.
  const BIKE_MODEL_URL = "/models/rider-bike.glb";
  const BIKE_MODEL_SCALE = 3.8;
  const BIKE_MODEL_HALF_HEIGHT = 0.8024;
  let threeCorePromise = null;
  let threeCoreUrl = null;
  function ensureThree() {
    if (threeCorePromise) return threeCorePromise;
    threeCorePromise = (async () => {
      let lastErr;
      for (const url of THREE_MODULE_URLS) {
        try {
          const mod = await import(url);
          threeCoreUrl = url;
          return mod;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    })().catch((err) => {
      threeCorePromise = null;
      throw err;
    });
    return threeCorePromise;
  }

  // Per-frame travel heading (radians, atan2(dx, dz)) from the real positions
  // around each frame: look ahead to the first point >= 4 m away (else behind).
  // Stationary frames inherit the previous heading.
  function computeHeadings(frames) {
    const out = new Array(frames.length).fill(0);
    let prev = 0;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      let h = null;
      for (let j = i + 1; j < frames.length && j <= i + 60; j++) {
        const dx = frames[j].x - f.x;
        const dz = frames[j].z - f.z;
        if (dx * dx + dz * dz >= 16) {
          h = Math.atan2(dx, dz);
          break;
        }
      }
      if (h === null) {
        for (let j = i - 1; j >= 0 && j >= i - 60; j--) {
          const dx = f.x - frames[j].x;
          const dz = f.z - frames[j].z;
          if (dx * dx + dz * dz >= 16) {
            h = Math.atan2(dx, dz);
            break;
          }
        }
      }
      prev = h === null ? prev : h;
      out[i] = prev;
    }
    return out;
  }

  // ---------- 3D scene: a real-track ribbon (built from projectMeters()
  // above) with a simple stylized bike following it in "replay" mode, or a
  // fixed-camera bike that just rolls with real live lean in "live" mode. ----------
  class Scene3D {
    constructor(container, dbg) {
      this.container = container;
      this.dbg = dbg;
      this.THREE = null;
      this.scene = null;
      this.camera = null;
      this.renderer = null;
      this.bikeGroup = null;
      this.trackMesh = null;
      this.curve = null;
      this.frames = null;
      this.mode = "empty"; // "empty" | "path" | "live"
      this.ambientMotion = true;
      this.accentHex = 0x4f8cff;
      this._ro = null;
      this._destroyed = false;
      this._idleT = 0;
    }

    // Swaps the placeholder box bike for models/rider-bike.glb. Best-effort:
    // any failure (offline, non-vendor three tier, decode error) leaves the
    // box bike in place.
    async _loadBikeModel() {
      if (this._threeUrl !== THREE_VENDOR_URL) return;
      const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([import(GLTF_LOADER_URL), import(DRACO_LOADER_URL)]);
      const draco = new DRACOLoader();
      draco.setDecoderPath(DRACO_DECODER_PATH);
      const loader = new GLTFLoader();
      loader.setDRACOLoader(draco);
      let gltf;
      try {
        gltf = await loader.loadAsync(BIKE_MODEL_URL);
      } finally {
        draco.dispose();
      }
      if (this._destroyed) return;
      const model = gltf.scene;
      model.scale.setScalar(BIKE_MODEL_SCALE);
      model.position.y = BIKE_MODEL_HALF_HEIGHT * BIKE_MODEL_SCALE; // model's base sits on the group's ground origin
      if (this._boxBike) {
        this.bikeGroup.remove(this._boxBike);
        this._boxBike.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        this._boxBike = null;
        this._bodyMat = null;
      }
      this.bikeGroup.add(model);
    }

    async init() {
      const mod = await ensureThree();
      this._threeUrl = threeCoreUrl;
      if (this._destroyed) return;
      const THREE = mod;
      this.THREE = THREE;
      const w = Math.max(1, this.container.clientWidth);
      const h = Math.max(1, this.container.clientHeight);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x1a2230);
      this.scene.fog = new THREE.FogExp2(0x1a2230, 0.004);

      this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 2000);
      this.camera.position.set(0, 22, 40);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      this.renderer.setSize(w, h);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.container.appendChild(this.renderer.domElement);

      this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
      const dir = new THREE.DirectionalLight(0xffffff, 1.0);
      dir.position.set(40, 60, 20);
      this.scene.add(dir);

      const grid = new THREE.GridHelper(300, 30, 0x5b6f8c, 0x34445c);
      grid.position.y = -0.5;
      this.scene.add(grid);

      this.bikeGroup = this._buildBike(THREE);
      this._boxBike = this.bikeGroup.children[0];
      this.scene.add(this.bikeGroup);
      this._loadBikeModel().catch((err) => this.dbg.warn("bike model unavailable — using placeholder", err));

      this._ro = new ResizeObserver(() => this._onResize());
      this._ro.observe(this.container);
    }

    _buildBike(THREE) {
      const group = new THREE.Group();
      const box = new THREE.Group();
      group.add(box);
      const bodyMat = new THREE.MeshStandardMaterial({ color: this.accentHex, roughness: 0.35, metalness: 0.75 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.5, 3.6), bodyMat);
      body.position.y = 1.1;
      box.add(body);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.6 });
      const wheelGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.45, 18);
      const front = new THREE.Mesh(wheelGeo, wheelMat);
      front.rotation.z = Math.PI / 2;
      front.position.set(0, 0.75, 1.5);
      box.add(front);
      const rear = new THREE.Mesh(wheelGeo, wheelMat);
      rear.rotation.z = Math.PI / 2;
      rear.position.set(0, 0.75, -1.5);
      box.add(rear);
      this._bodyMat = bodyMat;
      return group;
    }

    setAccent(hex) {
      this.accentHex = hex;
      if (this._bodyMat) this._bodyMat.color.setHex(hex);
    }

    // Replaces the track ribbon + curve with one built from a real ride's
    // frames (see buildFrames() above); pass null to clear it (live mode).
    setPathFrames(frames) {
      // Guards against the 3D scene never having finished loading (no CDN
      // reachable, WebGL unavailable, etc.) — this instance still exists
      // and gets fed real ride data either way, it just has nothing to
      // draw with yet. See the dbg.guardAsync fallback around Scene3D
      // construction in the screen's render() below.
      if (!this.THREE) {
        this.frames = frames;
        this.mode = frames && frames.length >= 2 ? "path" : "empty";
        return;
      }
      const THREE = this.THREE;
      if (this.trackMesh) {
        this.scene.remove(this.trackMesh);
        this.trackMesh.geometry.dispose();
        this.trackMesh.material.dispose();
        this.trackMesh = null;
      }
      this.frames = frames;
      this.curve = null;
      if (!frames || frames.length < 2) {
        this.mode = "empty";
        return;
      }
      this.mode = "path";
      // Tube follows only points at least 1 m apart (duplicate points from
      // stops give a degenerate spline -> NaN geometry), capped in count.
      const pts = [];
      const stride = Math.max(1, Math.floor(frames.length / 3000));
      let last = null;
      for (let i = 0; i < frames.length; i += stride) {
        const f = frames[i];
        if (!last || Math.hypot(f.x - last.x, f.z - last.z) >= 1) {
          last = new THREE.Vector3(f.x, f.y, f.z);
          pts.push(last);
        }
      }
      this.headings = computeHeadings(frames);
      this._heading = this.headings[0] || 0;
      this._lastBikePos = null;
      if (pts.length >= 2) {
        this.curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
        const segs = Math.max(20, Math.min(1500, pts.length * 2));
        const geometry = new THREE.TubeGeometry(this.curve, segs, 0.9, 8, false);
        const material = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, emissive: 0x475569, roughness: 0.5, metalness: 0.2 });
        this.trackMesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.trackMesh);
      }
    }

    // Called on every replay tick. Heading comes from the real positions
    // around this frame (see computeHeadings), smoothed; the camera snaps
    // instead of gliding when the bike jumps far (scrub / restart).
    setPathPosition(index) {
      if (!this.THREE || this.mode !== "path" || !this.frames || !this.frames.length) return;
      const THREE = this.THREE;
      const i = RydRUtils.clamp(index, 0, this.frames.length - 1);
      const f = this.frames[i];
      const target = this.headings ? this.headings[i] : 0;
      const prev = this._lastBikePos;
      const jumped = !prev || Math.hypot(f.x - prev.x, f.z - prev.z) > 40;
      this._lastBikePos = { x: f.x, z: f.z };
      let d = target - this._heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this._heading = jumped ? target : this._heading + d * 0.25;
      const heading = this._heading;
      this.bikeGroup.position.set(f.x, f.y + 1, f.z);
      this.bikeGroup.rotation.y = heading;
      this.bikeGroup.rotation.z = -(f.roll * DEG2RAD);

      const camOffset = new THREE.Vector3(0, 7, -20).applyAxisAngle(new THREE.Vector3(0, 1, 0), heading);
      const camTarget = this.bikeGroup.position.clone().add(camOffset);
      if (jumped) this.camera.position.copy(camTarget);
      else this.camera.position.lerp(camTarget, 0.12);
      this.camera.lookAt(this.bikeGroup.position);
    }

    // Live mode: no real GPS path available to this plugin (payload.telemetry
    // carries no coordinates), so the bike sits still and only its real
    // roll (from RydROrientation) animates — never a fabricated path.
    setLiveRoll(leanDeg) {
      this.mode = "live";
      if (!this.THREE || !this.bikeGroup) return;
      this.bikeGroup.position.set(0, 1, 0);
      this.bikeGroup.rotation.z = -((leanDeg || 0) * DEG2RAD);
      this.camera.position.lerp(new this.THREE.Vector3(6, 6, 14), 0.05);
      this.camera.lookAt(this.bikeGroup.position);
    }

    tickIdle(dtMs) {
      if (this.mode !== "empty" || !this.ambientMotion) return;
      this._idleT += dtMs * 0.00012;
      this.camera.position.x = Math.sin(this._idleT) * 14;
      this.camera.position.z = 20 + Math.cos(this._idleT) * 6;
      this.camera.position.y = 10;
      this.camera.lookAt(0, 0, 0);
    }

    render() {
      if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
    }

    _onResize() {
      if (!this.renderer || !this.camera) return;
      const w = Math.max(1, this.container.clientWidth);
      const h = Math.max(1, this.container.clientHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }

    destroy() {
      this._destroyed = true;
      if (this._ro) this._ro.disconnect();
      if (this.trackMesh) {
        this.trackMesh.geometry.dispose();
        this.trackMesh.material.dispose();
      }
      if (this.renderer) {
        this.renderer.dispose();
        this.renderer.domElement.remove();
      }
    }
  }

  // ==========================================================================
  // Dashboard card — compact live readout (real telemetry: RydROrientation
  // for lean, payload.telemetry for speed), tapping it opens the full
  // Telemetry Studio screen.
  // ==========================================================================
  const cardState = { dbg: null, root: null, gauge: null, unsubOrientation: null, io: null, visible: true, rafId: null, lastLean: 0 };

  function startCardLoop() {
    if (cardState.rafId) return;
    const step = () => {
      cardState.rafId = requestAnimationFrame(step);
      if (!cardState.visible || !cardState.gauge) return;
      cardState.gauge.draw(cardState.lastLean);
    };
    cardState.rafId = requestAnimationFrame(step);
  }

  // ==========================================================================
  // Full-screen "screen" — ride picker + synced 3D replay / live gauges.
  // ==========================================================================
  const screenState = {
    dbg: null,
    root: null,
    els: {},
    scene: null,
    gauge: null,
    friction: null,
    autoRange: FRICTION_DEFAULT_G,
    sparkline: null,
    settings: null,
    frames: [],
    trail: [], // rolling {gLat,gLon} window for the friction-circle trail
    speed: 1,
    mode: "recorded", // "recorded" | "live"
    playing: false,
    index: 0,
    startedAtMs: 0,
    startedAtSec: 0,
    liveInterval: null,
    unsubOrientation: null,
    liveLean: 0,
    liveSpeedTracker: { mph: null, at: 0 },
    liveGLon: 0,
    rafId: null,
    lastRenderAt: 0,
  };
  const TRAIL_LEN = 30;
  const PLAYBACK_SPEEDS = [1, 2, 5, 10, 30];

  function fmtSec(s) {
    const total = Math.max(0, s);
    const m = Math.floor(total / 60);
    const sec = (total % 60).toFixed(1);
    return `${m}:${sec.padStart(4, "0")}`;
  }

  function buildScreenSkeleton(container) {
    container.innerHTML = `
      <div class="tls-root" id="tlsRoot">
        <div class="tls-toolbar">
          <div class="tls-mode-toggle" id="tlsModeToggle">
            <button type="button" class="tls-mode-btn active" data-mode="recorded">Recorded Ride</button>
            <button type="button" class="tls-mode-btn" data-mode="live">Live</button>
          </div>
          <select id="tlsRideSelect" class="tls-select"></select>
        </div>

        <div class="tls-empty" id="tlsEmpty" hidden>
          <div class="tls-empty-icon">🏍️</div>
          <div class="tls-empty-title">No ride data yet</div>
          <div class="tls-empty-sub">Record a ride from the dashboard, then come back here to explore it in 3D.</div>
        </div>

        <div class="tls-body" id="tlsBody">
          <div class="tls-scene-wrap">
            <div class="tls-scene" id="tlsScene"></div>
            <div class="tls-live-badge" id="tlsLiveBadge" hidden>● LIVE</div>
            <div class="tls-scene-readout">
              <div class="tls-scene-stat"><span id="tlsSpeedVal">0</span><small>MPH</small></div>
              <div class="tls-scene-stat"><span id="tlsLeanVal">0.0°</span><small>LEAN</small></div>
            </div>
          </div>

          <div class="tls-transport" id="tlsTransport">
            <button type="button" class="tls-play-btn" id="tlsPlayBtn" aria-label="Play">▶</button>
            <button type="button" class="tls-speed-btn" id="tlsSpeedBtn" aria-label="Playback speed">1×</button>
            <input type="range" id="tlsScrub" class="tls-scrub" min="0" max="100" value="0" step="0.1" />
            <span class="tls-time" id="tlsTime">0:00.0 / 0:00.0</span>
          </div>

          <div class="tls-widgets">
            <div class="tls-widget" id="tlsGaugeWidget">
              <div class="tls-widget-title">Lean Angle</div>
              <canvas id="tlsGaugeCanvas" width="280" height="150"></canvas>
            </div>
            <div class="tls-widget" id="tlsFrictionWidget">
              <div class="tls-widget-title">Friction Circle</div>
              <canvas id="tlsFrictionCanvas" width="320" height="320"></canvas>
            </div>
            <div class="tls-widget tls-widget-wide" id="tlsSparkWidget">
              <div class="tls-widget-title">Lean &amp; Speed</div>
              <canvas id="tlsSparkCanvas" width="560" height="90"></canvas>
            </div>
          </div>
        </div>
      </div>
    `;
    const rootEl = container.querySelector("#tlsRoot");
    screenState.els = {
      root: rootEl,
      modeToggle: rootEl.querySelector("#tlsModeToggle"),
      rideSelect: rootEl.querySelector("#tlsRideSelect"),
      empty: rootEl.querySelector("#tlsEmpty"),
      body: rootEl.querySelector("#tlsBody"),
      scene: rootEl.querySelector("#tlsScene"),
      liveBadge: rootEl.querySelector("#tlsLiveBadge"),
      speedVal: rootEl.querySelector("#tlsSpeedVal"),
      leanVal: rootEl.querySelector("#tlsLeanVal"),
      transport: rootEl.querySelector("#tlsTransport"),
      playBtn: rootEl.querySelector("#tlsPlayBtn"),
      speedBtn: rootEl.querySelector("#tlsSpeedBtn"),
      scrub: rootEl.querySelector("#tlsScrub"),
      time: rootEl.querySelector("#tlsTime"),
      gaugeCanvas: rootEl.querySelector("#tlsGaugeCanvas"),
      frictionCanvas: rootEl.querySelector("#tlsFrictionCanvas"),
      sparkCanvas: rootEl.querySelector("#tlsSparkCanvas"),
      frictionWidget: rootEl.querySelector("#tlsFrictionWidget"),
      sparkWidget: rootEl.querySelector("#tlsSparkWidget"),
    };
    return rootEl;
  }

  function applyWidgetVisibility() {
    const s = screenState.settings;
    const els = screenState.els;
    if (els.frictionWidget) els.frictionWidget.hidden = !s.showFrictionCircle;
    if (els.sparkWidget) els.sparkWidget.hidden = !s.showSparkline;
    if (els.scene) els.scene.parentElement.hidden = !s.show3D;
  }

  // Friction-circle full scale: fits the loaded ride (auto), else the default.
  function applyFrictionRange() {
    if (!screenState.friction) return;
    screenState.friction.maxG = screenState.mode === "recorded" && screenState.frames.length ? screenState.autoRange : FRICTION_DEFAULT_G;
  }

  async function populateRidePicker() {
    const sel = screenState.els.rideSelect;
    sel.innerHTML = '<option value="">Loading rides…</option>';
    let rides = [];
    try {
      rides = await RydRStorage.listRides();
    } catch (e) {
      screenState.dbg.error("listRides failed", e);
    }
    rides = (rides || []).filter((r) => r.trackPoints && r.trackPoints.length >= 2);
    sel.innerHTML = "";
    if (!rides.length) {
      sel.innerHTML = '<option value="">No recorded rides yet</option>';
      return [];
    }
    rides.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.id;
      const dist = typeof r.distance === "number" ? `${r.distance.toFixed(1)} mi` : "";
      opt.textContent = `${RydRUtils.fmtDate(r.startTime)} · ${RydRUtils.fmtTime(r.startTime)}${dist ? " · " + dist : ""}`;
      sel.appendChild(opt);
    });
    return rides;
  }

  async function loadRide(rideId) {
    const dbg = screenState.dbg;
    if (!rideId) return;
    let ride = null;
    try {
      ride = await RydRStorage.getRide(rideId);
    } catch (e) {
      dbg.error("getRide failed", e);
    }
    if (!ride || !Array.isArray(ride.trackPoints) || ride.trackPoints.length < 2) {
      dbg.warn("selected ride has no usable trackPoints", rideId);
      return;
    }
    screenState.frames = buildFrames(ride.trackPoints);
    screenState.index = 0;
    screenState.trail = [];
    if (screenState.gauge) screenState.gauge.reset();
    if (screenState.scene) screenState.scene.setPathFrames(screenState.frames);
    screenState.autoRange = computeAutoFrictionRange(screenState.frames);
    applyFrictionRange();
    updateScrubRange();
    renderFrameAt(0);
    if (screenState.settings.autoPlay) startPlayback();
  }

  function updateScrubRange() {
    const els = screenState.els;
    const total = screenState.frames.length ? screenState.frames[screenState.frames.length - 1].tSec : 0;
    els.scrub.max = String(Math.max(0.1, total));
    els.scrub.value = "0";
    els.time.textContent = `0:00.0 / ${fmtSec(total)}`;
  }

  function renderFrameAt(index) {
    const frames = screenState.frames;
    if (!frames.length) return;
    const i = RydRUtils.clamp(Math.round(index), 0, frames.length - 1);
    screenState.index = i;
    const f = frames[i];
    const els = screenState.els;

    if (screenState.scene) screenState.scene.setPathPosition(i);
    if (screenState.gauge) screenState.gauge.draw(f.roll);

    const windowStart = Math.max(0, i - TRAIL_LEN);
    const trail = frames.slice(windowStart, i + 1).map((fr) => ({ gLat: fr.gLat, gLon: fr.gLon }));
    if (screenState.friction) screenState.friction.draw(f.gLat, f.gLon, trail);
    if (screenState.sparkline) screenState.sparkline.draw(frames, i, 90);

    els.speedVal.textContent = Math.round(f.speed).toString();
    els.leanVal.textContent = `${f.roll.toFixed(1)}°`;
    const total = frames[frames.length - 1].tSec;
    els.time.textContent = `${fmtSec(f.tSec)} / ${fmtSec(total)}`;
    els.scrub.value = String(f.tSec);
  }

  function startPlayback() {
    const frames = screenState.frames;
    if (!frames.length || screenState.mode !== "recorded") return;
    // Pressing play after a replay finished restarts it from the beginning
    // instead of ending again on the very next frame.
    if (screenState.index >= frames.length - 1) {
      screenState.index = 0;
      screenState.trail = [];
      if (screenState.gauge) screenState.gauge.reset();
    }
    screenState.playing = true;
    screenState.els.playBtn.textContent = "❚❚";
    screenState.els.playBtn.setAttribute("aria-label", "Pause");
    const startTSec = frames[screenState.index].tSec;
    screenState.startedAtMs = performance.now();
    screenState.startedAtSec = startTSec;
    stopPlaybackLoop();
    const step = () => {
      if (!screenState.els.root || !screenState.els.root.isConnected) return;
      if (!screenState.playing) {
        screenState.rafId = null; // idle until startPlayback() schedules a new loop
        return;
      }
      screenState.rafId = requestAnimationFrame(step);
      const elapsed = screenState.startedAtSec + ((performance.now() - screenState.startedAtMs) / 1000) * screenState.speed;
      const frames2 = screenState.frames;
      let idx = screenState.index;
      while (idx < frames2.length - 1 && frames2[idx + 1].tSec <= elapsed) idx++;
      renderFrameAt(idx);
      if (idx >= frames2.length - 1) pausePlayback();
    };
    screenState.rafId = requestAnimationFrame(step);
  }
  function pausePlayback() {
    screenState.playing = false;
    if (screenState.els.playBtn) {
      screenState.els.playBtn.textContent = "▶";
      screenState.els.playBtn.setAttribute("aria-label", "Play");
    }
  }
  function stopPlaybackLoop() {
    if (screenState.rafId) cancelAnimationFrame(screenState.rafId);
    screenState.rafId = null;
  }

  // ---------- live mode (real RydROrientation + polled dashboard telemetry
  // DOM readouts — the same source js/plugins.js's own buildTelemetry()
  // reads from; there is no app-wide telemetry event bus for speed) ----------
  function readLiveSpeed() {
    const el = document.getElementById("speedValue");
    const v = Number(el?.textContent || 0);
    return Number.isFinite(v) ? v : 0;
  }
  function startLiveMode() {
    screenState.mode = "live";
    pausePlayback();
    stopPlaybackLoop();
    screenState.trail = [];
    screenState.els.transport.hidden = true;
    screenState.els.liveBadge.hidden = false;
    if (screenState.scene) screenState.scene.setPathFrames(null);
    applyWidgetVisibility();
    applyFrictionRange();

    if (typeof RydROrientation !== "undefined") {
      screenState.unsubOrientation = RydROrientation.subscribe((o) => {
        screenState.liveLean = o && typeof o.lean === "number" ? o.lean : 0;
      });
    }

    const tick = () => {
      if (!screenState.els.root || !screenState.els.root.isConnected || screenState.mode !== "live") {
        clearInterval(screenState.liveInterval);
        screenState.liveInterval = null;
        return;
      }
      const speed = readLiveSpeed();
      const now = Date.now();
      const tracker = screenState.liveSpeedTracker;
      if (tracker.mph != null) {
        const dtSec = (now - tracker.at) / 1000;
        if (dtSec >= MIN_DT_SEC && dtSec <= MAX_DT_SEC) {
          screenState.liveGLon = RydRUtils.clamp((speed - tracker.mph) / dtSec / MPH_PER_S_PER_G, -SANE_G_CLAMP, SANE_G_CLAMP);
        }
      }
      tracker.mph = speed;
      tracker.at = now;

      const gLat = computeLatG(screenState.liveLean);
      screenState.trail.push({ gLat, gLon: screenState.liveGLon });
      if (screenState.trail.length > TRAIL_LEN) screenState.trail.shift();

      if (screenState.scene) screenState.scene.setLiveRoll(screenState.liveLean);
      if (screenState.gauge) screenState.gauge.draw(screenState.liveLean);
      if (screenState.friction) screenState.friction.draw(gLat, screenState.liveGLon, screenState.trail);
      screenState.els.speedVal.textContent = Math.round(speed).toString();
      screenState.els.leanVal.textContent = `${screenState.liveLean.toFixed(1)}°`;
    };
    tick();
    screenState.liveInterval = setInterval(tick, 500);
  }
  function stopLiveMode() {
    if (screenState.unsubOrientation) {
      screenState.unsubOrientation();
      screenState.unsubOrientation = null;
    }
    if (screenState.liveInterval) {
      clearInterval(screenState.liveInterval);
      screenState.liveInterval = null;
    }
    screenState.els.transport.hidden = false;
    screenState.els.liveBadge.hidden = true;
    applyWidgetVisibility();
  }

  function watchRenderLoop() {
    const step = (now) => {
      if (!screenState.els.root || !screenState.els.root.isConnected) {
        if (screenState.scene) screenState.scene.destroy();
        return;
      }
      requestAnimationFrame(step);
      const dt = now - (screenState.lastRenderAt || now);
      screenState.lastRenderAt = now;
      if (screenState.scene) {
        screenState.scene.tickIdle(dt);
        screenState.scene.render();
      }
    };
    requestAnimationFrame(step);
  }

  async function switchMode(mode) {
    screenState.mode = mode;
    screenState.els.modeToggle.querySelectorAll(".tls-mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    screenState.els.rideSelect.hidden = mode !== "recorded";
    if (mode === "live") {
      pausePlayback();
      stopPlaybackLoop();
      screenState.els.empty.hidden = true;
      screenState.els.body.hidden = false;
      startLiveMode();
    } else {
      stopLiveMode();
      const rideId = screenState.els.rideSelect.value;
      if (rideId) {
        screenState.els.empty.hidden = true;
        screenState.els.body.hidden = false;
        await loadRide(rideId);
      } else {
        screenState.els.empty.hidden = false;
        screenState.els.body.hidden = true;
      }
    }
  }

  function renderSettingsTab(container) {
    const s = getSettings();
    container.innerHTML = `
      <div class="panel-title" style="margin-bottom:8px;">Telemetry Studio</div>
      <p class="modal-desc">3D ride-replay analytics — lean angle, friction circle, and a speed/lean sparkline, driven by your own recorded rides.</p>

      <label class="settings-row">
        <span>3D scene</span>
        <input type="checkbox" id="tlsShow3D" />
      </label>
      <label class="settings-row">
        <span>Ambient camera drift (idle)</span>
        <input type="checkbox" id="tlsAmbient" />
      </label>
      <label class="settings-row">
        <span>Friction circle widget</span>
        <input type="checkbox" id="tlsShowFriction" />
      </label>
      <label class="settings-row">
        <span>Lean &amp; speed sparkline</span>
        <input type="checkbox" id="tlsShowSpark" />
      </label>
      <label class="settings-row">
        <span>Auto-play on ride select</span>
        <input type="checkbox" id="tlsAutoPlay" />
      </label>

      <small style="display:block; font-size:11px; color:var(--text-muted); margin-top:10px;">
        Every widget here reads a real recorded ride's own GPS/lean/speed samples (or, in Live mode, your phone's live
        orientation and current speed) — nothing shown is simulated.
      </small>
    `;
    container.querySelector("#tlsShow3D").checked = s.show3D;
    container.querySelector("#tlsAmbient").checked = s.ambientMotion;
    container.querySelector("#tlsShowFriction").checked = s.showFrictionCircle;
    container.querySelector("#tlsShowSpark").checked = s.showSparkline;
    container.querySelector("#tlsAutoPlay").checked = s.autoPlay;

    const bindToggle = (id, key, after) =>
      container.querySelector(id).addEventListener("change", (e) => {
        const next = saveSettings({ ...getSettings(), [key]: e.target.checked });
        if (after) after(next);
      });
    bindToggle("#tlsShow3D", "show3D", (next) => {
      screenState.settings = next;
      applyWidgetVisibility();
    });
    bindToggle("#tlsAmbient", "ambientMotion", (next) => {
      screenState.settings = next;
      if (screenState.scene) screenState.scene.ambientMotion = next.ambientMotion;
    });
    bindToggle("#tlsShowFriction", "showFrictionCircle", (next) => {
      screenState.settings = next;
      applyWidgetVisibility();
    });
    bindToggle("#tlsShowSpark", "showSparkline", (next) => {
      screenState.settings = next;
      applyWidgetVisibility();
    });
    bindToggle("#tlsAutoPlay", "autoPlay", (next) => {
      screenState.settings = next;
    });
  }

  const plugin = {
    id: "telemetry-studio",
    name: "Telemetry Studio",
    description: "A 3D ride-replay analytics view — lean angle, friction-circle g-force, and a speed/lean sparkline, synced to a real recorded ride (or live).",
    version: "1.3.0",
    icon: "🏍️",
    category: "performance",
    standalone: true,

    render: function (container, payload) {
      const dbg = cardState.dbg || (cardState.dbg = RydRDebugConsole.create({ id: plugin.id, title: plugin.name }));
      let rootEl = container.querySelector(".tls-card-root");
      const firstBuild = !rootEl;
      if (firstBuild) {
        container.innerHTML = `
          <div class="tls-card-root" id="tlsCardRoot">
            <div class="tls-card-head">
              <span class="tls-card-icon">🏍️</span>
              <span class="tls-card-title">Telemetry Studio</span>
            </div>
            <canvas class="tls-card-gauge" id="tlsCardGauge" width="220" height="120"></canvas>
            <div class="tls-card-stats">
              <div class="tls-card-stat"><span id="tlsCardSpeed">0</span><small>MPH</small></div>
              <div class="tls-card-stat"><span id="tlsCardLean">0.0°</span><small>LEAN</small></div>
            </div>
            <button type="button" class="tls-card-open" id="tlsCardOpen">Open Telemetry Studio →</button>
          </div>
        `;
        rootEl = container.querySelector(".tls-card-root");
        container.appendChild(dbg.el);
        cardState.root = rootEl;
        const cardTheme = getSettings().theme;
        applyTheme(rootEl, cardTheme);
        cardState.gauge = new LeanAngleGauge(rootEl.querySelector("#tlsCardGauge"));
        cardState.gauge.accent = THEMES[cardTheme].accent;

        dbg.guard(() => {
          if (typeof RydROrientation !== "undefined" && typeof RydROrientation.subscribe === "function") {
            cardState.unsubOrientation = RydROrientation.subscribe((o) => {
              cardState.lastLean = o && typeof o.lean === "number" ? o.lean : 0;
              const leanEl = rootEl.querySelector("#tlsCardLean");
              if (leanEl) leanEl.textContent = `${cardState.lastLean.toFixed(1)}°`;
            });
          }
        }, "orientation subscribe");

        if (typeof IntersectionObserver !== "undefined") {
          cardState.io = new IntersectionObserver(
            (entries) => entries.forEach((e) => (cardState.visible = e.isIntersecting)),
            { threshold: 0.05 }
          );
          cardState.io.observe(rootEl);
        }

        rootEl.querySelector("#tlsCardOpen").addEventListener("click", () => {
          document.querySelector('[data-plugin-menu-item="telemetry-studio-menu"]')?.click();
        });

        startCardLoop();
      }
      dbg.guard(() => {
        const telemetry = (payload && payload.telemetry) || {};
        const speedEl = rootEl.querySelector("#tlsCardSpeed");
        if (speedEl) speedEl.textContent = Math.round(Number(telemetry.speed) || 0).toString();
      }, "card telemetry update");
    },

    screen: {
      id: "telemetry-studio-screen",
      title: "🏍️ Telemetry Studio",
      render: function (container) {
        const dbg = screenState.dbg || (screenState.dbg = RydRDebugConsole.create({ id: "telemetry-studio-screen", title: "Telemetry Studio" }));
        const rootEl = buildScreenSkeleton(container);
        container.appendChild(dbg.el);
        screenState.settings = getSettings();
        applyTheme(rootEl, screenState.settings.theme);
        applyWidgetVisibility();

        screenState.gauge = new LeanAngleGauge(screenState.els.gaugeCanvas);
        screenState.friction = new FrictionCircle(screenState.els.frictionCanvas, FRICTION_DEFAULT_G);
        screenState.sparkline = new Sparkline(screenState.els.sparkCanvas);
        const accentHex = parseInt(THEMES[screenState.settings.theme].accent.slice(1), 16);
        screenState.gauge.accent = THEMES[screenState.settings.theme].accent;
        screenState.friction.accent = THEMES[screenState.settings.theme].accent;
        applyFrictionRange();

        dbg
          .guardAsync(
            (async () => {
              screenState.scene = new Scene3D(screenState.els.scene, dbg);
              await screenState.scene.init();
              screenState.scene.setAccent(accentHex);
              screenState.scene.ambientMotion = screenState.settings.ambientMotion;
              // The scene can finish loading (CDN round-trip) after a ride was
              // already picked or Live mode was already switched to — bring it
              // up to date with whatever's current instead of starting blank.
              if (screenState.mode === "live") {
                screenState.scene.setLiveRoll(screenState.liveLean);
              } else if (screenState.frames.length) {
                screenState.scene.setPathFrames(screenState.frames);
                screenState.scene.setPathPosition(screenState.index);
              }
              watchRenderLoop();
            })(),
            "Scene3D init",
            { rethrow: true }
          )
          .catch(() => {
            dbg.warn("3D scene unavailable — falling back to gauges only");
            screenState.els.scene.parentElement.hidden = true;
          });

        screenState.els.modeToggle.querySelectorAll(".tls-mode-btn").forEach((btn) => {
          btn.addEventListener("click", () => switchMode(btn.dataset.mode));
        });
        screenState.els.rideSelect.addEventListener("change", () => {
          if (screenState.mode === "recorded") switchMode("recorded");
        });
        screenState.els.speedBtn.addEventListener("click", () => {
          const next = PLAYBACK_SPEEDS[(PLAYBACK_SPEEDS.indexOf(screenState.speed) + 1) % PLAYBACK_SPEEDS.length];
          screenState.speed = next;
          screenState.els.speedBtn.textContent = `${next}×`;
          if (screenState.playing) {
            // rebase the clock so the change takes effect from the current frame
            const f = screenState.frames[screenState.index];
            screenState.startedAtMs = performance.now();
            screenState.startedAtSec = f ? f.tSec : 0;
          }
        });
        screenState.els.playBtn.addEventListener("click", () => {
          if (screenState.playing) pausePlayback();
          else startPlayback();
        });
        screenState.els.scrub.addEventListener("input", () => {
          pausePlayback();
          const frames = screenState.frames;
          if (!frames.length) return;
          const target = Number(screenState.els.scrub.value);
          let idx = 0;
          while (idx < frames.length - 1 && frames[idx].tSec < target) idx++;
          renderFrameAt(idx);
        });

        dbg.guardAsync(
          populateRidePicker().then((rides) => {
            if (rides.length) {
              screenState.els.rideSelect.value = rides[0].id;
              switchMode("recorded");
            } else {
              screenState.els.empty.hidden = false;
              screenState.els.body.hidden = true;
            }
          }),
          "populateRidePicker"
        );
      },
    },
    menuItem: {
      id: "telemetry-studio-menu",
      label: "Telemetry Studio",
      icon: "🏍️",
      targetScreenId: "telemetry-studio-screen",
    },

    settingsTab: {
      id: "telemetry-studio",
      label: "Telemetry Studio",
      render: renderSettingsTab,
    },
  };

  const runtimeKey = "__RydRPluginRuntime__";
  root[runtimeKey] = root[runtimeKey] || {};
  root[runtimeKey][plugin.id] = plugin;
})(window);
