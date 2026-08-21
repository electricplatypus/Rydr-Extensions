// Hourly Precipitation — a standalone dashboard plugin (see the
// rydr-plugin-development skill's "Standalone Widgets" section) showing
// an animated hour-by-hour chance-of-rain bar chart, with a full-bleed
// background that shows CURRENT conditions at the rider's location — sun
// (by day) / moon (by night, cross-fading at dawn/dusk) / cloud / rain —
// classified from the same RydRWeather.current() read that drives the
// .hp-cur-cond text readout, refreshed every 15 minutes (see
// CUR_COND_THROTTLE_MS).
//
// The sun/moon layer is real solar-time-aware: RydRWeather.current()'s
// `sys.sunrise`/`sys.sunset` (UNIX seconds) are turned into an actual
// current sky position (see sunMoonState() below) — low near the
// horizon at rise/set, peaking mid-arc — recomputed on every refresh so
// it visibly advances across the sky over the course of the day, plus a
// small always-looping CSS drift/pulse on top of that real anchor so it
// visibly "moves" moment to moment too, not just once per 15 minutes.
// Clouds get a real right-to-left cross-screen drift (five staggered
// puffs, CSS `@keyframes`, looping forever). On "cloud" (partly cloudy),
// the sun/moon system stays visible underneath — it's only fully hidden
// for "rain" — with the clouds passing in front of it (see the z-index
// note on .hp-bg-sun-layer/.hp-bg-cloud-layer in css/style.css). Rain is
// unchanged — see hp-rainfall below for why that one's especially
// delicate.
//
// Every layer is still driven purely by CSS `@keyframes` for its
// continuous motion (hp-sun-drift/hp-moon-drift/hp-cloud-cross/
// hp-rainfall in css/style.css) — this JS only computes real anchor
// values (position, cross-fade amount) once per setData() (a 15-minute
// refresh or an actual condition change) via layout(el, data); it never
// drives per-frame motion itself. That split matters for a reason that
// bit this exact file once already: a CSS animation's own keyframe
// values for a property always win over a separately-computed value for
// that same property while it's running (see hp-rainfall's comment for
// the bug that shipped from getting this wrong) — so every keyframe
// below only ever animates `transform`, and real-vs-decorative position
// are combined by having the *static* (JS-set) position live on
// `left`/`top` while the *looping* drift lives entirely in `transform`,
// never touching the same CSS property twice.
//
// This plugin went through several earlier, more elaborate background
// designs this same session — an all-hours-at-once static blend, a
// 25-second timed sweep across the hourly forecast, then (immediately
// before this one) a version with no motion or day/night awareness at
// all — see `git log -p -- plugins/hourly-precip/hourly-precip.js` if
// any of that history is ever useful again.
//
// Built on top of the reusable js/bg-animator.js library (RydRBgAnimator)
// — see that file's header and skills/rydr-plugin-development/SKILL.md's
// "Reusable Decorative Backgrounds" section. Every layer still only uses
// the library's layout(el, data) hook (called once whenever setData()
// runs); none of them use the library's tick(progress) wall-clock loop —
// the continuous sun/moon/cloud motion is 100% CSS `@keyframes`, not a
// JS-driven per-frame loop. Extracted from the Current Conditions card's
// original precip drawer (js/dashboard.js) into its own first-class,
// standalone, configurable widget.
(function (root) {
  const SETTINGS_KEY = "rydr_hourly_precip_settings";
  const DEFAULT_SETTINGS = { hours: 8, animBg: true, animOpacity: 0.35 };
  // RydRWeather's own cache (js/weather.js) already holds an hourly
  // response for 5 minutes per rounded coordinate — asking more often
  // than that just re-reads that cache, so this throttle only exists to
  // skip the (cheap but pointless) repeat call+reclassify work on every
  // ~2s dashboard render tick, not to protect the network.
  const FETCH_THROTTLE_MS = 5 * 60 * 1000;
  // Drives BOTH the top-right "current conditions" text readout AND the
  // background's active condition (see classifyCondition()/render()
  // below) — it doesn't need to track GPS ticks like the chart does, so
  // it gets its own, much longer throttle window. The user's own spec:
  // refresh every 15 minutes. Comfortably outside RydRWeather's own
  // 5-minute per-coordinate cache window, so a throttled re-check still
  // usually gets a fresh read rather than just replaying that cache.
  const CUR_COND_THROTTLE_MS = 15 * 60 * 1000;
  // Fixed rain-drop pool for the background's rain layer — see rainLayer
  // below. Every drop shares the SAME on/off state (the single active
  // condition, set once per 15-minute refresh) as a CSS custom property
  // on their shared parent, inherited down to each `.hp-drop` span — this
  // is what makes rain read as one ambient condition covering the whole
  // card, not a patchwork of independently-lit drops.
  const RAIN_DROP_COUNT = 48;

  // Neither the IP-lookup fetch nor RydRWeather's own fetch carries a
  // timeout — a normal rejection (offline, DNS failure, CORS) surfaces
  // fine, but some restrictive networks/firewalls silently drop a
  // filtered request instead of rejecting it, which just hangs forever.
  // Without a hard timeout here, that leaves `state.fetching` (or the
  // in-flight IP-lookup promise) stuck permanently, and every future
  // render() tick sees the in-flight guard and skips straight past
  // without ever calling showStatus() or renderChart() again — the card
  // just sits on its empty initial skeleton forever with no bars, no
  // error, nothing. This is the actual "bars never load, no error either"
  // failure mode a location/network fix alone can't close.
  const TIMEOUT_MS = 12000;
  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label || "operation"} timed out after ${ms}ms`)), ms);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }

  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const p = raw ? JSON.parse(raw) : {};
      return {
        hours: [6, 8, 12].includes(Number(p.hours)) ? Number(p.hours) : DEFAULT_SETTINGS.hours,
        animBg: p.animBg !== false,
        animOpacity: typeof p.animOpacity === "number" && Number.isFinite(p.animOpacity) ? Math.min(1, Math.max(0, p.animOpacity)) : DEFAULT_SETTINGS.animOpacity,
      };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  }
  function saveSettings(next) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }

  // Same 3-tier fallback js/dashboard.js's own location resolution uses
  // (GPS -> network/IP lookup -> saved default) — a first version of this
  // only checked live GPS and a saved default, so on a device with GPS
  // denied/unavailable and no default location ever set in Settings, the
  // chart had no way to ever get coordinates at all and just sat on
  // "Waiting on your location…" forever, which is what "bars aren't
  // loading" almost certainly was. dashboard.js's own IP-lookup result
  // lives in a module-private variable with no public accessor, so this
  // does its own lookup via the same public RydRLocation.ipLookup() it
  // uses internally, rather than depending on dashboard.js's state.
  let cachedIpLocation = null;
  let ipLookupInFlight = null;
  async function resolveLatLng() {
    const fix = typeof RydRGeo !== "undefined" ? RydRGeo.getLast() : null;
    if (fix && typeof fix.lat === "number" && typeof fix.lng === "number") return { lat: fix.lat, lng: fix.lng };
    const def = typeof RydRLocation !== "undefined" ? RydRLocation.getDefaultLocation() : null;
    if (def && typeof def.lat === "number" && typeof def.lng === "number") return { lat: def.lat, lng: def.lng };
    if (cachedIpLocation) return cachedIpLocation;
    if (typeof RydRLocation === "undefined" || typeof RydRLocation.ipLookup !== "function") return null;
    if (!ipLookupInFlight) ipLookupInFlight = withTimeout(RydRLocation.ipLookup(), TIMEOUT_MS, "IP lookup").catch(() => null);
    const ip = await ipLookupInFlight;
    ipLookupInFlight = null;
    if (ip && typeof ip.lat === "number" && typeof ip.lng === "number") {
      cachedIpLocation = { lat: ip.lat, lng: ip.lng };
      return cachedIpLocation;
    }
    return null;
  }

  // ---------- continuous weather-timeline math ----------
  // OpenWeather condition id -> one of exactly three background states.
  // Thunderstorm/drizzle/rain/snow (id < 800) all read as "rain" — this
  // plugin only has three built visual states, and any of those means
  // "something's falling right now." Atmosphere codes (mist/fog/haze,
  // 701-781) read as "cloud" — there's no rain animation to show for
  // those, and visually an overcast/hazy sky is a closer match than
  // sunny. 800/801 (clear/mostly clear) read as "sun"; 802-804 (broken/
  // scattered/overcast clouds) and anything else unrecognized read as
  // "cloud".
  function classifyCondition(w) {
    const id = w?.weather?.[0]?.id;
    if (typeof id !== "number") return null;
    if (id === 800 || id === 801) return "sun";
    if (id < 800) return "rain";
    return "cloud";
  }

  // ---------- sun/moon solar-time math ----------
  // "Condition sun" (800/801, clear sky) is what the sun/moon system as a
  // whole represents — MOON is a time-of-day variant of that same clear-
  // sky condition, not a fourth top-level background state. The sky
  // layer's background tint (see skyLayer/isNightTime below) darkens for
  // ALL three conditions at night, not just sun/moon — a rainy or cloudy
  // night still reads as night, not a daytime-bright card.
  const SECONDS_PER_DAY = 86400;
  // How wide the dawn/dusk cross-fade window is, centered on the actual
  // sunrise/sunset instant — 24 minutes each side felt right in testing:
  // wide enough to read as a real transition (not a snap), narrow enough
  // that "day"/"night" still dominate the vast majority of the day.
  const TWILIGHT_WINDOW_SEC = 24 * 60;
  const clamp01 = (n) => Math.max(0, Math.min(1, n));

  // Low near the horizon at the start/end of its arc (progress 0 or 1),
  // peaking mid-arc (solar noon for the sun, the middle of the night for
  // the moon) — same arc shape this file used for its earlier left-to-
  // right sweep design (see git history, `yPct = 62 - 42 * Math.sin(...)`),
  // reused here for BOTH the sun's day-progress and the moon's night-
  // progress since the "rises low, arcs high, sets low" shape is the same
  // physical phenomenon either way.
  function arcPosition(progress) {
    return { x: progress * 100, y: 62 - 42 * Math.sin(progress * Math.PI) };
  }

  // Simple day/night boolean (no twilight cross-fade — that's sunMoonState's
  // job for the sun/moon layer itself) for tinting the sky background dark
  // at night regardless of which condition (sun/cloud/rain) is active. No
  // usable sun times yet falls back to "day", matching sunMoonState's own
  // fallback above.
  function isNightTime(sunrise, sunset, nowSec) {
    if (typeof sunrise !== "number" || typeof sunset !== "number" || sunset <= sunrise) return false;
    return nowSec < sunrise || nowSec > sunset;
  }

  // Computes everything the sun/moon layer needs to draw the CURRENT real
  // sky, given one sunrise/sunset pair (UNIX seconds, as OpenWeather's
  // `/weather` response gives for TODAY only) and the current wall clock
  // (also UNIX seconds — both are absolute UTC instants, so no timezone
  // conversion is needed to compare them regardless of the rider's local
  // offset).
  //
  // Night position/progress needs a next-sunrise estimate OpenWeather
  // doesn't give us (it only covers today), so this approximates it as
  // "the same time of day as today's sunrise, 24 hours later" —
  // equivalently, tonight's day length stands in for tomorrow's. That
  // also has to handle the case where "now" is already past midnight,
  // local-date-wise, but still before *today's* sunrise — i.e. the tail
  // end of *last* night, not the start of a new one — by reaching back to
  // an approximated "yesterday's sunset" (today's sunset minus 24h) as
  // that stretch's actual start-of-night anchor, rather than treating a
  // negative/nonsensical progress as "just after today's (still future)
  // sunset."
  function sunMoonState(sunrise, sunset, nowSec) {
    const hasTimes = typeof sunrise === "number" && typeof sunset === "number" && sunset > sunrise;
    // No usable sun times yet (e.g. current-conditions hasn't loaded):
    // fall back to "full daytime, sun high-ish in the middle" rather than
    // drawing nothing — matches this layer's old always-on static look
    // until real data arrives.
    if (!hasTimes) {
      return { sunFade: 1, moonFade: 0, sun: { x: 60, y: 30 }, moon: { x: 60, y: 30 } };
    }
    const dayLen = sunset - sunrise;
    const nightLen = SECONDS_PER_DAY - dayLen;
    const dayProgress = clamp01((nowSec - sunrise) / dayLen);
    // The most recent sunset before `now`: today's, unless `now` is still
    // before today's sunrise, in which case it's tonight's *previous*
    // night — i.e. yesterday's (approximated) sunset.
    const effectiveSunset = nowSec < sunrise ? sunset - SECONDS_PER_DAY : sunset;
    const nightProgress = clamp01((nowSec - effectiveSunset) / (nightLen > 0 ? nightLen : SECONDS_PER_DAY / 2));

    // Cross-fade amount: 0 at the start of the window, 1 at the end.
    function windowT(center) {
      return clamp01((nowSec - (center - TWILIGHT_WINDOW_SEC)) / (TWILIGHT_WINDOW_SEC * 2));
    }
    let sunFade;
    let moonFade;
    if (Math.abs(nowSec - sunrise) <= TWILIGHT_WINDOW_SEC) {
      // Dawn: moon (still up) fading out as the sun fades in.
      const t = windowT(sunrise);
      sunFade = t;
      moonFade = 1 - t;
    } else if (Math.abs(nowSec - sunset) <= TWILIGHT_WINDOW_SEC) {
      // Dusk: sun fading out as the moon fades in — the direction the
      // user explicitly asked for.
      const t = windowT(sunset);
      sunFade = 1 - t;
      moonFade = t;
    } else if (nowSec > sunrise && nowSec < sunset) {
      sunFade = 1;
      moonFade = 0;
    } else {
      sunFade = 0;
      moonFade = 1;
    }
    return {
      sunFade,
      moonFade,
      sun: arcPosition(dayProgress),
      moon: arcPosition(nightProgress),
    };
  }

  // ---------- background layers (RydRBgAnimator consumers) ----------
  // Stacking order matches the design brief: sky (bottom) -> sun/moon ->
  // clouds -> rain falling in front of everything -> a bottom scrim for
  // text legibility (top). Exactly one of sun-or-moon/cloud/rain reads as
  // "on" at a time (data.condition), driven purely by layout(el, data) —
  // called once whenever setData() runs (every 15-minute current-
  // conditions refresh, see CUR_COND_THROTTLE_MS below), not on any per-
  // frame schedule. Each active layer's own continuous CSS @keyframes
  // (hp-sun-drift/hp-moon-drift/hp-cloud-cross/hp-rainfall — see
  // css/style.css) is what actually makes it "animated and loop,"
  // entirely on its own once --amt is set to 1; this JS never touches it
  // again until the next refresh (or a real condition/time-of-day change)
  // recomputes the real anchor values.
  const skyLayer = {
    id: "sky",
    build() {
      const el = document.createElement("div");
      el.className = "hp-bg-sky";
      return el;
    },
    layout(el, data) {
      const dayColors = { sun: "rgba(255,196,110,0.55)", cloud: "rgba(150,158,172,0.55)", rain: "rgba(92,108,138,0.55)" };
      // Dark tint for after sunset/before sunrise — "sun" here means the
      // moon is showing (see sunLayer above), so its night sky reads as
      // deep navy rather than daytime amber; cloud/rain get the same
      // darker treatment so a night ride doesn't show a daytime-bright card.
      const nightColors = { sun: "rgba(16,20,46,0.65)", cloud: "rgba(36,42,64,0.65)", rain: "rgba(20,26,50,0.65)" };
      const night = isNightTime(data?.sunrise, data?.sunset, Date.now() / 1000);
      const colors = night ? nightColors : dayColors;
      el.style.background = colors[data?.condition] || "none";
    },
  };

  // Sun AND moon live in one layer/element pair: "condition sun" (clear
  // sky) is what this whole system means, varying by time of day, not two
  // independent things. --amt (set on the shared parent, inherited by
  // both wraps) gates the whole system on/off with data.condition exactly
  // like before; --fade on each wrap (set individually below, from
  // sunMoonState()) is the dawn/dusk cross-fade amount, 0..1. Position
  // (left/top, the REAL time-of-day anchor) is set directly as inline
  // style on each wrap; the continuous "moving across the screen" drift
  // is 100% CSS `@keyframes` on `transform` only (see hp-sun-drift/
  // hp-moon-drift in css/style.css) — never the same property JS just
  // set, per the hp-rainfall lesson in this file's header comment.
  const sunLayer = {
    id: "sun",
    build() {
      const el = document.createElement("div");
      el.className = "hp-bg-sun-layer";
      const sunWrap = document.createElement("div");
      sunWrap.className = "hp-sun-wrap";
      sunWrap.innerHTML = `<div class="hp-sun-rays"></div><div class="hp-sun-core"></div>`;
      const moonWrap = document.createElement("div");
      moonWrap.className = "hp-moon-wrap";
      moonWrap.innerHTML = `<div class="hp-moon-glow"></div><div class="hp-moon-core"></div>`;
      el.appendChild(sunWrap);
      el.appendChild(moonWrap);
      return el;
    },
    layout(el, data) {
      // On for BOTH "sun" and "cloud" conditions now — "partly cloudy"
      // means the sun (or moon, at night) stays visible with clouds
      // drifting in front of it, not hidden outright the way it is for
      // "rain". See cloudLayer below (also on for "cloud") and the
      // z-index note on .hp-bg-sun-layer/.hp-bg-cloud-layer in
      // css/style.css for how the two stack correctly against each
      // other now that they can both be on screen at once.
      el.style.setProperty("--amt", data?.condition === "sun" || data?.condition === "cloud" ? "1" : "0");
      const nowSec = Date.now() / 1000;
      const state = sunMoonState(data?.sunrise, data?.sunset, nowSec);
      const sunWrap = el.querySelector(".hp-sun-wrap");
      const moonWrap = el.querySelector(".hp-moon-wrap");
      if (sunWrap) {
        sunWrap.style.left = `${state.sun.x}%`;
        sunWrap.style.top = `${state.sun.y}%`;
        sunWrap.style.setProperty("--fade", String(state.sunFade));
      }
      if (moonWrap) {
        moonWrap.style.left = `${state.moon.x}%`;
        moonWrap.style.top = `${state.moon.y}%`;
        moonWrap.style.setProperty("--fade", String(state.moonFade));
      }
    },
  };

  const cloudLayer = {
    id: "clouds",
    build() {
      const el = document.createElement("div");
      el.className = "hp-bg-cloud-layer";
      // A small fixed cluster of puffs (rest positions/cross-screen drift
      // timing set in CSS, staggered per blob) — only their shared --amt
      // (set below, inherited by every .hp-cloud-blob child) ever
      // changes.
      for (let i = 0; i < 5; i++) {
        const blob = document.createElement("div");
        blob.className = `hp-cloud-blob hp-cloud-blob-${i}`;
        el.appendChild(blob);
      }
      return el;
    },
    layout(el, data) {
      el.style.setProperty("--amt", data?.condition === "cloud" ? "1" : "0");
    },
  };

  const rainLayer = {
    id: "rain",
    build() {
      const el = document.createElement("div");
      el.className = "hp-bg-rain-layer";
      for (let i = 0; i < RAIN_DROP_COUNT; i++) {
        const drop = document.createElement("span");
        drop.className = "hp-drop";
        const xBase = (i / RAIN_DROP_COUNT) * 100;
        drop.style.left = `${Math.min(99, Math.max(1, xBase + (Math.random() * 2 - 1))).toFixed(1)}%`;
        drop.style.animationDelay = `${(Math.random() * 1.4).toFixed(2)}s`;
        drop.style.animationDuration = `${(0.85 + Math.random() * 0.5).toFixed(2)}s`;
        el.appendChild(drop);
      }
      return el;
    },
    layout(el, data) {
      // Set once on the shared parent, not per-drop — every `.hp-drop`
      // inherits this custom property, so all 48 drops share the exact
      // same on/off state.
      el.style.setProperty("--amt", data?.condition === "rain" ? "1" : "0");
    },
  };

  const scrimLayer = {
    id: "scrim",
    build() {
      const el = document.createElement("div");
      el.className = "hp-bg-scrim";
      return el;
    },
  };

  // ---------- shared state (one instance — this card only ever renders
  // once on the dashboard) ----------
  const state = {
    dbg: null,
    root: null,
    bg: null,
    fetching: false,
    lastFetchAt: 0,
    lastKey: "",
    hourly: [],
    // Current-conditions readout state — deliberately separate from the
    // hourly-forecast fields above (own cache key, own throttle, own
    // in-flight guard) so a slow/failed current-conditions fetch can
    // never block or throttle-share with the hourly chart fetch, and
    // vice versa. See ensureCurrentConditions() below.
    current: null,
    currentFetching: false,
    currentFetchAt: 0,
    currentKey: "",
  };

  // Per-container instance bookkeeping for renderWithMockData() only (see
  // that function on the plugin object, below) — keyed by container
  // element rather than reusing the module-scoped `state` singleton
  // above, which belongs to the one real dashboard render() instance.
  const mockInstances = new WeakMap();
  let mockSeq = 0;

  // Named sky-phase presets for renderWithMockData()'s 4th (mockSky)
  // argument — each builds a synthetic {sunrise, sunset} pair (UNIX
  // seconds) such that "now" (the real Date.now(), since sunMoonState()
  // always compares against the real wall clock) lands squarely inside
  // that phase, so Labs can exercise the exact same sunMoonState() math
  // real render() uses without waiting for a real time of day. "night"
  // deliberately builds a pair where today's sunrise is still hours in
  // the FUTURE (i.e. "now" is before today's sunrise) — the same
  // wraparound case sunMoonState()'s "effectiveSunset" fallback exists
  // for, so picking it in Labs also exercises that path.
  const SKY_PHASE_PRESETS = {
    day: () => {
      const now = Date.now() / 1000;
      return { sunrise: now - 5 * 3600, sunset: now + 5 * 3600 };
    },
    dawn: () => {
      const now = Date.now() / 1000;
      return { sunrise: now, sunset: now + 12 * 3600 };
    },
    dusk: () => {
      const now = Date.now() / 1000;
      return { sunrise: now - 12 * 3600, sunset: now };
    },
    night: () => {
      const now = Date.now() / 1000;
      return { sunrise: now + 5 * 3600, sunset: now + 17 * 3600 };
    },
  };
  function resolveMockSky(mockSky) {
    if (!mockSky) return null;
    if (typeof mockSky === "object" && typeof mockSky.sunrise === "number" && typeof mockSky.sunset === "number") {
      return mockSky;
    }
    if (typeof mockSky === "string" && typeof SKY_PHASE_PRESETS[mockSky] === "function") {
      return SKY_PHASE_PRESETS[mockSky]();
    }
    return null;
  }

  async function ensureData(settings, force) {
    const loc = await resolveLatLng();
    if (!loc) return { ok: false, reason: "no-location" };
    if (typeof RydRWeather === "undefined" || typeof RydRWeather.hourlyPrecip !== "function") {
      return { ok: false, reason: "no-weather-module" };
    }
    const key = `${loc.lat.toFixed(2)},${loc.lng.toFixed(2)}:${settings.hours}`;
    const now = Date.now();
    if (!force && state.hourly.length && key === state.lastKey && now - state.lastFetchAt < FETCH_THROTTLE_MS) {
      return { ok: true, changed: false };
    }
    if (state.fetching) return { ok: true, changed: false };
    state.fetching = true;
    try {
      const hourly = await withTimeout(RydRWeather.hourlyPrecip(loc.lat, loc.lng, settings.hours), TIMEOUT_MS, "hourlyPrecip fetch");
      state.fetching = false;
      if (!hourly || !hourly.length) return { ok: false, reason: "empty" };
      const changed = key !== state.lastKey || JSON.stringify(hourly) !== JSON.stringify(state.hourly);
      state.hourly = hourly;
      state.lastKey = key;
      state.lastFetchAt = now;
      return { ok: true, changed };
    } catch (e) {
      state.fetching = false;
      return { ok: false, reason: "error", error: e };
    }
  }

  // Current conditions AT the same resolved location as the hourly chart
  // (reuses resolveLatLng() rather than duplicating the GPS/IP-lookup/
  // saved-default fallback chain) — a small supplementary readout for
  // the card's top-right, not the focal point, so this deliberately
  // follows ensureData()'s exact shape (own cache field, own throttle,
  // own in-flight guard, withTimeout()-guarded) but never touches
  // state.hourly/showStatus/the chart in any way: a failure here must
  // never hide or block the forecast the rest of this card exists for.
  async function ensureCurrentConditions(force) {
    const loc = await resolveLatLng();
    if (!loc) return { ok: false, reason: "no-location" };
    if (typeof RydRWeather === "undefined" || typeof RydRWeather.current !== "function") {
      return { ok: false, reason: "no-weather-module" };
    }
    const key = `${loc.lat.toFixed(2)},${loc.lng.toFixed(2)}`;
    const now = Date.now();
    if (!force && state.current && key === state.currentKey && now - state.currentFetchAt < CUR_COND_THROTTLE_MS) {
      return { ok: true, changed: false };
    }
    if (state.currentFetching) return { ok: true, changed: false };
    state.currentFetching = true;
    try {
      const w = await withTimeout(RydRWeather.current(loc.lat, loc.lng), TIMEOUT_MS, "current conditions fetch");
      state.currentFetching = false;
      if (!w || !w.main || !w.weather || !w.weather[0]) return { ok: false, reason: "empty" };
      state.current = w;
      state.currentKey = key;
      state.currentFetchAt = now;
      return { ok: true, changed: true };
    } catch (e) {
      state.currentFetching = false;
      return { ok: false, reason: "error", error: e };
    }
  }

  // Formats a RydRWeather.current() response into the .hp-cur-cond
  // readout, matching js/dashboard.js's own current-conditions
  // formatting convention exactly (rounded temp + unit off getUnits(),
  // RydRUtils.weatherEmoji() off the condition id) rather than inventing
  // a new one — see dashboard.js's weather-card refresh function.
  // Passing `null` hides the readout without touching anything else on
  // the card, which is how a not-yet-loaded or failed fetch degrades.
  function renderCurrentConditions(rootEl, w) {
    const el = rootEl.querySelector(".hp-cur-cond");
    if (!el) return;
    if (!w || !w.main || !w.weather || !w.weather[0]) {
      el.hidden = true;
      return;
    }
    const units = typeof RydRWeather !== "undefined" ? RydRWeather.getUnits() : "imperial";
    const tempUnit = units === "metric" ? "C" : "F";
    const temp = Math.round(w.main.temp);
    const emoji = typeof RydRUtils !== "undefined" ? RydRUtils.weatherEmoji(w.weather[0].id) : "";
    el.textContent = `${emoji} ${temp}°${tempUnit}`;
    el.title = w.weather[0].description || "";
    el.hidden = false;
  }

  // ---------- DOM ----------
  // No manual background markup here any more — RydRBgAnimator.create()
  // (wired up in render(), below) mounts the sky/sun/cloud/rain/scrim
  // layer stack as this root's first child on its own.
  function buildSkeleton(container) {
    container.innerHTML = `
      <div class="hp-root">
        <div class="hp-head">
          <div class="hp-head-left">
            <span class="hp-head-icon">☔</span>
            <span class="hp-head-title">Chance of Rain</span>
          </div>
          <div class="hp-head-right">
            <span class="hp-cur-cond" hidden></span>
            <span class="hp-head-sub"></span>
          </div>
        </div>
        <div class="hp-chart" hidden></div>
        <div class="hp-status">Loading forecast…</div>
      </div>
    `;
    return container.querySelector(".hp-root");
  }

  function showStatus(rootEl, reason) {
    const status = rootEl.querySelector(".hp-status");
    const chart = rootEl.querySelector(".hp-chart");
    const messages = {
      "no-location": "Waiting on your location…",
      "no-weather-module": "Weather unavailable.",
      empty: "Precipitation forecast unavailable.",
      error: "Couldn't load the forecast — will retry.",
    };
    status.textContent = messages[reason] || "Precipitation forecast unavailable.";
    status.hidden = false;
    chart.hidden = true;
  }
  function hideStatus(rootEl) {
    rootEl.querySelector(".hp-status").hidden = true;
    rootEl.querySelector(".hp-chart").hidden = false;
  }

  function renderChart(rootEl, hourly, animateIn) {
    const chart = rootEl.querySelector(".hp-chart");
    const use24h = (localStorage.getItem("rydr_clock_mode") || "12") === "24";
    chart.innerHTML = hourly
      .map((h, i) => {
        const d = new Date(h.time);
        const label = use24h ? `${d.getHours()}:00` : `${d.getHours() % 12 || 12}${d.getHours() >= 12 ? "P" : "A"}`;
        const pop = Math.max(0, Math.min(100, Math.round(h.pop)));
        const icon = h.iconCode === 800 || h.iconCode === 801 ? "☀️" : pop >= 50 ? "🌧️" : "☁️";
        return `
          <div class="hp-bar-col" style="--i:${i}">
            <div class="hp-bar-icon">${icon}</div>
            <div class="hp-bar-pct">${pop}%</div>
            <div class="hp-bar-track"><div class="hp-bar-fill" data-target="${pop}" style="height:0%"></div></div>
            <div class="hp-bar-time">${label}</div>
          </div>
        `;
      })
      .join("");
    rootEl.querySelector(".hp-head-sub").textContent = `Next ${hourly.length} Hours`;

    const growIn = () => {
      chart.querySelectorAll(".hp-bar-fill").forEach((el) => {
        el.style.height = `${el.dataset.target}%`;
      });
    };
    if (animateIn) {
      // Double rAF: the first commits the height:0 starting point, the
      // second changes it to the real target on the NEXT frame — without
      // this, both writes can land in the same paint and the browser just
      // skips straight to the end state instead of transitioning.
      requestAnimationFrame(() => requestAnimationFrame(growIn));
    } else {
      growIn();
    }
  }

  // ---------- replay the grow-in when the card scrolls into view (a
  // carousel slide becoming active, or scrolling a long dashboard) ----------
  let watchedRoot = null;
  let intersectionObs = null;
  function watchFocus(rootEl) {
    if (watchedRoot === rootEl) return;
    intersectionObs?.disconnect();
    watchedRoot = rootEl;
    if (typeof IntersectionObserver === "undefined") return;
    let wasVisible = false;
    intersectionObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !wasVisible && state.hourly.length && !rootEl.querySelector(".hp-status:not([hidden])")) {
            renderChart(rootEl, state.hourly, true);
          }
          wasVisible = entry.isIntersecting;
        });
      },
      { threshold: 0.6 }
    );
    intersectionObs.observe(rootEl);
  }

  // ---------- settings tab ----------
  function renderSettingsTab(container) {
    const s = getSettings();
    container.innerHTML = `
      <div class="panel-title" style="margin-bottom:8px;">Hourly Precipitation</div>
      <p class="modal-desc">Configure the animated hourly chance-of-rain forecast card.</p>

      <label class="settings-row">
        <span>Forecast window</span>
        <select id="hpHoursSelect" class="route-form" style="width:140px; min-height:40px; background:var(--bg-void); border:1px solid var(--border-subtle); border-radius:6px; color:var(--text-primary); padding:0 10px; font-size:13px;">
          <option value="6">Next 6 hours</option>
          <option value="8">Next 8 hours</option>
          <option value="12">Next 12 hours</option>
        </select>
      </label>

      <label class="settings-row">
        <span>Animated weather background</span>
        <input type="checkbox" id="hpAnimToggle" />
      </label>

      <div style="margin-top:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="font-family:var(--font-display); font-size:13px; font-weight:600; color:var(--text-primary);">Background Intensity</label>
          <span id="hpOpacityValue" style="font-family:var(--font-mono); font-size:12px; color:var(--neon-green);">${Math.round(s.animOpacity * 100)}%</span>
        </div>
        <input type="range" id="hpOpacitySlider" min="0" max="100" step="5" value="${Math.round(s.animOpacity * 100)}" style="width:100%; accent-color:var(--neon-green);" />
        <small style="display:block; font-size:11px; color:var(--text-muted); margin-top:4px;">How strong the current-conditions background (sun, cloud, or rain) reads behind the bar chart. Kept low by design — the chart is always meant to be the focal point.</small>
      </div>
    `;

    const hoursSel = container.querySelector("#hpHoursSelect");
    const animToggle = container.querySelector("#hpAnimToggle");
    const opacitySlider = container.querySelector("#hpOpacitySlider");
    const opacityValue = container.querySelector("#hpOpacityValue");

    hoursSel.value = String(s.hours);
    animToggle.checked = s.animBg;

    // The card's RydRBgAnimator instance (state.bg) owns the actual
    // opacity/enabled wiring — this settings tab just persists the
    // setting and pokes the live instance, the same "settings tab writes
    // localStorage, then nudges the already-rendered card" pattern every
    // other control on this tab already uses.
    function applyLive() {
      if (!state.bg) return;
      const cur = getSettings();
      state.bg.setOpacity(cur.animOpacity);
      state.bg.setEnabled(cur.animBg);
    }

    hoursSel.addEventListener("change", () => {
      saveSettings({ ...getSettings(), hours: Number(hoursSel.value) });
      // A changed forecast window needs fresh data — force past the
      // throttle so it refetches immediately instead of waiting for the
      // render loop's own throttle window. Only the bar chart depends on
      // this; the background tracks current conditions independently.
      if (state.root) {
        ensureData(getSettings(), true).then((result) => {
          if (!result.ok) {
            showStatus(state.root, result.reason);
            return;
          }
          hideStatus(state.root);
          renderChart(state.root, state.hourly, true);
        });
      }
    });
    animToggle.addEventListener("change", () => {
      saveSettings({ ...getSettings(), animBg: animToggle.checked });
      applyLive();
    });
    opacitySlider.addEventListener("input", () => {
      const pct = Number(opacitySlider.value);
      opacityValue.textContent = `${pct}%`;
      saveSettings({ ...getSettings(), animOpacity: pct / 100 });
      applyLive();
    });
  }

  const plugin = {
    id: "hourly-precip",
    name: "Hourly Precipitation",
    description: "An animated hourly chance-of-rain forecast with a full-bleed background showing current conditions at your location — a sun or moon (cross-fading at dawn/dusk) tracking its real position in the sky, clouds drifting right to left, or falling rain — refreshed every 15 minutes.",
    version: "1.1.0",
    icon: "☔",
    category: "weather",
    standalone: true,

    render: function (container, payload) {
      const dbg = state.dbg || (state.dbg = RydRDebugConsole.create({ id: plugin.id, title: plugin.name }));
      let rootEl = container.querySelector(".hp-root");
      const firstBuild = !rootEl;
      if (firstBuild) {
        rootEl = buildSkeleton(container);
        container.appendChild(dbg.el);
        state.root = rootEl;
        const settings0 = getSettings();
        state.bg = RydRBgAnimator.create(rootEl, {
          id: "hourly-precip-bg",
          className: "hp-bg",
          layers: [skyLayer, sunLayer, cloudLayer, rainLayer, scrimLayer],
          opacity: settings0.animOpacity,
          enabled: settings0.animBg,
          // No loopMs/tick() — every layer above is driven by plain
          // layout(el, data), called once per setData(), which only
          // happens on a real current-conditions refresh (every 15
          // minutes) or an actual condition change. RydRBgAnimator's own
          // reduced-motion/enabled/visibility handling still applies to
          // the CSS @keyframes each layer's --amt turns on/off.
        });
        watchFocus(rootEl);
        // The bar grow-in only plays once per load/refresh — a tap on
        // the chart is the manual way to replay it on demand.
        rootEl.querySelector(".hp-chart").addEventListener("click", () => {
          if (state.hourly.length) renderChart(rootEl, state.hourly, true);
        });
      }
      const settings = getSettings();
      // Cheap to re-assert every ~2s render tick even when nothing
      // changed — matches the idempotent pattern the rest of this file
      // already uses (e.g. re-deriving `settings` every call).
      state.bg.setOpacity(settings.animOpacity);
      state.bg.setEnabled(settings.animBg);

      dbg.guardAsync(
        ensureData(settings).then((result) => {
          if (!result.ok) {
            dbg.warn(`no data: ${result.reason}`, result.error || "");
            showStatus(rootEl, result.reason);
            return;
          }
          if (firstBuild || result.changed) {
            hideStatus(rootEl);
            renderChart(rootEl, state.hourly, true);
          }
        }),
        "render/ensureData"
      );

      // Own guardAsync call, own promise chain — entirely independent of
      // the hourly-forecast fetch above so a slow/failed current-
      // conditions fetch can never delay or blank the chart, and a slow/
      // failed hourly fetch can never keep this readout from showing.
      // dbg.warn on every failure reason (not just unexpected ones)
      // matches the exact "no silent failure path" pattern the hourly
      // fetch above already uses.
      dbg.guardAsync(
        ensureCurrentConditions(false).then((result) => {
          if (!result.ok) {
            dbg.warn(`current conditions unavailable: ${result.reason}`, result.error || "");
            return;
          }
          if (firstBuild || result.changed) {
            renderCurrentConditions(rootEl, state.current);
            state.bg.setData({
              condition: classifyCondition(state.current),
              sunrise: state.current?.sys?.sunrise,
              sunset: state.current?.sys?.sunset,
            });
          }
        }),
        "render/ensureCurrentConditions"
      );
    },

    // Test-only entry point for Labs (labs.html) — lets a scripted mock
    // forecast (for the bar chart) and an explicit mock condition (for
    // the background) drive the exact same production rendering
    // machinery real render() uses (buildSkeleton/renderChart/
    // RydRBgAnimator.create), with ensureData()'s/ensureCurrentConditions()'s
    // GPS -> IP-lookup -> saved-default -> RydRWeather network path
    // skipped entirely in favor of caller-supplied values. This is what
    // lets Labs exercise the real background animation (sun/cloud/rain,
    // each its own always-looping CSS state) on demand, without waiting
    // on real weather or real GPS — see the "Hourly Precipitation"
    // card in labs.html / js/labs.js.
    //
    // Deliberately keeps its own per-container instance state (on the
    // container element itself, via a WeakMap) instead of touching the
    // module-scoped `state` object above that real render() owns — so
    // this can never fight a real, live-data instance of this plugin
    // that happens to be rendering elsewhere in the same page (not the
    // case for labs.html today, which never loads the real dashboard,
    // but this keeps that true even if that ever changes).
    //
    // mockSky (optional 4th arg) drives the sun/moon system's time-of-day
    // math: either an explicit {sunrise, sunset} pair (UNIX seconds) for
    // full control, or one of the named SKY_PHASE_PRESETS keys ("day",
    // "dawn", "dusk", "night") for a quick one-word check of the dusk/
    // dawn cross-fade — see resolveMockSky() above. Falls back to the
    // "day" preset (rather than leaving sunrise/sunset undefined) so a
    // caller that never passes mockSky still gets a stable, sane sun
    // position instead of sunMoonState()'s no-data fallback every time.
    renderWithMockData: function (container, hourlyArray, mockCondition, mockSky) {
      const hourly = Array.isArray(hourlyArray) ? hourlyArray : [];
      let inst = mockInstances.get(container);
      let rootEl = container.querySelector(".hp-root");
      if (!rootEl || !inst) {
        rootEl = buildSkeleton(container);
        const bg = RydRBgAnimator.create(rootEl, {
          id: `hourly-precip-mock-bg-${++mockSeq}`,
          className: "hp-bg",
          layers: [skyLayer, sunLayer, cloudLayer, rainLayer, scrimLayer],
          opacity: DEFAULT_SETTINGS.animOpacity,
          enabled: true,
        });
        inst = { bg, condition: "sun", sky: SKY_PHASE_PRESETS.day() };
        mockInstances.set(container, inst);
        rootEl.querySelector(".hp-chart").addEventListener("click", () => {
          if (inst.hourly && inst.hourly.length) renderChart(rootEl, inst.hourly, true);
        });
      }
      inst.hourly = hourly;
      if (["sun", "cloud", "rain"].includes(mockCondition)) inst.condition = mockCondition;
      const sky = resolveMockSky(mockSky);
      if (sky) inst.sky = sky;
      inst.bg.setData({ condition: inst.condition, sunrise: inst.sky.sunrise, sunset: inst.sky.sunset });
      if (!hourly.length) {
        showStatus(rootEl, "empty");
        return rootEl;
      }
      hideStatus(rootEl);
      renderChart(rootEl, hourly, true);
      return rootEl;
    },

    settingsTab: {
      id: "hourly-precip",
      label: "Hourly Precipitation",
      render: renderSettingsTab,
    },
  };

  const runtimeKey = "__RydRPluginRuntime__";
  root[runtimeKey] = root[runtimeKey] || {};
  root[runtimeKey][plugin.id] = plugin;
})(window);
