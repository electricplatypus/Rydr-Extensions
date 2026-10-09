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
// rest of RydR, plus two real alternate accents (Circuit Emerald, Ember
// Track). Applied by writing --tls-accent/--tls-accent-dim/--tls-glow as
// inline custom properties on this plugin's own root elements (read by
// this file's CSS in css/style.css, and by the Three.js scene for its
// material colors) — never anything global. Persisted alongside the rest
// of this plugin's app preferences (3D on/off, ambient motion, which
// widgets show) in one settings object; see getSettings()/DEFAULT_SETTINGS.
(function (root) {
  const SETTINGS_KEY = "rydr_telemetry_studio_settings";

  const THEMES = {
    default: { id: "default", label: "Apex Blue", accent: "#4f8cff", accentDim: "#2c5fc7", glow: "rgba(79,140,255,0.30)" },
    emerald: { id: "emerald", label: "Circuit Emerald", accent: "#10b981", accentDim: "#059669", glow: "rgba(16,185,129,0.30)" },
    ember: { id: "ember", label: "Ember Track", accent: "#f97316", accentDim: "#c2410c", glow: "rgba(249,115,22,0.30)" },
  };
  const DEFAULT_SETTINGS = {
    theme: "default",
    show3D: true,
    ambientMotion: true,
    showFrictionCircle: true,
    showSparkline: true,
    autoPlay: true,
    showMap: true,
    mapStyle: "dark",
    frictionRange: "auto",
  };

  // ---------- map styles: keyless raster tile sources (no API key, no
  // server-side proxy needed), swappable from the map's gear panel. ----------
  const CARTO_SUBS = ["a", "b", "c", "d"];
  const cartoTiles = (name) => CARTO_SUBS.map((s) => `https://${s}.basemaps.cartocdn.com/${name}/{z}/{x}/{y}.png`);
  const CARTO_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>';
  const MAP_STYLES = {
    dark: { id: "dark", label: "Dark", tiles: cartoTiles("dark_all"), attribution: CARTO_ATTR, maxzoom: 19, preview: "#1b1f27" },
    light: { id: "light", label: "Light", tiles: cartoTiles("light_all"), attribution: CARTO_ATTR, maxzoom: 19, preview: "#e9ecef" },
    voyager: { id: "voyager", label: "Voyager", tiles: cartoTiles("rastertiles/voyager"), attribution: CARTO_ATTR, maxzoom: 19, preview: "#e8dfcf" },
    streets: {
      id: "streets",
      label: "Streets",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxzoom: 19,
      preview: "#f2efe9",
    },
    satellite: {
      id: "satellite",
      label: "Satellite",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics",
      maxzoom: 19,
      preview: "#2f4a3a",
    },
    topo: {
      id: "topo",
      label: "Topo",
      tiles: ["a", "b", "c"].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
      maxzoom: 17,
      preview: "#c8d9b0",
    },
  };
  // Friction-circle full-scale choices (g). "auto" fits the loaded ride.
  const FRICTION_RANGES = ["auto", 0.25, 0.5, 0.75, 1];
  const FRICTION_AUTO_STEPS = [0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2.5];
  const FRICTION_DEFAULT_G = 0.5;

  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const p = raw ? JSON.parse(raw) : {};
      return {
        theme: THEMES[p.theme] ? p.theme : DEFAULT_SETTINGS.theme,
        show3D: p.show3D !== false,
        ambientMotion: p.ambientMotion !== false,
        showFrictionCircle: p.showFrictionCircle !== false,
        showSparkline: p.showSparkline !== false,
        autoPlay: p.autoPlay !== false,
        showMap: p.showMap !== false,
        mapStyle: MAP_STYLES[p.mapStyle] ? p.mapStyle : DEFAULT_SETTINGS.mapStyle,
        frictionRange: FRICTION_RANGES.includes(p.frictionRange) ? p.frictionRange : DEFAULT_SETTINGS.frictionRange,
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
      const tSec = (p.timestamp - origin.timestamp) / 1000;
      frames.push({ x, y, z, roll, speed, gLat, gLon, tSec, lat: p.lat, lng: p.lng });
    }
    return frames;
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
      const radius = Math.min(w, h) * 0.42;
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

      ctx.fillStyle = "#f0f6fc";
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
      const radius = Math.min(w, h) / 2 - 26;
      const lat = Number.isFinite(gLat) ? gLat : 0;
      const lon = Number.isFinite(gLon) ? gLon : 0;
      const maxG = this.maxG > 0 ? this.maxG : FRICTION_DEFAULT_G;

      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#2a313b";
      [0.25, 0.5, 0.75, 1.0].forEach((ratio) => {
        ctx.beginPath();
        ctx.arc(cx, cy, radius * ratio, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.strokeStyle = "#3a424d";
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.stroke();

      ctx.fillStyle = "#8b949e";
      ctx.font = "11px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("BRAKE", cx, cy + radius + 16);
      ctx.fillText("ACCEL", cx, cy - radius - 8);
      ctx.fillText("L", cx - radius - 12, cy + 4);
      ctx.fillText("R", cx + radius + 12, cy + 4);
      // ring scale (g) along the lower-right diagonal so it never sits on an axis
      ctx.fillStyle = "#59616d";
      ctx.font = "9px 'JetBrains Mono', monospace";
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

      ctx.fillStyle = "#c9d1d9";
      ctx.font = "11px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText(`LAT ${lat.toFixed(2)}g`, 6, 14);
      ctx.fillText(`LON ${lon.toFixed(2)}g`, 6, 28);
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

      const maxSpeed = Math.max(80, ...frames.map((f) => f.speed));

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
  const BIKE_MODEL_SCALE = 4.8;
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
      const pts = frames.map((f) => new THREE.Vector3(f.x, f.y, f.z));
      this.curve = new THREE.CatmullRomCurve3(pts);
      const segs = Math.max(20, Math.min(400, pts.length * 2));
      const geometry = new THREE.TubeGeometry(this.curve, segs, 0.9, 8, false);
      const material = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, emissive: 0x475569, roughness: 0.5, metalness: 0.2 });
      this.trackMesh = new THREE.Mesh(geometry, material);
      this.scene.add(this.trackMesh);
    }

    // frame: {x,y,z,roll} + tangent-derived heading, called on every replay tick.
    setPathPosition(index) {
      if (!this.THREE || this.mode !== "path" || !this.frames || !this.frames.length) return;
      const i = RydRUtils.clamp(index, 0, this.frames.length - 1);
      const f = this.frames[i];
      const u = i / (this.frames.length - 1);
      let heading = this._lastHeading || 0;
      if (this.curve) {
        const tangent = this.curve.getTangentAt(RydRUtils.clamp(u, 0, 1));
        if (tangent.lengthSq() > 1e-6) {
          heading = Math.atan2(tangent.x, tangent.z);
          this._lastHeading = heading;
        }
      }
      this.bikeGroup.position.set(f.x, f.y + 1, f.z);
      this.bikeGroup.rotation.y = heading;
      this.bikeGroup.rotation.z = -(f.roll * DEG2RAD);

      const camOffset = new this.THREE.Vector3(0, 6, -12).applyAxisAngle(new this.THREE.Vector3(0, 1, 0), heading);
      const target = this.bikeGroup.position.clone().add(camOffset);
      this.camera.position.lerp(target, 0.12);
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

  // ---------- MapLibre loader (same CDN-tiered fallback as
  // plugins/chase-cam-3d/chase-cam-3d.js: unpkg -> jsdelivr -> vendor copy) ----------
  const MAPLIBRE_VERSION = "4.7.1";
  const MAPLIBRE_CSS_URLS = [
    `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`,
    `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`,
    "/vendor/maplibre-gl/maplibre-gl.css",
  ];
  const MAPLIBRE_JS_URLS = [
    `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`,
    `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`,
    "/vendor/maplibre-gl/maplibre-gl.js",
  ];
  function loadTag(el) {
    return new Promise((resolve, reject) => {
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`failed to load ${el.src || el.href}`));
      document.head.appendChild(el);
    });
  }
  async function loadFirst(urls, make) {
    let lastErr;
    for (const url of urls) {
      const el = make(url);
      try {
        await loadTag(el);
        return;
      } catch (err) {
        el.remove();
        lastErr = err;
      }
    }
    throw lastErr;
  }
  let maplibrePromise = null;
  function ensureMapLibre() {
    if (window.maplibregl) return Promise.resolve();
    if (maplibrePromise) return maplibrePromise;
    maplibrePromise = (async () => {
      await loadFirst(MAPLIBRE_CSS_URLS, (href) => {
        const l = document.createElement("link");
        l.rel = "stylesheet";
        l.href = href;
        return l;
      }).catch(() => {}); // cosmetic only — map still works unstyled controls aside
      await loadFirst(MAPLIBRE_JS_URLS, (src) => {
        const sc = document.createElement("script");
        sc.src = src;
        return sc;
      });
    })().catch((err) => {
      maplibrePromise = null;
      throw err;
    });
    return maplibrePromise;
  }

  // ---------- 2D route map: the recorded ride's real lat/lng polyline plus a
  // marker following the replay position. Basemap swapped via setStyle(). ----------
  class RideMap {
    constructor(container, dbg) {
      this.container = container;
      this.dbg = dbg;
      this.map = null;
      this.marker = null;
      this.frames = null;
      this.styleId = "dark";
      this.accent = "#4f8cff";
      this._ro = null;
      this._destroyed = false;
    }
    _styleSpec(id) {
      const st = MAP_STYLES[id] || MAP_STYLES.dark;
      return {
        version: 8,
        sources: {
          base: { type: "raster", tiles: st.tiles, tileSize: 256, maxzoom: st.maxzoom, attribution: st.attribution },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": st.preview } },
          { id: "base", type: "raster", source: "base" },
        ],
      };
    }
    async init(styleId) {
      await ensureMapLibre();
      if (this._destroyed) return;
      this.styleId = MAP_STYLES[styleId] ? styleId : "dark";
      const maplibregl = window.maplibregl;
      this.map = new maplibregl.Map({
        container: this.container,
        style: this._styleSpec(this.styleId),
        center: [0, 0],
        zoom: 1,
        attributionControl: { compact: true },
      });
      this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      const el = document.createElement("div");
      el.className = "tls-map-marker";
      this.marker = new maplibregl.Marker({ element: el });
      this.map.on("style.load", () => this._drawRoute());
      this._ro = new ResizeObserver(() => this.map && this.map.resize());
      this._ro.observe(this.container);
    }
    setStyle(id) {
      if (!MAP_STYLES[id] || id === this.styleId) return;
      this.styleId = id;
      if (this.map) this.map.setStyle(this._styleSpec(id));
    }
    setAccent(hex) {
      this.accent = hex;
      if (this.map && this.map.getLayer("route")) this.map.setPaintProperty("route", "line-color", hex);
    }
    setFrames(frames) {
      this.frames = frames && frames.length >= 2 ? frames : null;
      if (!this.map) return;
      if (this.map.isStyleLoaded()) this._drawRoute();
      this._fit();
    }
    _drawRoute() {
      const map = this.map;
      if (!map || this._destroyed) return;
      ["route", "route-casing"].forEach((id) => map.getLayer(id) && map.removeLayer(id));
      if (map.getSource("route")) map.removeSource("route");
      if (!this.frames) {
        this.marker.remove();
        return;
      }
      map.addSource("route", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: this.frames.map((f) => [f.lng, f.lat]) } },
      });
      map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000000", "line-opacity": 0.55, "line-width": 8 } });
      map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": this.accent, "line-width": 4.5 } });
      this.setPosition(this._lastIndex || 0);
    }
    _fit() {
      if (!this.map || !this.frames) return;
      const b = new window.maplibregl.LngLatBounds();
      this.frames.forEach((f) => b.extend([f.lng, f.lat]));
      this.map.resize();
      this.map.fitBounds(b, { padding: 36, duration: 0, maxZoom: 17 });
    }
    setPosition(index) {
      this._lastIndex = index;
      if (!this.map || !this.frames) return;
      const f = this.frames[RydRUtils.clamp(index, 0, this.frames.length - 1)];
      if (!f) return;
      this.marker.setLngLat([f.lng, f.lat]);
      this.marker.addTo(this.map);
    }
    resize() {
      if (!this.map) return;
      this.map.resize();
      this._fit();
    }
    destroy() {
      this._destroyed = true;
      if (this._ro) this._ro.disconnect();
      if (this.map) this.map.remove();
      this.map = null;
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
    rideMap: null,
    autoRange: FRICTION_DEFAULT_G,
    sparkline: null,
    settings: null,
    frames: [],
    trail: [], // rolling {gLat,gLon} window for the friction-circle trail
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

          <div class="tls-map-wrap" id="tlsMapWrap">
            <div class="tls-map" id="tlsMap"></div>
            <button type="button" class="tls-gear-btn" id="tlsGearBtn" aria-label="Map quick settings" aria-haspopup="true" aria-expanded="false">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
            </button>
            <div class="tls-qs-panel" id="tlsQsPanel" role="dialog" aria-label="Quick settings" hidden>
              <div class="tls-qs-title">Map style</div>
              <div class="tls-qs-styles" id="tlsQsStyles"></div>
              <div class="tls-qs-title">Friction circle range</div>
              <div class="tls-qs-ranges" id="tlsQsRanges"></div>
            </div>
            <div class="tls-map-msg" id="tlsMapMsg" hidden>Map unavailable</div>
          </div>

          <div class="tls-transport" id="tlsTransport">
            <button type="button" class="tls-play-btn" id="tlsPlayBtn" aria-label="Play">▶</button>
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
      mapWrap: rootEl.querySelector("#tlsMapWrap"),
      map: rootEl.querySelector("#tlsMap"),
      mapMsg: rootEl.querySelector("#tlsMapMsg"),
      gearBtn: rootEl.querySelector("#tlsGearBtn"),
      qsPanel: rootEl.querySelector("#tlsQsPanel"),
      qsStyles: rootEl.querySelector("#tlsQsStyles"),
      qsRanges: rootEl.querySelector("#tlsQsRanges"),
      transport: rootEl.querySelector("#tlsTransport"),
      playBtn: rootEl.querySelector("#tlsPlayBtn"),
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
    if (els.mapWrap) {
      els.mapWrap.hidden = !s.showMap || screenState.mode === "live";
      if (!els.mapWrap.hidden && screenState.rideMap) screenState.rideMap.resize();
    }
  }

  // ---------- quick-settings (gear) panel: map style + friction range ----------
  function effectiveFrictionRange() {
    const r = screenState.settings.frictionRange;
    if (r === "auto") return screenState.mode === "recorded" && screenState.frames.length ? screenState.autoRange : FRICTION_DEFAULT_G;
    return r;
  }
  function applyFrictionRange() {
    if (screenState.friction) screenState.friction.maxG = effectiveFrictionRange();
  }
  function redrawFriction() {
    if (!screenState.friction) return;
    if (screenState.mode === "recorded" && screenState.frames.length) renderFrameAt(screenState.index);
  }
  function renderQuickSettings() {
    const { qsStyles, qsRanges } = screenState.els;
    const s = screenState.settings;
    qsStyles.innerHTML = Object.values(MAP_STYLES)
      .map(
        (m) => `<button type="button" class="tls-qs-style${m.id === s.mapStyle ? " selected" : ""}" data-style="${m.id}" aria-pressed="${m.id === s.mapStyle}">
          <span class="tls-qs-swatch" style="background:${m.preview};"></span>${RydRUtils.escapeHtml(m.label)}</button>`
      )
      .join("");
    qsRanges.innerHTML = FRICTION_RANGES.map((r) => {
      const label = r === "auto" ? "Auto" : `${r}g`;
      return `<button type="button" class="tls-qs-range${r === s.frictionRange ? " selected" : ""}" data-range="${r}" aria-pressed="${r === s.frictionRange}">${label}</button>`;
    }).join("");
  }
  function setQuickSettingsOpen(open) {
    const { qsPanel, gearBtn } = screenState.els;
    qsPanel.hidden = !open;
    gearBtn.setAttribute("aria-expanded", String(open));
  }
  function wireQuickSettings() {
    const els = screenState.els;
    els.gearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setQuickSettingsOpen(els.qsPanel.hidden);
    });
    els.qsPanel.addEventListener("click", (e) => {
      e.stopPropagation();
      const styleBtn = e.target.closest("[data-style]");
      const rangeBtn = e.target.closest("[data-range]");
      if (styleBtn && MAP_STYLES[styleBtn.dataset.style]) {
        screenState.settings = saveSettings({ ...getSettings(), mapStyle: styleBtn.dataset.style });
        if (screenState.rideMap) screenState.rideMap.setStyle(screenState.settings.mapStyle);
      } else if (rangeBtn) {
        const raw = rangeBtn.dataset.range;
        const val = raw === "auto" ? "auto" : Number(raw);
        if (!FRICTION_RANGES.includes(val)) return;
        screenState.settings = saveSettings({ ...getSettings(), frictionRange: val });
        applyFrictionRange();
        redrawFriction();
      } else {
        return;
      }
      renderQuickSettings();
    });
    const close = (e) => {
      if (!els.root.isConnected) {
        document.removeEventListener("click", close);
        document.removeEventListener("keydown", onKey);
        return;
      }
      if (!els.qsPanel.hidden && !els.qsPanel.contains(e.target)) setQuickSettingsOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape" && !els.qsPanel.hidden) setQuickSettingsOpen(false);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    renderQuickSettings();
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
    if (screenState.rideMap) screenState.rideMap.setFrames(screenState.frames);
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
    if (screenState.rideMap) screenState.rideMap.setPosition(i);
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
    screenState.playing = true;
    screenState.els.playBtn.textContent = "❚❚";
    screenState.els.playBtn.setAttribute("aria-label", "Pause");
    const startTSec = frames[screenState.index].tSec;
    screenState.startedAtMs = performance.now();
    screenState.startedAtSec = startTSec;
    stopPlaybackLoop();
    const step = () => {
      if (!screenState.els.root || !screenState.els.root.isConnected) return;
      screenState.rafId = requestAnimationFrame(step);
      if (!screenState.playing) return;
      const elapsed = screenState.startedAtSec + (performance.now() - screenState.startedAtMs) / 1000;
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
        if (screenState.rideMap) screenState.rideMap.destroy();
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
    const themeButtons = Object.values(THEMES)
      .map(
        (t) => `
        <button type="button" class="tls-theme-swatch${t.id === s.theme ? " selected" : ""}" data-theme-id="${t.id}"
          style="--tls-accent:${t.accent};">
          <span class="tls-theme-dot"></span>${RydRUtils.escapeHtml(t.label)}
        </button>`
      )
      .join("");
    container.innerHTML = `
      <div class="panel-title" style="margin-bottom:8px;">Telemetry Studio</div>
      <p class="modal-desc">3D ride-replay analytics — lean angle, friction circle, route map, and a speed/lean sparkline, driven by your own recorded rides.</p>

      <div class="tls-settings-label">Theme</div>
      <div class="tls-theme-row">${themeButtons}</div>

      <label class="settings-row">
        <span>3D scene</span>
        <input type="checkbox" id="tlsShow3D" />
      </label>
      <label class="settings-row">
        <span>Ambient camera drift (idle)</span>
        <input type="checkbox" id="tlsAmbient" />
      </label>
      <label class="settings-row">
        <span>Route map</span>
        <input type="checkbox" id="tlsShowMap" />
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
    container.querySelector("#tlsShowMap").checked = s.showMap;
    container.querySelector("#tlsShowFriction").checked = s.showFrictionCircle;
    container.querySelector("#tlsShowSpark").checked = s.showSparkline;
    container.querySelector("#tlsAutoPlay").checked = s.autoPlay;

    container.querySelectorAll(".tls-theme-swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = saveSettings({ ...getSettings(), theme: btn.dataset.themeId });
        const accent = THEMES[next.theme].accent;
        container.querySelectorAll(".tls-theme-swatch").forEach((b) => b.classList.toggle("selected", b === btn));
        if (cardState.root) {
          applyTheme(cardState.root, next.theme);
          if (cardState.gauge) cardState.gauge.accent = accent;
        }
        if (screenState.els.root) {
          applyTheme(screenState.els.root, next.theme);
          if (screenState.gauge) screenState.gauge.accent = accent;
          if (screenState.friction) screenState.friction.accent = accent;
          if (screenState.rideMap) screenState.rideMap.setAccent(accent);
          if (screenState.scene) screenState.scene.setAccent(parseInt(accent.slice(1), 16));
        }
      });
    });
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
    bindToggle("#tlsShowMap", "showMap", (next) => {
      screenState.settings = next;
      applyWidgetVisibility();
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
    description: "A 3D ride-replay analytics view — lean angle, friction-circle g-force, a route map with selectable styles, and a speed/lean sparkline, synced to a real recorded ride (or live).",
    version: "1.2.0",
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
        if (screenState.rideMap) {
          screenState.rideMap.destroy();
          screenState.rideMap = null;
        }
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
        wireQuickSettings();

        dbg
          .guardAsync(
            (async () => {
              screenState.rideMap = new RideMap(screenState.els.map, dbg);
              screenState.rideMap.accent = THEMES[screenState.settings.theme].accent;
              await screenState.rideMap.init(screenState.settings.mapStyle);
              if (screenState.frames.length) {
                screenState.rideMap.setFrames(screenState.frames);
                screenState.rideMap.setPosition(screenState.index);
              }
            })(),
            "RideMap init",
            { rethrow: true }
          )
          .catch(() => {
            dbg.warn("map unavailable — MapLibre failed to load");
            screenState.rideMap = null;
            screenState.els.map.hidden = true;
            screenState.els.mapMsg.hidden = false;
          });

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
