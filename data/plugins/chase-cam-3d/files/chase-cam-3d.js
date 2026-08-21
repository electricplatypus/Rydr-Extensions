// 3D Chase Cam plugin: a live MapLibre GL + Three.js scene that follows the
// rider's real GPS position from a chase-cam perspective — slightly behind
// and above, on a tilted dark map with a glowing orange road/trail and an
// atmospheric fade into the distance.
//
// Why raw Three.js + GLTFLoader instead of the threebox-plugin library the
// original design notes for this feature referenced: threebox-plugin
// targets Mapbox GL JS, not MapLibre — the MapLibre-compatible fork
// ("threelibre") pins to an older MapLibre release than the 4.7.1 this app
// already loads elsewhere (js/ride-detail.js, ride.html), so pulling it in
// risked a version mismatch for a feature that's hard to test headlessly.
// js/ride-detail.js has a similar MapLibre-native custom layer for this
// exact models/rider-bike.glb via raw Three.js, which this plugin's
// technique is modeled on — but that code path is currently dormant
// (ride.html deliberately doesn't load Three.js/GLTFLoader for it, falling
// back to a flat 2D marker instead) and, on inspection, never attaches a
// DRACOLoader either, so it would hit the same "No DRACOLoader instance
// provided" failure this plugin did before that was fixed here. Treat it
// as an unverified reference, not a proven one.
(function (root) {
  const MAPLIBRE_VERSION = "4.7.1"; // matches the version js/ride-detail.js and ride.html already load
  // unpkg.com specifically shows up on some ad-blocker/DNS-filter lists
  // (it's been abused for cryptomining payloads in the past on unrelated
  // sites, which got the whole domain flagged by a few blocklists) — a
  // fetch from it can fail for a rider even when their connection is
  // otherwise fine. jsDelivr is a separate CDN, so it's a fallback rather
  // than just retrying the same host that already said no — and
  // vendor/maplibre-gl/ (committed to the repo, same-origin, no CDN
  // involved at all) is the last resort if *both* CDNs are unreachable.
  // CDN stays first so a normal install always gets the latest patch of
  // whatever version is pinned here; local only kicks in when that fails.
  const MAPLIBRE_CSS_URLS = [
    `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`,
    `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`,
    "vendor/maplibre-gl/maplibre-gl.css",
  ];
  const MAPLIBRE_JS_URLS = [
    `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`,
    `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`,
    "vendor/maplibre-gl/maplibre-gl.js",
  ];

  // three.js dropped its non-module examples/js loaders years ago, so
  // GLTFLoader only exists as an ES module now — loaded via dynamic
  // import() rather than a classic <script> tag. GLTFLoader.js itself
  // `import`s bare-specifier `'three'` internally, which unpkg/jsdelivr
  // serve completely unmodified — browsers can't resolve a bare
  // specifier without an import map, so a plain CDN fetch of GLTFLoader
  // fails to *link* even once the file itself downloads fine (`?module`
  // asks unpkg to rewrite those bare imports to real URLs, which is what
  // actually makes the CDN tier work at all here). vendor/three/ is the
  // one tier guaranteed to work regardless: its copy of GLTFLoader.js has
  // that import pre-rewritten to a relative path, no CDN/import-map
  // resolution involved.
  const THREE_VERSION = "0.160.0";
  const THREE_MODULE_URLS = [
    `https://unpkg.com/three@${THREE_VERSION}/build/three.module.js`,
    `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`,
    "/vendor/three/build/three.module.js",
  ];
  // No "?module" on the unpkg entries — that flag makes unpkg rewrite this
  // file's own internal bare `from "three"` import to whatever URL unpkg
  // resolves internally, which is NOT guaranteed to be byte-identical to
  // THREE_MODULE_URLS[i] above. When it isn't, the browser treats them as
  // two different modules — two separate copies of THREE.Material et al —
  // and GLTFLoader ends up building materials with a DIFFERENT Material
  // class than the one our own renderer/scene use, which surfaces as
  // "material.onBuild is not a function" deep inside three.js's own
  // WebGLRenderer (confirmed via a real device report — unpkg had
  // succeeded, so the app never hit its own vendor fallback, which is
  // exactly why this went unnoticed in testing: this sandbox's network
  // always fails unpkg/jsdelivr and falls through to the vendor tier,
  // whose loaders import three.js via a relative path instead of a bare
  // specifier, sidestepping this entirely). The import map installed in
  // ensureThree() below is what actually guarantees a single shared
  // instance; loading the raw (unrewritten) file here is a required part
  // of that fix — unpkg's own rewriting and our import map would
  // otherwise fight each other.
  const GLTF_LOADER_URLS = [
    `https://unpkg.com/three@${THREE_VERSION}/examples/jsm/loaders/GLTFLoader.js`,
    `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/loaders/GLTFLoader.js`,
    "/vendor/three/examples/jsm/loaders/GLTFLoader.js",
  ];
  // rider-bike.glb uses Draco mesh compression (a common glTF export
  // optimization for a ~10MB model) — GLTFLoader refuses to decode a
  // Draco-compressed mesh at all without an explicitly attached
  // DRACOLoader, throwing "No DRACOLoader instance provided" instead.
  // This was unconditional and had nothing to do with CDN/network
  // reliability — every previous load attempt, on every device, would
  // have hit this exact error regardless of which CDN tier won above.
  const DRACO_LOADER_URLS = [
    `https://unpkg.com/three@${THREE_VERSION}/examples/jsm/loaders/DRACOLoader.js`,
    `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/loaders/DRACOLoader.js`,
    "/vendor/three/examples/jsm/loaders/DRACOLoader.js",
  ];
  // Google's own public CDN hosting of the Draco decoder WASM/JS — the
  // standard, widely-used default decoder path for DRACOLoader when an
  // app isn't shipping its own copy of the (fairly large) decoder files.
  const DRACO_DECODER_PATH = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";
  // Unlike MapLibre/three.js above, this had no fallback host — gstatic
  // being unreachable on some rider's network silently killed the whole
  // chase cam past "model fetched, parsing…" with no recovery. Same
  // no-cors reachability-probe pattern used for style fallback below.
  const DRACO_DECODER_PATH_LOCAL = "/vendor/draco/";
  let dracoDecoderPathPromise = null;
  function resolveDracoDecoderPath() {
    if (dracoDecoderPathPromise) return dracoDecoderPathPromise;
    dracoDecoderPathPromise = withTimeout(
      fetch(`${DRACO_DECODER_PATH}draco_wasm_wrapper.js`, { mode: "no-cors", cache: "force-cache" }),
      4000,
      "draco decoder host timed out"
    )
      .then(() => DRACO_DECODER_PATH)
      .catch((err) => {
        debugLog(`draco decoder host unreachable (${(err && err.message) || err}) — using local vendor copy`);
        return DRACO_DECODER_PATH_LOCAL;
      });
    return dracoDecoderPathPromise;
  }

  const MODEL_URL = "models/rider-bike.glb";
  // Same Cache Storage bucket js/ride-detail.js uses for the identical
  // file — whichever feature loads it first, the ~10MB model only ever
  // downloads once per browser.
  const MODEL_CACHE_NAME = "rydr-model-cache-v1";

  // CARTO's free, keyless dark-matter vector style — same OpenMapTiles
  // schema (source-layer names like "transportation" for roads) as the
  // "liberty" style ride-detail.js uses, just dark out of the box instead
  // of needing a runtime dark-mode reskin. A live device report showed
  // basemaps.cartocdn.com itself timing out (~24s) even though the
  // MapLibre *library* had already loaded fine from unpkg moments
  // earlier — a single-host style, unlike the 3-tier CDN fallback every
  // *script* load in this file already gets, had no fallback at all and
  // permanently broke the whole feature for that network. OpenFreeMap's
  // "liberty" style (already proven reachable — ride-detail.js/ride.html
  // use it for the ride-replay map) is the second candidate; it's a light
  // style by default, so applyDarkGround() below re-themes it to match
  // this card's always-dark instrument-panel look when it's the one that
  // actually loads.
  const STYLE_URLS = [
    "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    "https://tiles.openfreemap.org/styles/liberty",
  ];
  // Both STYLE_URLS candidates are remote basemap providers — if neither
  // is reachable (the exact CARTO-timeout report that started this whole
  // fallback chain), the map previously never constructed at all, taking
  // the bike model and everything else down with it. A same-origin,
  // sourceless style (just a flat background color, no fetches) guarantees
  // map.on("load") always fires — no real terrain/roads, but the chase
  // cam and bike model still work, which matters more than a rider
  // staring at a blank error screen. Matches labs.js's identical fallback
  // for the same reasoning.
  const LOCAL_FALLBACK_STYLE = {
    version: 8,
    name: "chase-cam-offline-fallback",
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": "#0c0f14" } }],
  };
  const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

  const GLOW_ORANGE = "#ff9d2e";
  const GLOW_ORANGE_CORE = "#ffc27a";
  const DEFAULT_CENTER = [-83.9213, 35.4668]; // Deals Gap, NC — same app-wide fallback as everywhere else
  const CHASE_PITCH = 68;
  const CHASE_ZOOM = 17.6;
  // Centering the camera directly ON the rider (the previous behavior)
  // put an even amount of road behind and ahead — a true top-down chase
  // cam, not what riding behind someone as a passenger actually looks
  // like: the bike sits low in your own field of view and most of what
  // you see is the road unrolling ahead of it. MapLibre's own `padding`
  // option (verified directly — jumpTo() reads padding but silently
  // ignores `offset`, which only easeTo/flyTo process) shifts where the
  // given center renders on screen without touching resolution, tile
  // fetching, or terrain quality — it's a camera-math parameter, not a
  // CSS crop, so nothing is lost. 0.68 means the rider renders 68% of
  // the way down the frame, leaving the top ~2/3 of the view for the
  // road and terrain ahead.
  const CHASE_FOCUS_FRACTION = 0.68;
  // The model is authored at real bike+rider scale (~2m long, verified by
  // measuring its own bounding box) and rendered using MapLibre's own
  // meters-to-mercator-units conversion, so it was mathematically correct
  // but visually tiny — a literal 2m object against a wide, steeply
  // tilted chase view spanning many meters of road reads as a speck, and
  // that smallness is also what made it hard to tell if it was actually
  // sitting on the road or drifted to one side. Nav apps don't render
  // vehicle icons at true scale for the same reason; this multiplier is
  // the same idea — proportional to real-world size (so it still scales
  // correctly with map zoom/distance), just deliberately exaggerated so
  // the bike reads clearly against the road instead of disappearing into
  // it. Tune this constant directly if it still looks too small/large.
  const MODEL_SCALE_MULTIPLIER = 8;
  // Raw bounding-box height (Y axis, pre-scale), measured by loading the
  // actual model and reading Box3().getSize() — not a guess. Used to lift
  // the model so its wheels sit on the terrain instead of its center.
  const MODEL_HALF_HEIGHT_METERS = 1.6042989492416382 / 2;
  const TRAIL_MAX_POINTS = 180; // ~a few minutes of breadcrumb at typical GPS update rates
  const TWEEN_MS = 900; // a little longer than the ~1s GPS update cadence so motion never visibly catches up and stalls

  // On-screen debug console — a phone has no easy way to reach a JS console
  // (no on-device devtools; USB remote debugging to a desktop is the only
  // real option), which made a real failure here undiagnosable from a bug
  // report alone. Uses the shared RydRDebugConsole component (js/debug-
  // console.js) — see skills/rydr-plugin-development/SKILL.md for the
  // general pattern this is just one real usage of. Only one chase-cam
  // instance is ever active at a time, so a single module-level reference
  // (set at the top of initChaseCam) is enough — the CDN/script loaders
  // below run as plain module-level functions, outside any one instance's
  // own closure. Falls back to a plain console.log if debug-console.js
  // somehow isn't loaded on this page, so this never becomes a hard
  // dependency.
  let activeDebugConsole = null;
  function debugLog(msg) {
    if (activeDebugConsole) activeDebugConsole.log(msg);
    else console.log("[chase-cam]", msg);
  }

  // ---------- lazy loaders (mirrors js/maps.js / js/maps-nav.js's pattern) ----------
  // Loads a classic <script> tag, resolving/rejecting on its own
  // load/error events.
  function loadScriptTag(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Script failed to load: ${src}`));
      document.head.appendChild(script);
    });
  }

  // Tries each URL in order, only moving to the next once the previous one
  // actually fails — not a race, since firing every CDN at once would just
  // multiply load on whichever one *is* working for no benefit.
  async function loadFirstWorking(urls, loader) {
    let lastErr;
    for (const url of urls) {
      try {
        const result = await loader(url);
        debugLog(`loaded: ${url}`);
        return result;
      } catch (err) {
        debugLog(`failed (${err && err.message}): ${url}`);
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
      if (!MAPLIBRE_CSS_URLS.some((href) => document.querySelector(`link[href="${href}"]`))) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = MAPLIBRE_CSS_URLS[0]; // cosmetic only — worth trying the primary CDN even if the JS ends up on the fallback
        document.head.appendChild(link);
      }
      await loadFirstWorking(MAPLIBRE_JS_URLS, loadScriptTag);
    })().catch((err) => {
      // Clear the cache on failure so a later retry actually issues a
      // fresh request instead of replaying this same rejection forever —
      // without this, Retry would never be able to recover from a
      // transient network failure (the whole point of having a Retry
      // button in the first place).
      maplibrePromise = null;
      throw err;
    });
    return maplibrePromise;
  }

  // Matching THREE_MODULE_URLS[i] to GLTF_LOADER_URLS[i] by index alone
  // turned out not to be enough — even at a matched index, unpkg serving
  // GLTFLoader.js with "?module" rewrites *its own* internal bare
  // `from "three"` import to whatever URL unpkg resolves internally,
  // which isn't guaranteed to be byte-identical to THREE_MODULE_URLS[i].
  // When it isn't, the browser treats them as two different modules —
  // two separate copies of THREE.Material et al — and GLTFLoader ends up
  // building materials with a DIFFERENT Material class than the one our
  // own renderer/scene use, surfacing deep inside three.js's own
  // WebGLRenderer as "material.onBuild is not a function" (confirmed via
  // a real device report). An import map is what actually guarantees a
  // single shared instance — see ensureThreeImportMap() below — which is
  // also why GLTF_LOADER_URLS/DRACO_LOADER_URLS no longer use "?module":
  // unpkg's own rewriting and our import map would otherwise fight each
  // other.
  //
  // An import map can only be registered ONCE per page and only before
  // the page's first module resolution, so it's deliberately not
  // installed until AFTER a core three.js import has already SUCCEEDED
  // from a specific URL — guaranteeing the mapping always points at a
  // tier that's actually working, not just the first one attempted.
  let importMapInserted = false;
  function ensureThreeImportMap(threeUrl) {
    if (importMapInserted) return;
    importMapInserted = true;
    const script = document.createElement("script");
    script.type = "importmap";
    script.textContent = JSON.stringify({ imports: { three: threeUrl } });
    document.head.appendChild(script);
    debugLog(`import map installed: three -> ${threeUrl}`);
  }

  let corePromise = null;
  function ensureThreeCore() {
    if (corePromise) return corePromise;
    corePromise = (async () => {
      let lastErr;
      for (const url of THREE_MODULE_URLS) {
        try {
          const THREE = await import(url);
          debugLog(`three.js core loaded: ${url}`);
          return { THREE, url };
        } catch (err) {
          debugLog(`three.js core failed (${err && err.message}): ${url}`);
          lastErr = err;
        }
      }
      throw lastErr;
    })().catch((err) => {
      corePromise = null;
      throw err;
    });
    return corePromise;
  }

  let threePromise = null;
  function ensureThree() {
    if (threePromise) return threePromise;
    threePromise = (async () => {
      const { THREE, url: coreUrl } = await ensureThreeCore();
      ensureThreeImportMap(coreUrl);
      const tierIndex = THREE_MODULE_URLS.indexOf(coreUrl);
      const [gltfMod, dracoMod] = await Promise.all([import(GLTF_LOADER_URLS[tierIndex]), import(DRACO_LOADER_URLS[tierIndex])]);
      debugLog(`GLTFLoader/DRACOLoader loaded (matching tier: ${GLTF_LOADER_URLS[tierIndex]})`);
      return { THREE, GLTFLoader: gltfMod.GLTFLoader, DRACOLoader: dracoMod.DRACOLoader };
    })().catch((err) => {
      threePromise = null;
      throw err;
    });
    return threePromise;
  }

  async function loadModelArrayBuffer(url) {
    if ("caches" in window) {
      try {
        const cache = await caches.open(MODEL_CACHE_NAME);
        const cached = await cache.match(url);
        if (cached) return await cached.arrayBuffer();
        const res = await fetch(url);
        if (res.ok) {
          cache.put(url, res.clone()).catch(() => {});
          return await res.arrayBuffer();
        }
      } catch (e) {
        // Cache Storage unavailable — fall through to a plain fetch.
      }
    }
    const res = await fetch(url);
    return await res.arrayBuffer();
  }

  // A blocked/hanging request (captive portal, ad-blocker silently
  // dropping a request, a flaky cell connection dropping the style/tile
  // fetches after the script itself loaded fine, etc.) may never fire a
  // script or map "error" event at all — without an explicit timeout on
  // every stage, any of those leaves the card on "Loading…" forever with
  // no way to tell it's actually stuck, and no way to recover without
  // reloading the whole app. Module-level (not just inside one instance's
  // closure) so both the MapLibre script loader and resolveStyle() below
  // share the same helper.
  const withTimeout = (promise, ms, message) =>
    Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);

  // ---------- angle/position helpers ----------
  function shortestAngleDelta(a, b) {
    let d = (b - a) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function lerpAngle(a, b, t) {
    return a + shortestAngleDelta(a, b) * t;
  }
  function getBearing(start, end) {
    const lat1 = (start[1] * Math.PI) / 180;
    const lat2 = (end[1] * Math.PI) / 180;
    const dLng = ((end[0] - start[0]) * Math.PI) / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  // ---------- 3D bike model, rendered as a MapLibre custom layer ----------
  // Exposes setCoords([lng,lat,alt]) / setRotation({z}) so the update code
  // driving it reads like a normal Threebox integration even though the
  // rendering underneath is a plain MapLibre "custom" layer + Three.js —
  // see the file header for why.
  function createBikeModelLayer(onReady) {
    let THREEref = null;
    let renderer, camera, scene, model;
    let ready = false;
    let coords = null; // [lng, lat, altMeters]
    let headingRad = 0;

    return {
      id: "chase-cam-bike-model",
      type: "custom",
      renderingMode: "3d",
      onAdd(map, gl) {
        ensureThree()
          .then(async ({ THREE, GLTFLoader, DRACOLoader }) => {
            THREEref = THREE;
            camera = new THREE.Camera();
            scene = new THREE.Scene();
            const sun = new THREE.DirectionalLight(0xffffff, 1.1);
            sun.position.set(0, -70, 100).normalize();
            scene.add(sun);
            const fill = new THREE.DirectionalLight(0xff9d2e, 0.55); // faint orange kick to match the glow theme
            fill.position.set(0, 70, 40).normalize();
            scene.add(fill);
            scene.add(new THREE.AmbientLight(0xffffff, 0.5));

            renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
            renderer.autoClear = false;

            // rider-bike.glb is Draco-compressed — GLTFLoader refuses to
            // decode that at all without an attached DRACOLoader.
            const dracoLoader = new DRACOLoader();
            dracoLoader.setDecoderPath(await resolveDracoDecoderPath());
            const gltfLoader = new GLTFLoader();
            gltfLoader.setDRACOLoader(dracoLoader);

            loadModelArrayBuffer(MODEL_URL)
              .then((buffer) => {
                gltfLoader.parse(
                  buffer,
                  "",
                  (gltf) => {
                    model = gltf.scene;
                    scene.add(model);
                    ready = true;
                    debugLog("bike model ready");
                    map.triggerRepaint();
                    if (typeof onReady === "function") onReady();
                  },
                  (err) => debugLog(`bike model failed to parse: ${err && err.message}`)
                );
              })
              .catch((err) => debugLog(`bike model failed to fetch: ${err && err.message}`));
          })
          .catch((err) => debugLog(`three.js failed to load: ${err && err.message}`));
      },
      setCoords([lng, lat, alt]) {
        coords = [lng, lat, alt || 0];
      },
      setRotation({ z }) {
        // See MODEL_HEADING_OFFSET/rotation-axis comment in render() below —
        // heading=0 (north) needs a 180° turn from the model's raw resting
        // pose, verified by rendering the model top-down at heading
        // 0/90/180 against a north-up map and checking it pointed up/
        // right/down. Kept here (not a shared constant) since this plugin
        // takes rotation as a raw {z} degrees argument, not radians.
        if (typeof z === "number") headingRad = (-z * Math.PI) / 180 + Math.PI;
      },
      isReady() {
        return ready;
      },
      render(gl, matrix) {
        if (!ready || !model || !coords || !THREEref) return;
        const THREE = THREEref;
        // The model's local origin sits at its own geometric center (raw
        // bbox center measured at ~(0,0,0)), not at its wheels, so
        // translating straight to ground-level terrain elevation buried
        // half the model's (scaled) height below the road. Lift by half
        // the model's real height, scaled the same as its geometry, so
        // the wheels land on the terrain instead of the model's belly.
        const merc = maplibregl.MercatorCoordinate.fromLngLat([coords[0], coords[1]], coords[2] + MODEL_HALF_HEIGHT_METERS * MODEL_SCALE_MULTIPLIER);
        const scale = merc.meterInMercatorCoordinateUnits() * MODEL_SCALE_MULTIPLIER;

        // glTF is Y-up; MapLibre's world is Z-up, hence rotationX. Heading
        // rotates the model around its own local Y (up) axis *first*,
        // while still in the model's native frame — rotating around Z
        // here (the model's forward axis, after Y-up->Z-up conversion had
        // already happened) doesn't turn the model to face a new heading
        // at all, since a rotation leaves points on its own axis
        // invariant; it just rolls the model onto its side. Confirmed by
        // computing where local "forward"/"up" test points actually land
        // in world space across a full heading sweep with this exact
        // matrix chain — forward should sweep the horizon and up should
        // stay vertical; rotating around local Z failed both, local Y
        // passes both.
        const rotationX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
        const rotationY = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 1, 0), headingRad);
        const l = new THREE.Matrix4()
          .makeTranslation(merc.x, merc.y, merc.z)
          .scale(new THREE.Vector3(scale, -scale, scale))
          .multiply(rotationX)
          .multiply(rotationY);
        const m = new THREE.Matrix4().fromArray(matrix);

        camera.projectionMatrix = m.multiply(l);
        renderer.resetState();
        renderer.render(scene, camera);
      },
    };
  }

  // Flat 2D fallback marker — used only if MapLibre GL, Three.js, or the
  // model itself fail to load, so the card degrades to a plain live map
  // instead of staying blank.
  function buildFlatMarkerEl() {
    const el = document.createElement("div");
    el.style.cssText =
      "width:26px;height:26px;border-radius:50%;background:#ff9d2e;" +
      "box-shadow:0 0 0 4px rgba(255,157,46,0.28), 0 0 14px rgba(255,157,46,0.85);" +
      "border:2px solid #1a0f05;";
    return el;
  }

  // Best-effort dark theming pass: recolors any road (OpenMapTiles schema
  // uses source-layer "transportation") into a glowing orange, plus a
  // wider blurred duplicate underneath for the glow itself. dark-matter is
  // already dark, so this only needs to add the accent color — wrapped
  // defensively since a base style could change its layer schema at any
  // time and this must never break map init if it does.
  function applyOrangeGlowRoads(map) {
    try {
      const layers = map.getStyle().layers || [];
      const roadLayers = layers.filter((l) => l.type === "line" && l["source-layer"] === "transportation");
      roadLayers.forEach((layer) => {
        try {
          map.setPaintProperty(layer.id, "line-color", GLOW_ORANGE_CORE);
          map.setPaintProperty(layer.id, "line-opacity", 0.95);
        } catch (e) {}
      });
      // Insert one shared blurred glow layer just beneath the first real
      // road layer, reusing the same source/source-layer/filter so it
      // lines up with the roads it's glowing without touching each one
      // individually.
      if (roadLayers.length) {
        const first = roadLayers[0];
        map.addLayer(
          {
            id: "cc3d-road-glow",
            type: "line",
            source: first.source,
            "source-layer": first["source-layer"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": GLOW_ORANGE, "line-width": 6, "line-opacity": 0.35, "line-blur": 4 },
          },
          first.id
        );
      }
    } catch (e) {
      console.warn("Chase cam road glow theming skipped", e);
    }
  }

  // Only used when the CARTO dark-matter style failed and OpenFreeMap's
  // "liberty" (a light style) is standing in for it — recolors ground/
  // water so the fallback still reads as this card's always-dark panel
  // instead of a jarring light map with orange roads glowing on it.
  // Mirrors js/ride-detail.js's applyGrassGround() technique.
  function applyDarkGround(map) {
    const GROUND = "#0c0f14";
    const WATER = "#070a10";
    try {
      const layers = map.getStyle().layers || [];
      layers.forEach((layer) => {
        try {
          if (layer.type === "background") {
            map.setPaintProperty(layer.id, "background-color", GROUND);
          } else if (layer.type === "fill" && ["landcover", "landuse"].includes(layer["source-layer"])) {
            map.setPaintProperty(layer.id, "fill-color", GROUND);
          } else if (layer.type === "fill" && layer["source-layer"] === "water") {
            map.setPaintProperty(layer.id, "fill-color", WATER);
          }
        } catch (e) {}
      });
    } catch (e) {
      console.warn("Chase cam dark-ground fallback theming skipped", e);
    }
  }

  // Tries each style URL in order, actually fetching the JSON (rather
  // than handing MapLibre a bare URL and hoping) so a slow/blocked host
  // fails over to the next candidate on a short, predictable timeout
  // instead of MapLibre's own "error" event arriving whenever the
  // underlying TCP connection finally gives up (23s+ on the report that
  // prompted this). Returns the parsed style object plus which index
  // won, so the caller knows whether to apply the dark-ground reskin.
  async function resolveStyle() {
    let lastErr;
    for (let i = 0; i < STYLE_URLS.length; i++) {
      try {
        const json = await withTimeout(
          fetch(STYLE_URLS[i], { cache: "force-cache" }).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          }),
          8000,
          `style fetch timed out: ${STYLE_URLS[i]}`
        );
        debugLog(`style loaded: ${STYLE_URLS[i]}`);
        return { styleJson: json, index: i };
      } catch (err) {
        debugLog(`style failed (${err && err.message}): ${STYLE_URLS[i]}`);
        lastErr = err;
      }
    }
    debugLog(`all remote basemap styles failed (${(lastErr && lastErr.message) || lastErr}) — using local offline fallback so the chase cam can still run`);
    return { styleJson: LOCAL_FALLBACK_STYLE, index: STYLE_URLS.length };
  }

  function applyDarkFog(map) {
    map.setSky({
      "sky-color": "#05070c",
      "sky-horizon-blend": 0.4,
      "horizon-color": "#140b05",
      "horizon-fog-blend": 0.55,
      "fog-color": "#03040a",
      "fog-ground-blend": 0.9,
    });
  }

  // ---------- one chase-cam instance per container ----------
  function initChaseCam(mapEl, statusEl, hudEls, debugMount) {
    if (activeDebugConsole) activeDebugConsole.destroy();
    activeDebugConsole =
      typeof RydRDebugConsole !== "undefined"
        ? RydRDebugConsole.create({ id: "chase-cam-3d", title: "3D Chase Cam Debug", mount: debugMount })
        : null;
    let destroyed = false;
    let map = null;
    let bikeLayer = null;
    let flatMarker = null;
    let unsubscribeGeo = null;
    let rafId = null;

    let tweenFrom = null; // { lngLat:[lng,lat], heading }
    let tweenTo = null;
    let tweenStart = 0;
    let lastFixLngLat = null;
    let followCam = true;
    let hasFramedChase = false; // forces the CHASE_ZOOM/CHASE_PITCH frame once, the first time a real GPS fix arrives

    function setStatus(text, opts) {
      if (!statusEl) return;
      statusEl.innerHTML = "";
      if (!text) {
        statusEl.style.display = "none";
        return;
      }
      statusEl.style.display = "flex";
      const msg = document.createElement("div");
      msg.textContent = text;
      statusEl.appendChild(msg);
      if (opts && typeof opts.retry === "function") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cc3d-status-retry";
        btn.textContent = "Retry";
        btn.onclick = opts.retry;
        statusEl.appendChild(btn);
      }
    }

    function setGpsChip(text) {
      const chip = hudEls && hudEls.gps;
      if (!chip) return;
      chip.textContent = text || "";
      chip.style.display = text ? "" : "none";
    }

    function updateHud(fix) {
      if (!hudEls) return;
      if (hudEls.speed) {
        const mph = fix && typeof fix.speedMps === "number" ? Math.max(0, fix.speedMps * 2.2369) : 0;
        hudEls.speed.textContent = `${Math.round(mph)} MPH`;
      }
      if (hudEls.heading) {
        const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
        const h = fix && typeof fix.heading === "number" ? fix.heading : null;
        hudEls.heading.textContent = h == null ? "—" : dirs[Math.round(h / 45) % 8];
      }
    }

    function pushTrailPoint(lngLat) {
      if (!map || !map.getSource("cc3d-trail")) return;
      const src = map.getSource("cc3d-trail");
      const data = src._cc3dData || { type: "Feature", geometry: { type: "LineString", coordinates: [] } };
      data.geometry.coordinates.push(lngLat);
      if (data.geometry.coordinates.length > TRAIL_MAX_POINTS) {
        data.geometry.coordinates.splice(0, data.geometry.coordinates.length - TRAIL_MAX_POINTS);
      }
      src._cc3dData = data;
      src.setData(data);
    }

    function applyFrame(lngLat, headingDeg) {
      if (flatMarker) {
        flatMarker.setLngLat(lngLat);
      }
      if (map && followCam) {
        const zoom = hasFramedChase ? map.getZoom() : CHASE_ZOOM;
        // padding.top = 2*F*H - H (H = container height) is what solves
        // "render the given center at fraction F down the screen" — see
        // CHASE_FOCUS_FRACTION above. Reads container height every frame
        // rather than caching it since it's a plain layout property (no
        // pending DOM writes to invalidate against) and this already runs
        // inside a requestAnimationFrame loop, not on a hot non-rAF path.
        const containerH = map.getContainer().clientHeight || 0;
        const paddingTop = Math.max(0, containerH * (2 * CHASE_FOCUS_FRACTION - 1));
        map.jumpTo({ center: lngLat, bearing: headingDeg, pitch: CHASE_PITCH, zoom, padding: { top: paddingTop, bottom: 0, left: 0, right: 0 } });
        hasFramedChase = true;
      }
      // Both can be live at once during the interim-marker window below —
      // bikeLayer.render() is already a no-op until its model is ready, so
      // keeping its coords in sync the whole time means it appears already
      // in the right place the instant it flips ready, instead of jumping.
      if (bikeLayer) {
        // The map has real 3D terrain applied (map.setTerrain, exaggerated
        // 1.3x) — on actual mountain roads the ground sits tens to
        // hundreds of meters above sea level, so leaving the model's
        // altitude at a flat 0 placed it far *below* the rendered terrain
        // surface, fully occluded by it. queryTerrainElevation reads the
        // real elevation under the rider's current position from whatever
        // terrain tiles are already loaded, so the model sits at ground
        // level instead. Falls back to 0 if terrain isn't loaded/ready
        // yet for this spot (matches the previous, always-0 behavior).
        let alt = 0;
        if (map && typeof map.queryTerrainElevation === "function") {
          try {
            const elev = map.queryTerrainElevation(lngLat);
            if (typeof elev === "number" && !isNaN(elev)) alt = elev;
          } catch (e) {}
        }
        bikeLayer.setCoords([lngLat[0], lngLat[1], alt]);
        // Feed the model the real compass heading directly, not a delta
        // relative to the camera's current bearing. That residual-delta
        // approach (previously used here) only kept the model looking
        // "forward" on screen for one specific compass direction — a
        // world-fixed-orientation model's *apparent* screen direction
        // necessarily shifts as the camera's own bearing rotates the
        // whole view, so with the model rotation always ~0 (delta≈0 in
        // steady state), it only coincidentally lined up with up-screen
        // for one heading. Rotating the model by the raw heading doesn't
        // "double-count" the camera's own bearing rotation — verified
        // directly by rendering the model with camera bearing tracking
        // heading (0°/90°/180°, matching this card's real followCam
        // behavior) and confirming it stayed facing up-screen at every
        // one of them, not just when both happened to agree.
        bikeLayer.setRotation({ x: 0, y: 0, z: headingDeg });
      }
      if (map) map.triggerRepaint();
    }

    function tick(now) {
      if (destroyed) return;
      if (tweenFrom && tweenTo) {
        const t = Math.min(1, (now - tweenStart) / TWEEN_MS);
        const lng = lerp(tweenFrom.lngLat[0], tweenTo.lngLat[0], t);
        const lat = lerp(tweenFrom.lngLat[1], tweenTo.lngLat[1], t);
        const heading = lerpAngle(tweenFrom.heading, tweenTo.heading, t);
        applyFrame([lng, lat], heading);
        if (t >= 1) tweenFrom = { lngLat: tweenTo.lngLat, heading: tweenTo.heading };
      }
      rafId = requestAnimationFrame(tick);
    }

    function onFix(fix) {
      if (!fix || typeof fix.lat !== "number" || typeof fix.lng !== "number") return;
      if (!document.body.contains(mapEl)) {
        destroy();
        return;
      }
      const lngLat = [fix.lng, fix.lat];
      const prevLngLat = lastFixLngLat;
      lastFixLngLat = lngLat;
      updateHud(fix);
      pushTrailPoint(lngLat);

      const fromHeading = tweenTo ? tweenTo.heading : typeof fix.heading === "number" ? fix.heading : 0;
      let heading = typeof fix.heading === "number" && fix.heading != null ? fix.heading : fromHeading;
      const movedMeaningfully = prevLngLat && (Math.abs(lngLat[0] - prevLngLat[0]) + Math.abs(lngLat[1] - prevLngLat[1])) > 0.00002; // ~2m
      if ((fix.heading == null || fix.speedMps < 0.5) && movedMeaningfully) {
        // Devices often stop reporting heading below walking speed — fall
        // back to the bearing between the last two fixes so the model
        // doesn't snap to 0 the instant the rider slows down. Skipped for
        // a near-identical fix so a parked bike doesn't jitter/spin on GPS
        // noise alone.
        heading = getBearing(prevLngLat, lngLat);
      }

      const currentRendered = tweenTo || { lngLat: prevLngLat || lngLat, heading };
      tweenFrom = { lngLat: currentRendered.lngLat, heading: currentRendered.heading };
      tweenTo = { lngLat, heading };
      tweenStart = performance.now();

      setGpsChip(null);
    }

    let loadTimeoutId = null;
    let resizeObserver = null;
    let retryCount = 0;

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (unsubscribeGeo) unsubscribeGeo();
      if (loadTimeoutId) clearTimeout(loadTimeoutId);
      if (resizeObserver) resizeObserver.disconnect();
      if (map) {
        try {
          map.remove();
        } catch (e) {}
      }
      // Otherwise this outlives the container it was mounted in — its DOM
      // gets wiped by the collapse back to the placeholder either way, but
      // the rydr-debug-enabled-changed listener it registers on `document`
      // itself doesn't go away on its own.
      if (activeDebugConsole) {
        activeDebugConsole.destroy();
        activeDebugConsole = null;
      }
    }

    // Tears down whatever the previous attempt got partway through (a map
    // instance stuck loading tiles, a stale resize observer, an in-flight
    // GPS subscription) so Retry starts completely clean instead of piling
    // a second map on top of the first.
    function resetForRetry() {
      if (loadTimeoutId) clearTimeout(loadTimeoutId);
      if (resizeObserver) resizeObserver.disconnect();
      if (unsubscribeGeo) unsubscribeGeo();
      unsubscribeGeo = null;
      if (map) {
        try {
          map.remove();
        } catch (e) {}
      }
      map = null;
      bikeLayer = null;
      flatMarker = null;
      hasFramedChase = false;
      retryCount++;
    }

    function attemptLoad() {
      setStatus(retryCount ? "Retrying live 3D map…" : "Loading live 3D map…");
      debugLog(retryCount ? `retry #${retryCount} starting` : "attemptLoad starting");

      let styleStageFailed = false;
      withTimeout(ensureMapLibre(), 12000, "MapLibre GL timed out loading")
        .then(() => {
          if (destroyed) return null;
          debugLog("MapLibre script ready, resolving base map style");
          styleStageFailed = true; // flipped back below once resolveStyle() actually succeeds
          return resolveStyle();
        })
        .then((resolved) => {
          if (destroyed || !resolved) return;
          styleStageFailed = false;
          const { styleJson, index: styleIndex } = resolved;
          debugLog("constructing map");
          const startAt = (RydRGeo && RydRGeo.getLast()) || null;
          const center = startAt ? [startAt.lng, startAt.lat] : DEFAULT_CENTER;
          debugLog(`start position: ${startAt ? "real GPS fix" : "fallback (no GPS yet)"} ${center[1].toFixed(3)},${center[0].toFixed(3)}`);

          map = new maplibregl.Map({
            container: mapEl,
            style: styleJson,
            center,
            zoom: startAt ? CHASE_ZOOM : 12,
            pitch: startAt ? CHASE_PITCH : 0,
            bearing: 0,
            antialias: true,
            attributionControl: false,
          });

          map.on("dragstart", () => {
            followCam = false;
          });

          // The card's resize grip scales .cc3d-map-wrap's height via
          // --plugin-scale (see CSS) — MapLibre needs an explicit resize()
          // call whenever its container's actual pixel size changes, or the
          // canvas stays whatever size it was created at instead of filling
          // the new box.
          if ("ResizeObserver" in window) {
            resizeObserver = new ResizeObserver(() => map && map.resize());
            resizeObserver.observe(mapEl);
          }

          let loaded = false;

          // The style/tile fetches that follow a successful MapLibre GL
          // script load are a separate, unguarded network round-trip — on
          // a spotty cell connection (the expected environment for a
          // motorcycle app) they can hang well past any reasonable wait
          // without MapLibre ever firing "error". Surface that as a
          // retryable failure instead of leaving the loading spinner up
          // indefinitely.
          loadTimeoutId = setTimeout(() => {
            if (destroyed || loaded) return;
            setStatus("3D map is taking too long to load — check your connection.", { retry: retry });
          }, 15000);

          map.on("load", () => {
            if (destroyed) return;
            loaded = true;
            if (loadTimeoutId) clearTimeout(loadTimeoutId);
            const canvas = map.getCanvas();
            debugLog(`load fired — canvas ${canvas.width}x${canvas.height}, container ${mapEl.clientWidth}x${mapEl.clientHeight}`);

            // Only resize if the container currently measures something
            // real. A live report showed the canvas already correctly
            // sized (889x836) at this exact point while the container
            // read 319x0 — the dashboard was very likely mid-navigation
            // (a full-screen view toggling #layoutRoot to display:none
            // collapses every descendant, chase-cam included, to 0 height
            // for layout purposes) right as this async load resolved.
            // Calling resize() unconditionally there would have *forced*
            // the already-working canvas down to match that transient 0,
            // actively breaking it instead of fixing anything — worse
            // than doing nothing. The ResizeObserver below still catches
            // the real size once the container becomes visible/settled.
            if (mapEl.clientWidth > 0 && mapEl.clientHeight > 0) {
              try {
                map.resize();
              } catch (e) {}
            } else {
              debugLog("skipped resize — container has no size right now, waiting for ResizeObserver");
            }

            try {
              map.addSource("cc3d-terrain", {
                type: "raster-dem",
                tiles: [TERRAIN_TILES],
                encoding: "terrarium",
                tileSize: 256,
                maxzoom: 15,
              });
              map.setTerrain({ source: "cc3d-terrain", exaggeration: 1.3 });
            } catch (e) {}

            try {
              applyDarkFog(map);
            } catch (e) {
              console.warn("Chase cam sky/fog setup skipped", e);
            }
            if (styleIndex > 0) {
              debugLog(`using fallback style #${styleIndex} — applying dark-ground reskin`);
              applyDarkGround(map);
            }
            applyOrangeGlowRoads(map);

            map.addSource("cc3d-trail", {
              type: "geojson",
              data: { type: "Feature", geometry: { type: "LineString", coordinates: [] } },
            });
            map.addLayer({
              id: "cc3d-trail-glow",
              type: "line",
              source: "cc3d-trail",
              layout: { "line-cap": "round", "line-join": "round" },
              paint: { "line-color": GLOW_ORANGE, "line-width": 14, "line-opacity": 0.25, "line-blur": 4 },
            });
            map.addLayer({
              id: "cc3d-trail-core",
              type: "line",
              source: "cc3d-trail",
              layout: { "line-cap": "round", "line-join": "round" },
              paint: { "line-color": GLOW_ORANGE_CORE, "line-width": 3, "line-opacity": 0.95 },
            });

            bikeLayer = createBikeModelLayer(() => {
              // Model finished loading (possibly well after the interim
              // marker below appeared) — swap back to the real 3D bike.
              if (flatMarker) {
                flatMarker.remove();
                flatMarker = null;
              }
            });
            map.addLayer(bikeLayer);
            // The model is a ~10MB Draco-compressed glTF, on top of
            // Three.js + GLTFLoader + DRACOLoader + the Draco WASM decoder
            // itself — on a real (non-wifi) mobile connection that can
            // easily take well past a few seconds, especially on first
            // load with nothing cached. This used to *discard* the loading
            // layer at 6s and permanently show a flat 2D dot instead, so
            // any load slower than 6s meant the 3D model would finish
            // loading into a layer that had already been torn down and
            // never appear at all. Now it's purely a placeholder shown
            // while still waiting — removed via the onReady callback above
            // the moment the real model is actually ready, however long
            // that takes.
            setTimeout(() => {
              if (!destroyed && bikeLayer && !bikeLayer.isReady() && !flatMarker) {
                flatMarker = new maplibregl.Marker({ element: buildFlatMarkerEl() }).setLngLat(lastFixLngLat || center).addTo(map);
              }
            }, 6000);

            // Clear the full-screen loading overlay now that the map itself
            // is up — "no GPS fix yet" is a small non-blocking HUD chip from
            // here on, not a black screen, so a GPS delay/failure never
            // looks like the whole card is stuck.
            setStatus("");
            setGpsChip(startAt ? null : "GPS: searching…");
            if (startAt) applyFrame(center, startAt.heading || 0);
          });

          map.on("error", (e) => {
            debugLog(`map error (source: ${(e && e.sourceId) || "?"}): ${(e && e.error && e.error.message) || e}`);
            // MapLibre also fires "error" for routine transient stuff (a
            // single failed tile request, etc.) — only treat it as fatal if
            // the map never even finished its initial style load.
            if (!loaded) {
              if (loadTimeoutId) clearTimeout(loadTimeoutId);
              setStatus("Map style failed to load — check your connection.", { retry: retry });
            }
          });

          unsubscribeGeo = RydRGeo ? RydRGeo.subscribe(onFix) : null;
          rafId = requestAnimationFrame(tick);

          // No real GPS/network location has ever come in on this device
          // yet (or it's the very first launch) — actively ask for a
          // network-based fix instead of just waiting on watchPosition,
          // same fallback js/maps-nav.js uses for its own live map.
          setTimeout(() => {
            if (!destroyed && !lastFixLngLat && RydRGeo && typeof RydRGeo.fetchNetworkLocation === "function") {
              RydRGeo.fetchNetworkLocation().catch(() => {});
            }
          }, 6000);
        })
        .catch((err) => {
          console.warn("Chase cam map failed to initialize", err);
          const message = styleStageFailed
            ? "3D chase cam unavailable — map style failed to load (check your connection)."
            : "3D chase cam unavailable — MapLibre failed to load (check your connection).";
          setStatus(message, { retry: retry });
        });
    }

    function retry() {
      if (destroyed) return;
      resetForRetry();
      attemptLoad();
    }

    attemptLoad();

    const recenterBtn = hudEls && hudEls.recenterBtn;
    if (recenterBtn) {
      recenterBtn.onclick = () => {
        followCam = true;
        if (map && lastFixLngLat) {
          const containerH = map.getContainer().clientHeight || 0;
          const paddingTop = Math.max(0, containerH * (2 * CHASE_FOCUS_FRACTION - 1));
          map.easeTo({ center: lastFixLngLat, pitch: CHASE_PITCH, zoom: CHASE_ZOOM, padding: { top: paddingTop, bottom: 0, left: 0, right: 0 }, duration: 500 });
        }
      };
    }

    return { destroy };
  }

  // MapLibre + Three.js + a live WebGL context + a continuous GPS
  // subscription is by far the heaviest thing running on the dashboard —
  // unlike every other card here, it doesn't idle cheaply in the
  // background. On the dashboard specifically (not the dedicated
  // chase-map.html page, which wants it live immediately — see autoStart
  // below) it starts collapsed: nothing loaded, nothing rendering, until a
  // rider explicitly taps to open it, and it tears itself all the way back
  // down — cancels its GPS subscription, its render loop, and calls
  // MapLibre's own map.remove() to release the WebGL context — the moment
  // the dashboard stops being the visible view, not just when it scrolls
  // out of sight. initChaseCam()'s existing destroy() (see above) already
  // did all of that; it just never had a caller.
  let dashboardCardEl = null;
  let dashboardHandle = null;

  function renderCollapsed(container) {
    container.innerHTML = `
      <div class="plugin-surface cc3d-surface cc3d-collapsed">
        <div class="cc3d-collapsed-icon" aria-hidden="true">🎥</div>
        <p class="cc3d-collapsed-desc">Live 3D chase camera — starts a real-time MapLibre + WebGL view following your GPS position. Loads nothing until opened, and shuts back down the moment you leave this view.</p>
        <button type="button" class="cc3d-status-retry cc3d-open-btn">Open 3D Chase Cam</button>
      </div>
    `;
    container.querySelector(".cc3d-open-btn")?.addEventListener("click", () => openLive(container));
  }

  function openLive(container) {
    container.innerHTML = `
      <div class="plugin-surface cc3d-surface">
        <div class="cc3d-map-wrap">
          <div class="cc3d-map"></div>
          <div class="cc3d-fade-overlay" aria-hidden="true"></div>
          <div class="cc3d-glow-ring" aria-hidden="true"></div>
          <div class="cc3d-status"></div>
          <div class="cc3d-hud">
            <span class="cc3d-hud-chip cc3d-hud-speed">0 MPH</span>
            <span class="cc3d-hud-chip cc3d-hud-heading">—</span>
            <span class="cc3d-hud-chip cc3d-hud-gps" style="display:none;"></span>
          </div>
          <button class="cc3d-recenter-btn" type="button" aria-label="Recenter chase camera">⌖</button>
          <button class="cc3d-close-btn" type="button" aria-label="Close 3D Chase Cam">✕</button>
        </div>
        <div class="cc3d-debug-mount"></div>
      </div>
    `;

    const mapEl = container.querySelector(".cc3d-map");
    const statusEl = container.querySelector(".cc3d-status");
    const debugMount = container.querySelector(".cc3d-debug-mount");
    const hudEls = {
      speed: container.querySelector(".cc3d-hud-speed"),
      heading: container.querySelector(".cc3d-hud-heading"),
      gps: container.querySelector(".cc3d-hud-gps"),
      recenterBtn: container.querySelector(".cc3d-recenter-btn"),
    };

    dashboardCardEl = container;
    dashboardHandle = initChaseCam(mapEl, statusEl, hudEls, debugMount);
    container.querySelector(".cc3d-close-btn")?.addEventListener("click", () => closeLive(container));
  }

  function closeLive(container) {
    if (dashboardHandle) dashboardHandle.destroy();
    dashboardHandle = null;
    dashboardCardEl = null;
    renderCollapsed(container);
  }

  // Fired by js/dashboard.js whenever the dashboard grid stops being the
  // visible view (Track HUD, Apex Performance, the screensaver) — a plain
  // CSS display:none on the card's ancestor stops it painting but does
  // nothing to stop its GPS subscription, render loop, or WebGL context
  // still running underneath. Registered once at module load, not
  // per-render, so it survives the card being torn down and reopened.
  document.addEventListener("rydr-dashboard-hidden", () => {
    if (dashboardHandle && dashboardCardEl) closeLive(dashboardCardEl);
  });

  function renderChaseCam(container, opts) {
    if (container.dataset.cc3dInit === "1") return; // already running — renderAll() ticks every 2s
    container.dataset.cc3dInit = "1";

    if (opts && opts.autoStart) {
      openLive(container);
    } else {
      renderCollapsed(container);
    }
  }

  const plugin = {
    id: "chase-cam-3d",
    name: "3D Chase Cam",
    description: "A live MapLibre + 3D bike chase camera that follows your real GPS position on a tilted dark map with a glowing orange trail.",
    version: "1.0.0",
    icon: "🎥",
    category: "navigation",
    render: function (container, payload) {
      // The dashboard's plugin system calls render(body, { plugin,
      // telemetry }) on every card; chase-map.js calls render(host,
      // { autoStart: true }) for the dedicated full-page view. Only the
      // latter should skip the collapsed placeholder.
      renderChaseCam(container, { autoStart: !!(payload && payload.autoStart) });
    },
  };

  const runtimeKey = "__RydRPluginRuntime__";
  root[runtimeKey] = root[runtimeKey] || {};
  root[runtimeKey][plugin.id] = plugin;
})(window);
