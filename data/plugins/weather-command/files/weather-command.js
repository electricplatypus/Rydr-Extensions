// Weather Command — a single, standalone weather plugin covering current
// conditions, hour-by-hour and 3/7-day forecasts, a local precipitation
// radar, active NWS watches/warnings, and a motorcycle-specific riding
// conditions readout, all reachable from one dashboard card + one
// full-screen view (tabs), rather than spreading weather across several
// separate plugins.
//
// Data sources, all already wired up elsewhere in the app (see
// js/weather.js and js/radar.js) and reused here rather than duplicated:
// - RydRWeather.current/hourlyPrecip/dailyForecast — OpenWeatherMap, via
//   the /api/weather proxy so the API key stays server-side.
// - RydRWeather.getAlerts — NOAA/National Weather Service CAP alerts.
//   NWS only covers the United States, so the Alerts tab always shows an
//   empty state (not an error) outside the US.
// - RydRRadar.fetchTimeline — the same RainViewer (observed, past 60m)
//   + Rainbow.ai (nowcast, up to +4h) hybrid timeline the main dashboard's
//   map radar overlay uses. That module only exposes a Google-Maps
//   ImageMapType consumer (showFrame/hide), so this plugin renders its
//   own lightweight tile grid — see the Radar section below.
(function (root) {
  const PLUGIN_ID = "weather-command";
  const SETTINGS_KEY = "rydr_weather_command_settings";
  const DEFAULT_SETTINGS = { hourlyHours: 24, radarAutoplay: false, cardHourlyStrip: true };

  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const p = raw ? JSON.parse(raw) : {};
      return {
        hourlyHours: [12, 24, 48].includes(Number(p.hourlyHours)) ? Number(p.hourlyHours) : DEFAULT_SETTINGS.hourlyHours,
        radarAutoplay: p.radarAutoplay === true,
        cardHourlyStrip: p.cardHourlyStrip !== false,
      };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  }
  function saveSettings(next) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }

  // ---------- timeouts / location (same 3-tier fallback as the Hourly
  // Precipitation plugin: live GPS -> saved default -> IP lookup) ----------
  const TIMEOUT_MS = 12000;
  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label || "operation"} timed out after ${ms}ms`)), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }
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

  // ---------- generic per-data-kind cache, one instance per fetched thing
  // (current/hourly/3-day/7-day/alerts) instead of five hand-rolled copies
  // of the same throttle/in-flight-guard bookkeeping. ----------
  function makeCache() {
    return { data: null, key: "", at: 0, fetching: false };
  }
  async function ensureCached(cache, key, throttleMs, force, fetchFn) {
    const now = Date.now();
    if (!force && cache.data && key === cache.key && now - cache.at < throttleMs) return { ok: true, changed: false };
    if (cache.fetching) return { ok: true, changed: false };
    cache.fetching = true;
    try {
      const data = await fetchFn();
      cache.fetching = false;
      if (data == null || (Array.isArray(data) && !data.length)) {
        cache._lastReason = "empty";
        return { ok: false, reason: "empty" };
      }
      const changed = key !== cache.key || JSON.stringify(data) !== JSON.stringify(cache.data);
      cache.data = data;
      cache.key = key;
      cache.at = now;
      cache._lastReason = null;
      return { ok: true, changed };
    } catch (e) {
      cache.fetching = false;
      cache._lastReason = "error";
      return { ok: false, reason: "error", error: e };
    }
  }

  const CURRENT_THROTTLE_MS = 10 * 60 * 1000;
  const HOURLY_THROTTLE_MS = 15 * 60 * 1000;
  const DAILY_THROTTLE_MS = 30 * 60 * 1000;
  const ALERTS_THROTTLE_MS = 10 * 60 * 1000;
  const RADAR_THROTTLE_MS = 5 * 60 * 1000;

  const state = {
    cardDbg: null,
    loc: null,
    current: makeCache(),
    hourly: makeCache(),
    daily3: makeCache(),
    daily7: makeCache(),
    alerts: makeCache(),
    radar: { timeline: [], at: 0, fetching: false, index: -1, playing: false, playTimer: null },
  };

  async function ensureLocation() {
    state.loc = await resolveLatLng();
    return state.loc;
  }

  function fail(cache, reason) {
    cache._lastReason = reason;
    return { ok: false, reason };
  }

  async function fetchCurrent(force) {
    const loc = await ensureLocation();
    if (!loc) return fail(state.current, "no-location");
    if (typeof RydRWeather === "undefined") return fail(state.current, "no-weather-module");
    return ensureCached(state.current, `${loc.lat.toFixed(2)},${loc.lng.toFixed(2)}`, CURRENT_THROTTLE_MS, force, () =>
      withTimeout(RydRWeather.current(loc.lat, loc.lng), TIMEOUT_MS, "current conditions")
    );
  }
  async function fetchHourly(force) {
    const loc = await ensureLocation();
    if (!loc) return fail(state.hourly, "no-location");
    if (typeof RydRWeather === "undefined") return fail(state.hourly, "no-weather-module");
    const hours = getSettings().hourlyHours;
    return ensureCached(state.hourly, `${loc.lat.toFixed(2)},${loc.lng.toFixed(2)}:${hours}`, HOURLY_THROTTLE_MS, force, () =>
      withTimeout(RydRWeather.hourlyPrecip(loc.lat, loc.lng, hours), TIMEOUT_MS, "hourly forecast")
    );
  }
  async function fetchDaily(days, force) {
    const loc = await ensureLocation();
    const cache = days > 5 ? state.daily7 : state.daily3;
    if (!loc) return fail(cache, "no-location");
    if (typeof RydRWeather === "undefined") return fail(cache, "no-weather-module");
    return ensureCached(cache, `${loc.lat.toFixed(2)},${loc.lng.toFixed(2)}:${days}`, DAILY_THROTTLE_MS, force, () =>
      withTimeout(RydRWeather.dailyForecast(loc.lat, loc.lng, days), TIMEOUT_MS, "daily forecast")
    );
  }
  async function fetchAlerts(force) {
    const loc = await ensureLocation();
    if (!loc) return fail(state.alerts, "no-location");
    if (typeof RydRWeather === "undefined" || typeof RydRWeather.getAlerts !== "function") return fail(state.alerts, "no-weather-module");
    const key = `${loc.lat.toFixed(2)},${loc.lng.toFixed(2)}`;
    const now = Date.now();
    if (!force && state.alerts.key === key && now - state.alerts.at < ALERTS_THROTTLE_MS) return { ok: true, changed: false };
    if (state.alerts.fetching) return { ok: true, changed: false };
    state.alerts.fetching = true;
    try {
      const data = await withTimeout(RydRWeather.getAlerts(loc.lat, loc.lng), TIMEOUT_MS, "weather alerts");
      state.alerts.fetching = false;
      const changed = key !== state.alerts.key || JSON.stringify(data) !== JSON.stringify(state.alerts.data);
      state.alerts.data = Array.isArray(data) ? data : [];
      state.alerts.key = key;
      state.alerts.at = now;
      state.alerts._lastReason = null;
      return { ok: true, changed };
    } catch (e) {
      state.alerts.fetching = false;
      return fail(state.alerts, "error");
    }
  }
  async function ensureRadarTimeline(force) {
    if (typeof RydRRadar === "undefined" || typeof RydRRadar.fetchTimeline !== "function") return fail(state.radar, "no-radar-module");
    const now = Date.now();
    if (!force && state.radar.timeline.length && now - state.radar.at < RADAR_THROTTLE_MS) return { ok: true, changed: false };
    if (state.radar.fetching) return { ok: true, changed: false };
    state.radar.fetching = true;
    try {
      const timeline = await withTimeout(RydRRadar.fetchTimeline(), TIMEOUT_MS, "radar timeline");
      state.radar.fetching = false;
      state.radar.timeline = timeline;
      state.radar.at = now;
      state.radar._lastReason = null;
      if (state.radar.index < 0 && typeof RydRRadar.nowIndex === "function") state.radar.index = RydRRadar.nowIndex();
      return { ok: true, changed: true };
    } catch (e) {
      state.radar.fetching = false;
      return fail(state.radar, "error");
    }
  }

  // ---------- formatting helpers ----------
  function units() {
    return typeof RydRWeather !== "undefined" ? RydRWeather.getUnits() : "imperial";
  }
  function tempUnit() { return units() === "metric" ? "C" : "F"; }
  function windUnit() { return units() === "metric" ? "m/s" : "mph"; }
  function use24h() { return (localStorage.getItem("rydr_clock_mode") || "12") === "24"; }
  function fmtHour(ms) {
    const d = new Date(ms);
    if (use24h()) return `${d.getHours()}:00`;
    const h = d.getHours() % 12 || 12;
    return `${h}${d.getHours() >= 12 ? "PM" : "AM"}`;
  }
  function fmtDay(ms, i) {
    if (i === 0) return "Today";
    if (i === 1) return "Tomorrow";
    return new Date(ms).toLocaleDateString(undefined, { weekday: "short" });
  }
  function esc(s) {
    return typeof RydRUtils !== "undefined" ? RydRUtils.escapeHtml(s) : String(s ?? "");
  }
  function emoji(code) {
    return typeof RydRUtils !== "undefined" ? RydRUtils.weatherEmoji(code) : "🌡️";
  }
  function toMph(speed) {
    return units() === "metric" && typeof RydRUtils !== "undefined" ? RydRUtils.msToMph(speed) : speed;
  }

  // ---------- riding-conditions heuristic ----------
  // Deliberately a simple, transparent point-deduction model (not a
  // sourced/official rideability index) — the goal is a fast, glanceable
  // "should I ride, and what should I watch for" signal, not precision.
  function computeRideScore({ tempF, windMph, pop, visibilityM, conditionId }) {
    let score = 100;
    const notes = [];
    if (typeof tempF === "number") {
      if (tempF < 32) { score -= 45; notes.push("Near/below freezing — watch for black ice on shaded pavement and bridges."); }
      else if (tempF < 45) { score -= 22; notes.push("Cold — layer up; cold hands dull throttle/brake feel."); }
      else if (tempF < 55) { score -= 8; }
      else if (tempF > 100) { score -= 35; notes.push("Extreme heat — high risk of rider fatigue and dehydration."); }
      else if (tempF > 90) { score -= 15; notes.push("Hot — stay hydrated, take breaks."); }
    }
    if (typeof windMph === "number") {
      if (windMph >= 30) { score -= 40; notes.push("High wind — strong gusts can push a bike off line, especially near trucks or on bridges."); }
      else if (windMph >= 20) { score -= 22; notes.push("Gusty — brace for crosswind on open stretches."); }
      else if (windMph >= 12) { score -= 8; }
    }
    if (typeof pop === "number") {
      if (pop >= 70) { score -= 35; notes.push("Rain likely — expect reduced traction and lower visibility to other drivers."); }
      else if (pop >= 40) { score -= 18; notes.push("Chance of rain — carry wet-weather gear."); }
      else if (pop >= 15) { score -= 5; }
    }
    if (typeof conditionId === "number") {
      if (conditionId >= 200 && conditionId < 300) { score = Math.min(score, 15); notes.push("Thunderstorms — lightning risk, hold off riding."); }
      else if (conditionId >= 600 && conditionId < 700) { score = Math.min(score, 20); notes.push("Snow/ice — traction severely reduced."); }
      else if (conditionId >= 700 && conditionId < 800) { score -= 15; notes.push("Fog/haze — reduced visibility."); }
    }
    if (typeof visibilityM === "number") {
      if (visibilityM < 1000) { score -= 25; notes.push("Very low visibility."); }
      else if (visibilityM < 5000) { score -= 10; }
    }
    score = Math.max(0, Math.min(100, Math.round(score)));
    let label, color, badge;
    if (score >= 85) { label = "Great Riding Weather"; color = "var(--neon-green)"; badge = "🏍️"; }
    else if (score >= 65) { label = "Good"; color = "var(--cyan)"; badge = "👍"; }
    else if (score >= 45) { label = "Fair — Ride Prepared"; color = "var(--warn-amber)"; badge = "⚠️"; }
    else if (score >= 25) { label = "Poor"; color = "var(--alert-red)"; badge = "🚫"; }
    else { label = "Avoid Riding"; color = "var(--alert-red)"; badge = "⛔"; }
    return { score, label, color, badge, notes };
  }

  // ---------- styles (self-contained, matches the pattern used by
  // route-exchange/marketplace/ai-companion rather than editing the
  // shared css/style.css) ----------
  function ensureStyles() {
    if (document.getElementById("wxc-styles")) return;
    const css = [
      // ----- dashboard card -----
      ".wxc-card{position:relative;width:100%;height:100%;display:flex;flex-direction:column;background:linear-gradient(160deg,var(--bg-panel-raised) 0%,var(--bg-panel) 100%);color:var(--text-primary);font-family:var(--font-body);overflow:hidden;}",
      ".wxc-card-top{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 4px;}",
      ".wxc-card-loc{display:flex;align-items:center;gap:6px;font-family:var(--font-display);font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".wxc-alert-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;background:color-mix(in srgb,var(--alert-red) 18%,transparent);border:1px solid var(--alert-red);color:var(--alert-red);font-size:11px;font-weight:700;flex-shrink:0;}",
      ".wxc-card-main{display:flex;align-items:center;gap:12px;padding:2px 14px 8px;}",
      ".wxc-card-icon{font-size:44px;line-height:1;flex-shrink:0;}",
      ".wxc-card-temp{font-family:var(--font-mono);font-weight:700;font-size:40px;line-height:1;}",
      ".wxc-card-tempunit{font-size:20px;vertical-align:top;opacity:.75;}",
      ".wxc-card-cond{font-size:13px;color:var(--text-muted);margin-top:2px;text-transform:capitalize;}",
      ".wxc-card-feels{font-size:11.5px;color:var(--text-dim);margin-top:1px;}",
      ".wxc-card-hilo{margin-left:auto;text-align:right;font-family:var(--font-mono);font-size:13px;color:var(--text-muted);flex-shrink:0;}",
      ".wxc-card-hilo b{color:var(--text-primary);}",
      ".wxc-card-strip{display:flex;gap:0;padding:0 8px;overflow-x:auto;scrollbar-width:none;border-top:1px solid var(--border-subtle);}",
      ".wxc-card-strip::-webkit-scrollbar{display:none;}",
      ".wxc-card-hr{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 10px;min-width:52px;flex-shrink:0;}",
      ".wxc-card-hr-t{font-size:10.5px;color:var(--text-dim);}",
      ".wxc-card-hr-i{font-size:18px;}",
      ".wxc-card-hr-v{font-family:var(--font-mono);font-size:12px;font-weight:600;}",
      ".wxc-card-foot{margin-top:auto;display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--border-subtle);}",
      ".wxc-card-tip{flex:1;font-size:11.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".wxc-card-btn{flex-shrink:0;min-height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--border-strong);background:var(--bg-panel-hover);color:var(--text-primary);font-size:11.5px;font-weight:700;font-family:var(--font-display);letter-spacing:.03em;text-transform:uppercase;cursor:pointer;}",
      ".wxc-card-btn:active{transform:scale(.97);}",
      ".wxc-card-status{display:flex;align-items:center;justify-content:center;flex:1;padding:20px;text-align:center;color:var(--text-muted);font-size:13px;}",

      // ----- full screen -----
      ".wxc-screen{display:flex;flex-direction:column;height:100%;color:var(--text-primary);font-family:var(--font-body);}",
      ".wxc-screen-sub{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border-subtle);}",
      ".wxc-screen-loc{flex:1;font-size:12.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".wxc-refresh-btn{min-width:36px;min-height:36px;border-radius:8px;border:1px solid var(--border-subtle);background:var(--bg-panel-hover);color:var(--text-primary);font-size:15px;cursor:pointer;flex-shrink:0;}",
      ".wxc-tabbar{display:flex;overflow-x:auto;scrollbar-width:none;gap:4px;padding:8px 10px;border-bottom:1px solid var(--border-subtle);background:var(--bg-panel);flex-shrink:0;}",
      ".wxc-tabbar::-webkit-scrollbar{display:none;}",
      ".wxc-tab{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:64px;padding:7px 10px;border-radius:10px;border:1px solid transparent;background:none;color:var(--text-muted);font-family:var(--font-display);font-size:11px;font-weight:600;letter-spacing:.02em;cursor:pointer;flex-shrink:0;}",
      ".wxc-tab-icon{font-size:17px;}",
      ".wxc-tab.active{background:var(--bg-panel-hover);border-color:var(--border-strong);color:var(--text-primary);}",
      ".wxc-tab-badge{position:absolute;top:2px;right:6px;min-width:15px;height:15px;padding:0 3px;border-radius:999px;background:var(--alert-red);color:#fff;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center;}",
      // A class selector and the UA's [hidden] rule are equal specificity,
      // but author styles always win over UA styles regardless — so the
      // unconditional `display:flex` above would otherwise show every
      // tab's badge (initially rendered with the `hidden` attribute) even
      // before updateAlertBadge() ever unhides the one that should show.
      ".wxc-tab-badge[hidden]{display:none;}",
      ".wxc-tab.has-alert{color:var(--alert-red);}",
      ".wxc-tabpanels{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px;}",
      ".wxc-tabpanel[hidden]{display:none;}",
      ".wxc-empty{padding:30px 16px;text-align:center;color:var(--text-muted);font-size:13.5px;}",
      ".wxc-empty-icon{font-size:34px;margin-bottom:8px;}",

      // ----- now tab -----
      ".wxc-hero{display:flex;align-items:center;gap:16px;padding:8px 4px 18px;}",
      ".wxc-hero-icon{font-size:64px;line-height:1;}",
      ".wxc-hero-temp{font-family:var(--font-mono);font-weight:700;font-size:56px;line-height:1;}",
      ".wxc-hero-unit{font-size:26px;opacity:.7;vertical-align:top;}",
      ".wxc-hero-cond{font-size:15px;color:var(--text-muted);text-transform:capitalize;margin-top:4px;}",
      ".wxc-hero-feels{font-size:12.5px;color:var(--text-dim);margin-top:2px;}",
      ".wxc-stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;}",
      ".wxc-stat{background:var(--bg-panel-raised);border:1px solid var(--border-subtle);border-radius:12px;padding:10px 8px;text-align:center;}",
      ".wxc-stat-icon{font-size:16px;margin-bottom:3px;}",
      ".wxc-stat-val{font-family:var(--font-mono);font-weight:700;font-size:15px;}",
      ".wxc-stat-lbl{font-size:9.5px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.04em;margin-top:2px;}",
      ".wxc-section-title{font-family:var(--font-display);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);margin:18px 0 8px;}",
      ".wxc-section-title:first-child{margin-top:0;}",

      // ----- hourly strip / list -----
      ".wxc-hourly-row{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:4px;}",
      ".wxc-hourly-row::-webkit-scrollbar{display:none;}",
      ".wxc-hour-card{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:58px;padding:10px 6px;border-radius:12px;background:var(--bg-panel-raised);border:1px solid var(--border-subtle);flex-shrink:0;}",
      ".wxc-hour-t{font-size:10.5px;color:var(--text-dim);}",
      ".wxc-hour-i{font-size:20px;}",
      ".wxc-hour-v{font-family:var(--font-mono);font-weight:700;font-size:14px;}",
      ".wxc-hour-p{font-size:10px;color:var(--cyan);font-weight:600;}",

      // ----- daily list -----
      ".wxc-day-row{display:flex;align-items:center;gap:10px;padding:12px 4px;border-bottom:1px solid var(--border-subtle);cursor:pointer;}",
      ".wxc-day-row:last-child{border-bottom:none;}",
      ".wxc-day-name{width:78px;flex-shrink:0;font-weight:600;font-size:13.5px;}",
      ".wxc-day-icon{font-size:22px;width:30px;text-align:center;flex-shrink:0;}",
      ".wxc-day-desc{flex:1;font-size:12px;color:var(--text-muted);text-transform:capitalize;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".wxc-day-pop{font-size:11.5px;color:var(--cyan);width:38px;text-align:right;flex-shrink:0;}",
      ".wxc-day-temps{font-family:var(--font-mono);font-size:13.5px;width:78px;text-align:right;flex-shrink:0;}",
      ".wxc-day-temps .lo{color:var(--text-dim);}",
      ".wxc-day-chevron{width:16px;text-align:center;color:var(--text-dim);flex-shrink:0;transition:transform .15s ease;}",
      ".wxc-day-row.open .wxc-day-chevron{transform:rotate(90deg);}",
      ".wxc-day-detail{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:0 4px 12px;}",
      ".wxc-day-detail[hidden]{display:none;}",
      ".wxc-day-seg{text-align:center;background:var(--bg-panel-raised);border-radius:10px;padding:8px 4px;}",
      ".wxc-day-seg-lbl{font-size:9.5px;color:var(--text-dim);text-transform:uppercase;}",
      ".wxc-day-seg-icon{font-size:16px;margin:3px 0;}",
      ".wxc-day-seg-t{font-family:var(--font-mono);font-size:12.5px;font-weight:700;}",

      // ----- radar -----
      ".wxc-radar-wrap{display:flex;flex-direction:column;gap:10px;}",
      ".wxc-radar-grid{position:relative;width:100%;aspect-ratio:1/1;max-width:420px;margin:0 auto;border-radius:14px;overflow:hidden;border:1px solid var(--border-subtle);display:grid;background:var(--bg-void);}",
      ".wxc-radar-tile{position:relative;overflow:hidden;}",
      ".wxc-radar-tile img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}",
      ".wxc-radar-tile .base{opacity:.85;}",
      ".wxc-radar-tile .overlay{opacity:.7;mix-blend-mode:normal;transition:opacity .2s ease;}",
      ".wxc-radar-marker{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:var(--cyan);box-shadow:0 0 0 4px color-mix(in srgb,var(--cyan) 35%,transparent);z-index:5;}",
      ".wxc-radar-marker::after{content:'';position:absolute;inset:-8px;border-radius:50%;border:2px solid var(--cyan);opacity:.6;animation:wxc-pulse 2s ease-out infinite;}",
      "@keyframes wxc-pulse{0%{transform:scale(.4);opacity:.8;}100%{transform:scale(1.6);opacity:0;}}",
      ".wxc-radar-controls{display:flex;align-items:center;gap:8px;}",
      ".wxc-radar-play{min-width:40px;min-height:40px;border-radius:10px;border:1px solid var(--border-strong);background:var(--bg-panel-hover);color:var(--text-primary);font-size:15px;cursor:pointer;flex-shrink:0;}",
      ".wxc-radar-slider{flex:1;accent-color:var(--neon-green);}",
      ".wxc-radar-label{text-align:center;font-family:var(--font-mono);font-size:12.5px;color:var(--text-muted);}",
      ".wxc-radar-legend{display:flex;align-items:center;justify-content:center;gap:6px;font-size:10.5px;color:var(--text-dim);}",
      ".wxc-radar-legend-bar{width:90px;height:6px;border-radius:3px;background:linear-gradient(90deg,#3fa9f5,#37d67a,#f5e04a,#f57c1f,#e0343e);}",
      ".wxc-radar-attrib{text-align:center;font-size:9.5px;color:var(--text-dim);}",

      // ----- alerts -----
      ".wxc-alert-card{border-radius:12px;padding:12px;margin-bottom:10px;background:var(--bg-panel-raised);border:1px solid var(--wxc-a-color,var(--border-subtle));border-left:4px solid var(--wxc-a-color,var(--border-subtle));}",
      ".wxc-alert-top{display:flex;align-items:center;gap:8px;margin-bottom:4px;}",
      ".wxc-alert-sev{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.03em;color:var(--wxc-a-color);}",
      ".wxc-alert-title{font-weight:700;font-size:14px;margin-bottom:3px;}",
      ".wxc-alert-time{font-size:11px;color:var(--text-dim);margin-bottom:6px;}",
      ".wxc-alert-desc{font-size:12.5px;color:var(--text-muted);line-height:1.4;max-height:3.6em;overflow:hidden;}",
      ".wxc-alert-link{display:inline-block;margin-top:8px;font-size:12px;font-weight:700;color:var(--neon-green);text-decoration:none;}",
      ".wxc-ok-banner{display:flex;align-items:center;gap:10px;padding:16px;border-radius:12px;background:color-mix(in srgb,var(--neon-green) 12%,transparent);border:1px solid var(--neon-green);margin-bottom:8px;}",
      ".wxc-ok-banner-icon{font-size:22px;}",

      // ----- riding -----
      ".wxc-ride-hero{display:flex;align-items:center;gap:14px;padding:16px;border-radius:14px;background:var(--bg-panel-raised);border:1px solid var(--wxc-r-color,var(--border-subtle));margin-bottom:16px;}",
      ".wxc-ride-badge{font-size:40px;}",
      ".wxc-ride-score{font-family:var(--font-mono);font-weight:700;font-size:28px;color:var(--wxc-r-color);}",
      ".wxc-ride-label{font-family:var(--font-display);font-weight:700;font-size:15px;}",
      ".wxc-ride-bar-track{height:8px;border-radius:4px;background:var(--bg-void);overflow:hidden;margin-top:8px;}",
      ".wxc-ride-bar-fill{height:100%;border-radius:4px;background:var(--wxc-r-color);transition:width .4s ease;}",
      ".wxc-ride-notes{list-style:none;padding:0;margin:0 0 16px;display:flex;flex-direction:column;gap:8px;}",
      ".wxc-ride-notes li{display:flex;gap:8px;font-size:12.5px;color:var(--text-muted);line-height:1.4;padding:9px 10px;background:var(--bg-panel-raised);border-radius:10px;}",
      ".wxc-ride-strip{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:4px;}",
      ".wxc-ride-strip::-webkit-scrollbar{display:none;}",
      ".wxc-ride-chip{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:46px;padding:8px 4px;border-radius:10px;flex-shrink:0;color:#0c0f14;}",
      ".wxc-ride-chip .t{font-size:10px;opacity:.75;}",
      ".wxc-ride-chip .s{font-family:var(--font-mono);font-weight:800;font-size:13px;}",
      ".wxc-ride-best{padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--neon-green) 12%,transparent);border:1px solid var(--neon-green);font-size:12.5px;margin-bottom:16px;}",

      // ----- settings tab -----
      ".wxc-settings-select{width:140px;min-height:40px;background:var(--bg-void);border:1px solid var(--border-subtle);border-radius:6px;color:var(--text-primary);padding:0 10px;font-size:13px;}",
    ].join("\n");
    const style = document.createElement("style");
    style.id = "wxc-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ======================================================================
  // Dashboard card
  // ======================================================================
  function buildCardSkeleton(container) {
    container.innerHTML = `<div class="wxc-card"><div class="wxc-card-status">Loading weather…</div></div>`;
    return container.querySelector(".wxc-card");
  }

  function renderCardContent(cardEl) {
    const w = state.current.data;
    const hourly = state.hourly.data;
    const daily = state.daily3.data;
    const alerts = state.alerts.data || [];
    if (!w) {
      cardEl.innerHTML = `<div class="wxc-card-status">Weather unavailable right now.</div>`;
      return;
    }
    const settings = getSettings();
    const temp = Math.round(w.main.temp);
    const feels = Math.round(w.main.feels_like);
    const cond = w.weather[0];
    const today = Array.isArray(daily) && daily[0] ? daily[0] : null;
    const rideNow = computeRideScore({
      tempF: units() === "metric" ? temp * 1.8 + 32 : temp,
      windMph: Math.round(toMph(w.wind?.speed || 0)),
      pop: today ? today.pop : 0,
      visibilityM: typeof w.visibility === "number" ? w.visibility : null,
      conditionId: cond.id,
    });
    const activeAlerts = alerts.length;

    let stripHtml = "";
    if (settings.cardHourlyStrip && Array.isArray(hourly) && hourly.length) {
      stripHtml = `<div class="wxc-card-strip">${hourly
        .slice(0, 8)
        .map((h) => `
          <div class="wxc-card-hr">
            <div class="wxc-card-hr-t">${esc(fmtHour(h.time))}</div>
            <div class="wxc-card-hr-i">${emoji(h.iconCode)}</div>
            <div class="wxc-card-hr-v">${Math.round(h.temp)}°</div>
          </div>`)
        .join("")}</div>`;
    }

    cardEl.innerHTML = `
      <div class="wxc-card-top">
        <div class="wxc-card-loc">📍 ${esc(w.name || "Current Location")}</div>
        ${activeAlerts ? `<span class="wxc-alert-chip">⚠️ ${activeAlerts} Alert${activeAlerts > 1 ? "s" : ""}</span>` : ""}
      </div>
      <div class="wxc-card-main">
        <div class="wxc-card-icon">${emoji(cond.id)}</div>
        <div>
          <div class="wxc-card-temp">${temp}<span class="wxc-card-tempunit">°${esc(tempUnit())}</span></div>
          <div class="wxc-card-cond">${esc(cond.description)}</div>
          <div class="wxc-card-feels">Feels like ${feels}° · ${rideNow.badge} ${esc(rideNow.label)}</div>
        </div>
        ${today ? `<div class="wxc-card-hilo">H:<b>${today.hi}°</b><br>L:<b>${today.lo}°</b></div>` : ""}
      </div>
      ${stripHtml}
      <div class="wxc-card-foot">
        <div class="wxc-card-tip">${today ? esc(today.description) : ""}</div>
        <button type="button" class="wxc-card-btn" data-wxc-open>Full Forecast</button>
      </div>
    `;

    cardEl.querySelector("[data-wxc-open]")?.addEventListener("click", () => {
      document.querySelector('[data-plugin-menu-item="weather-command-menu-item"]')?.click();
    });
  }

  // ======================================================================
  // Full-screen: tabs
  // ======================================================================
  const TABS = [
    { id: "now", label: "Now", icon: "🌡️" },
    { id: "hourly", label: "Hourly", icon: "🕐" },
    { id: "3day", label: "3-Day", icon: "📅" },
    { id: "7day", label: "7-Day", icon: "🗓️" },
    { id: "radar", label: "Radar", icon: "📡" },
    { id: "alerts", label: "Alerts", icon: "⚠️" },
    { id: "riding", label: "Riding", icon: "🏍️" },
  ];

  function buildScreenSkeleton(container) {
    container.innerHTML = `
      <div class="wxc-screen">
        <div class="wxc-screen-sub">
          <div class="wxc-screen-loc" data-wxc-loc>Locating…</div>
          <button type="button" class="wxc-refresh-btn" data-wxc-refresh title="Refresh">↻</button>
        </div>
        <div class="wxc-tabbar" role="tablist">
          ${TABS.map(
            (t) => `<button type="button" class="wxc-tab" data-tab="${t.id}" role="tab">
              <span class="wxc-tab-icon">${t.icon}</span><span>${t.label}</span>
              <span class="wxc-tab-badge" data-badge="${t.id}" hidden></span>
            </button>`
          ).join("")}
        </div>
        <div class="wxc-tabpanels">
          ${TABS.map((t) => `<div class="wxc-tabpanel" data-panel="${t.id}" ${t.id === "now" ? "" : "hidden"}><div class="wxc-empty">Loading…</div></div>`).join("")}
        </div>
      </div>
    `;
    return container.querySelector(".wxc-screen");
  }

  function statusHtml(reason) {
    const map = {
      "no-location": { icon: "📍", text: "Waiting on your location…" },
      "no-weather-module": { icon: "🧩", text: "Weather module unavailable." },
      "no-radar-module": { icon: "📡", text: "Radar module unavailable." },
      empty: { icon: "🌦️", text: "No data available right now." },
      error: { icon: "📶", text: "Couldn't load — will retry." },
    };
    const m = map[reason] || map.empty;
    return `<div class="wxc-empty"><div class="wxc-empty-icon">${m.icon}</div>${esc(m.text)}</div>`;
  }

  // ---------- Now ----------
  function renderNowPanel(panel) {
    const w = state.current.data;
    if (!w) { panel.innerHTML = statusHtml(state.current._lastReason || "empty"); return; }
    const cond = w.weather[0];
    const temp = Math.round(w.main.temp);
    const feels = Math.round(w.main.feels_like);
    const wind = Math.round(toMph(w.wind?.speed || 0));
    const windDir = typeof w.wind?.deg === "number" && typeof RydRUtils !== "undefined" ? RydRUtils.compassLabel(w.wind.deg) : "";
    const visibilityMi = typeof w.visibility === "number" ? (w.visibility / 1609.34).toFixed(1) : null;
    const sunrise = w.sys?.sunrise ? new Date(w.sys.sunrise * 1000) : null;
    const sunset = w.sys?.sunset ? new Date(w.sys.sunset * 1000) : null;
    const fmtT = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

    const hourly = state.hourly.data;
    const stripHtml = Array.isArray(hourly) && hourly.length
      ? `<div class="wxc-hourly-row">${hourly.slice(0, 8).map((h) => `
          <div class="wxc-hour-card">
            <div class="wxc-hour-t">${esc(fmtHour(h.time))}</div>
            <div class="wxc-hour-i">${emoji(h.iconCode)}</div>
            <div class="wxc-hour-v">${Math.round(h.temp)}°</div>
            <div class="wxc-hour-p">${h.pop}%</div>
          </div>`).join("")}</div>`
      : statusHtml(state.hourly._lastReason || "empty");

    panel.innerHTML = `
      <div class="wxc-hero">
        <div class="wxc-hero-icon">${emoji(cond.id)}</div>
        <div>
          <div class="wxc-hero-temp">${temp}<span class="wxc-hero-unit">°${esc(tempUnit())}</span></div>
          <div class="wxc-hero-cond">${esc(cond.description)}</div>
          <div class="wxc-hero-feels">Feels like ${feels}°${w.main.humidity != null ? ` · ${w.main.humidity}% humidity` : ""}</div>
        </div>
      </div>
      <div class="wxc-stat-grid">
        <div class="wxc-stat"><div class="wxc-stat-icon">💨</div><div class="wxc-stat-val">${wind}</div><div class="wxc-stat-lbl">${esc(windUnit())}${windDir ? " " + esc(windDir) : ""}</div></div>
        <div class="wxc-stat"><div class="wxc-stat-icon">💧</div><div class="wxc-stat-val">${w.main.humidity ?? "—"}%</div><div class="wxc-stat-lbl">Humidity</div></div>
        <div class="wxc-stat"><div class="wxc-stat-icon">📊</div><div class="wxc-stat-val">${w.main.pressure ?? "—"}</div><div class="wxc-stat-lbl">hPa</div></div>
        <div class="wxc-stat"><div class="wxc-stat-icon">👁️</div><div class="wxc-stat-val">${visibilityMi ?? "—"}</div><div class="wxc-stat-lbl">Vis (mi)</div></div>
        <div class="wxc-stat"><div class="wxc-stat-icon">🌅</div><div class="wxc-stat-val">${sunrise ? esc(fmtT(sunrise)) : "—"}</div><div class="wxc-stat-lbl">Sunrise</div></div>
        <div class="wxc-stat"><div class="wxc-stat-icon">🌇</div><div class="wxc-stat-val">${sunset ? esc(fmtT(sunset)) : "—"}</div><div class="wxc-stat-lbl">Sunset</div></div>
      </div>
      <div class="wxc-section-title">Next Hours</div>
      ${stripHtml}
    `;
  }

  // ---------- Hourly ----------
  function renderHourlyPanel(panel) {
    const hourly = state.hourly.data;
    if (!Array.isArray(hourly) || !hourly.length) { panel.innerHTML = statusHtml(state.hourly._lastReason || "empty"); return; }
    panel.innerHTML = `
      <div class="wxc-section-title">Next ${hourly.length} Hours</div>
      <div class="wxc-hourly-row" style="flex-wrap:wrap;">
        ${hourly.map((h) => `
          <div class="wxc-hour-card">
            <div class="wxc-hour-t">${esc(fmtHour(h.time))}</div>
            <div class="wxc-hour-i">${emoji(h.iconCode)}</div>
            <div class="wxc-hour-v">${Math.round(h.temp)}°</div>
            <div class="wxc-hour-p">${h.pop}%</div>
          </div>`).join("")}
      </div>
    `;
  }

  // ---------- Daily (3-day / 7-day, shared renderer) ----------
  function renderDailyPanel(panel, cacheKey, title) {
    const daily = state[cacheKey].data;
    if (!Array.isArray(daily) || !daily.length) { panel.innerHTML = statusHtml(state[cacheKey]._lastReason || "empty"); return; }
    panel.innerHTML = `
      <div class="wxc-section-title">${esc(title)}</div>
      <div class="wxc-day-list">
        ${daily.map((d, i) => `
          <div class="wxc-day-row" data-day="${i}">
            <div class="wxc-day-name">${esc(fmtDay(d.date, i))}</div>
            <div class="wxc-day-icon">${emoji(d.iconCode)}</div>
            <div class="wxc-day-desc">${esc(d.description)}</div>
            <div class="wxc-day-pop">${d.pop ? d.pop + "%" : ""}</div>
            <div class="wxc-day-temps"><span class="hi">${d.hi}°</span> / <span class="lo">${d.lo}°</span></div>
            <div class="wxc-day-chevron">▸</div>
          </div>
          <div class="wxc-day-detail" data-day-detail="${i}" hidden>
            ${(d.entries || []).map((e) => `
              <div class="wxc-day-seg">
                <div class="wxc-day-seg-lbl">${esc(e.label || fmtHour(e.time))}</div>
                <div class="wxc-day-seg-icon">${emoji(e.iconCode)}</div>
                <div class="wxc-day-seg-t">${e.temp}°</div>
              </div>`).join("")}
          </div>
        `).join("")}
      </div>
    `;
    panel.querySelectorAll(".wxc-day-row").forEach((row) => {
      row.addEventListener("click", () => {
        const i = row.dataset.day;
        const detail = panel.querySelector(`[data-day-detail="${i}"]`);
        const open = !row.classList.contains("open");
        row.classList.toggle("open", open);
        if (detail) detail.hidden = !open;
      });
    });
  }

  // ---------- Radar ----------
  const RADAR_ZOOM = 7;
  const RADAR_GRID_N = 3;
  const RADAR_RADIUS = 1;
  function lonToTileXExact(lon, zoom) { return ((lon + 180) / 360) * Math.pow(2, zoom); }
  function latToTileYExact(lat, zoom) {
    const rad = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, zoom);
  }
  // Duplicates the tile-URL/max-zoom logic RydRRadar (js/radar.js) keeps
  // private to its own Google-Maps ImageMapType consumer — this plugin
  // renders its own tile grid (no Google Maps dependency), so it needs
  // the same construction rules for the two providers on the shared
  // timeline RydRRadar.fetchTimeline() already produces.
  function radarTileUrl(frame, x, y, zoom) {
    if (frame.provider === "rainbow") {
      return `/api/rainbow-tile?snapshot=${Math.round(frame.snapshot)}&forecastSec=${Math.round(frame.forecastSec)}&z=${zoom}&x=${x}&y=${y}`;
    }
    return `${frame.host}${frame.path}/256/${zoom}/${x}/${y}/2/1_1.png`;
  }
  function isLightTheme() {
    const b = document.body.classList;
    return b.contains("theme-light") || b.contains("theme-silver") || b.contains("theme-sand") || b.contains("theme-highvis");
  }
  function baseTileUrl(x, y, zoom) {
    const style = isLightTheme() ? "light_all" : "dark_all";
    return `https://basemaps.cartocdn.com/${style}/${zoom}/${x}/${y}.png`;
  }

  function buildRadarSkeleton(panel) {
    panel.innerHTML = `
      <div class="wxc-radar-wrap">
        <div class="wxc-radar-grid" style="grid-template-columns:repeat(${RADAR_GRID_N},1fr);grid-template-rows:repeat(${RADAR_GRID_N},1fr);" data-radar-grid></div>
        <div class="wxc-radar-controls">
          <button type="button" class="wxc-radar-play" data-radar-play>▶</button>
          <input type="range" class="wxc-radar-slider" data-radar-slider min="0" max="0" value="0" />
        </div>
        <div class="wxc-radar-label" data-radar-label>—</div>
        <div class="wxc-radar-legend"><span>Light</span><div class="wxc-radar-legend-bar"></div><span>Heavy</span></div>
        <div class="wxc-radar-attrib">Radar: RainViewer &amp; Rainbow.ai · Basemap © CARTO, © OpenStreetMap contributors</div>
      </div>
    `;
    return panel.querySelector(".wxc-radar-wrap");
  }

  function renderRadarFrame(panel) {
    const grid = panel.querySelector("[data-radar-grid]");
    const label = panel.querySelector("[data-radar-label]");
    const slider = panel.querySelector("[data-radar-slider]");
    if (!grid) return;
    const loc = state.loc;
    const timeline = state.radar.timeline;
    if (!loc || !timeline.length) return;

    const xExact = lonToTileXExact(loc.lng, RADAR_ZOOM);
    const yExact = latToTileYExact(loc.lat, RADAR_ZOOM);
    const centerX = Math.floor(xExact);
    const centerY = Math.floor(yExact);
    const n = Math.pow(2, RADAR_ZOOM);
    const wrapX = (x) => ((x % n) + n) % n;
    const fracX = xExact - centerX;
    const fracY = yExact - centerY;

    const idx = Math.min(timeline.length - 1, Math.max(0, state.radar.index));
    state.radar.index = idx;
    const entry = timeline[idx];
    const hasFrame = typeof RydRRadar !== "undefined" && RydRRadar.hasFrame ? RydRRadar.hasFrame(idx) : !!entry?.frame;
    const frame = entry && entry.frame;

    let tilesHtml = "";
    for (let dy = -RADAR_RADIUS; dy <= RADAR_RADIUS; dy++) {
      for (let dx = -RADAR_RADIUS; dx <= RADAR_RADIUS; dx++) {
        const tx = wrapX(centerX + dx);
        const ty = Math.min(n - 1, Math.max(0, centerY + dy));
        const base = baseTileUrl(tx, ty, RADAR_ZOOM);
        const overlay = hasFrame && frame ? radarTileUrl(frame, tx, ty, RADAR_ZOOM) : null;
        tilesHtml += `<div class="wxc-radar-tile"><img class="base" src="${base}" loading="lazy" onerror="this.style.opacity=0" />${
          overlay ? `<img class="overlay" src="${overlay}" loading="lazy" onerror="this.style.opacity=0" />` : ""
        }</div>`;
      }
    }
    const markerXPct = ((RADAR_RADIUS + fracX) / RADAR_GRID_N) * 100;
    const markerYPct = ((RADAR_RADIUS + fracY) / RADAR_GRID_N) * 100;
    grid.innerHTML = tilesHtml + `<div class="wxc-radar-marker" style="left:${markerXPct}%;top:${markerYPct}%;"></div>`;

    if (label) label.textContent = typeof RydRRadar !== "undefined" && RydRRadar.labelFor ? RydRRadar.labelFor(idx) : "—";
    if (slider) {
      slider.max = String(timeline.length - 1);
      slider.value = String(idx);
    }
  }

  function renderRadarPanel(panel) {
    if (!state.loc) { panel.innerHTML = statusHtml("no-location"); return; }
    if (!state.radar.timeline.length) { panel.innerHTML = statusHtml(state.radar._lastReason || "no-radar-module"); return; }
    if (!panel.querySelector("[data-radar-grid]")) {
      buildRadarSkeleton(panel);
      const playBtn = panel.querySelector("[data-radar-play]");
      const slider = panel.querySelector("[data-radar-slider]");
      playBtn?.addEventListener("click", () => togglePlay(panel, playBtn));
      slider?.addEventListener("input", () => {
        stopPlay(panel, playBtn);
        state.radar.index = Number(slider.value);
        renderRadarFrame(panel);
      });
      if (getSettings().radarAutoplay) togglePlay(panel, playBtn);
    }
    renderRadarFrame(panel);
  }

  function stopPlay(panel, playBtn) {
    state.radar.playing = false;
    if (state.radar.playTimer) clearInterval(state.radar.playTimer);
    state.radar.playTimer = null;
    if (playBtn) playBtn.textContent = "▶";
  }
  function togglePlay(panel, playBtn) {
    if (state.radar.playing) { stopPlay(panel, playBtn); return; }
    state.radar.playing = true;
    playBtn.textContent = "⏸";
    state.radar.playTimer = setInterval(() => {
      if (!panel.isConnected) { stopPlay(panel, playBtn); return; }
      const timeline = state.radar.timeline;
      if (!timeline.length) return;
      let next = state.radar.index;
      for (let i = 0; i < timeline.length; i++) {
        next = (next + 1) % timeline.length;
        const usable = typeof RydRRadar !== "undefined" && RydRRadar.hasFrame ? RydRRadar.hasFrame(next) : true;
        if (usable) break;
      }
      state.radar.index = next;
      renderRadarFrame(panel);
    }, 700);
  }

  // ---------- Alerts ----------
  const SEVERITY_COLOR = {
    Extreme: "var(--alert-red)",
    Severe: "color-mix(in srgb, var(--alert-red) 55%, var(--warn-amber) 45%)",
    Moderate: "var(--warn-amber)",
    Minor: "var(--neon-green)",
    Unknown: "var(--text-muted)",
  };
  function renderAlertsPanel(panel) {
    const alerts = state.alerts.data;
    if (!Array.isArray(alerts)) { panel.innerHTML = statusHtml(state.alerts._lastReason || "empty"); return; }
    if (!alerts.length) {
      panel.innerHTML = `
        <div class="wxc-ok-banner"><span class="wxc-ok-banner-icon">✅</span><div>No active watches or warnings for your area right now.</div></div>
        <div class="wxc-empty" style="padding-top:6px;">Alerts are sourced from the National Weather Service and only cover the United States.</div>
      `;
      return;
    }
    panel.innerHTML = alerts
      .map((a) => {
        const color = SEVERITY_COLOR[a.severity] || SEVERITY_COLOR.Unknown;
        const start = a.start ? new Date(a.start).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
        const end = a.end ? new Date(a.end).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
        return `
          <div class="wxc-alert-card" style="--wxc-a-color:${color};">
            <div class="wxc-alert-top"><span class="wxc-alert-sev">${esc(a.severity || "Alert")}</span></div>
            <div class="wxc-alert-title">${esc(a.event || "Weather Alert")}</div>
            <div class="wxc-alert-time">${start ? esc(start) : ""}${end ? " → " + esc(end) : ""}</div>
            <div class="wxc-alert-desc">${esc(a.description || "")}</div>
            ${a.sourceUrl ? `<a class="wxc-alert-link" href="weather-alert.html?url=${encodeURIComponent(a.sourceUrl)}">View Full Alert →</a>` : ""}
          </div>`;
      })
      .join("");
  }

  // ---------- Riding conditions ----------
  function renderRidingPanel(panel) {
    const w = state.current.data;
    const hourly = state.hourly.data;
    const daily = state.daily3.data;
    if (!w) { panel.innerHTML = statusHtml(state.current._lastReason || "empty"); return; }

    const today = Array.isArray(daily) && daily[0] ? daily[0] : null;
    const nowScore = computeRideScore({
      tempF: units() === "metric" ? w.main.temp * 1.8 + 32 : w.main.temp,
      windMph: toMph(w.wind?.speed || 0),
      pop: today ? today.pop : 0,
      visibilityM: typeof w.visibility === "number" ? w.visibility : null,
      conditionId: w.weather[0].id,
    });

    let stripHtml = "";
    let bestHtml = "";
    if (Array.isArray(hourly) && hourly.length) {
      const scored = hourly.map((h) => ({
        h,
        r: computeRideScore({ tempF: units() === "metric" ? h.temp * 1.8 + 32 : h.temp, pop: h.pop, conditionId: h.iconCode }),
      }));
      stripHtml = `
        <div class="wxc-section-title">Next ${hourly.length} Hours</div>
        <div class="wxc-ride-strip">${scored
          .map(
            ({ h, r }) => `<div class="wxc-ride-chip" style="background:${r.color};"><div class="t">${esc(fmtHour(h.time))}</div><div class="s">${r.score}</div></div>`
          )
          .join("")}</div>
      `;
      const best = scored.reduce((a, b) => (b.r.score > a.r.score ? b : a), scored[0]);
      if (best && best.r.score >= 65) {
        bestHtml = `<div class="wxc-ride-best">🏍️ Best window in the next ${hourly.length}h: <b>${esc(fmtHour(best.h.time))}</b> (${best.r.label}, score ${best.r.score})</div>`;
      }
    }

    panel.innerHTML = `
      <div class="wxc-ride-hero" style="--wxc-r-color:${nowScore.color};">
        <div class="wxc-ride-badge">${nowScore.badge}</div>
        <div style="flex:1;">
          <div class="wxc-ride-label">${esc(nowScore.label)}</div>
          <div class="wxc-ride-score">${nowScore.score}<span style="font-size:14px;opacity:.6;">/100</span></div>
          <div class="wxc-ride-bar-track"><div class="wxc-ride-bar-fill" style="width:${nowScore.score}%;"></div></div>
        </div>
      </div>
      ${bestHtml}
      <div class="wxc-section-title">Right Now</div>
      <ul class="wxc-ride-notes">
        ${nowScore.notes.length ? nowScore.notes.map((n) => `<li>${esc(n)}</li>`).join("") : `<li>No major concerns — normal riding precautions apply.</li>`}
      </ul>
      ${stripHtml}
    `;
  }

  // ======================================================================
  // Screen orchestration
  // ======================================================================
  function panelFetchers() {
    return {
      now: () => Promise.all([fetchCurrent(false), fetchHourly(false)]),
      hourly: () => fetchHourly(false),
      "3day": () => fetchDaily(3, false),
      "7day": () => fetchDaily(7, false),
      radar: () => ensureRadarTimeline(false),
      alerts: () => fetchAlerts(false),
      riding: () => Promise.all([fetchCurrent(false), fetchHourly(false), fetchDaily(3, false)]),
    };
  }
  function panelRenderers(panel, panels) {
    return {
      now: () => renderNowPanel(panels.now),
      hourly: () => renderHourlyPanel(panels.hourly),
      "3day": () => renderDailyPanel(panels["3day"], "daily3", "Next 3 Days"),
      "7day": () => renderDailyPanel(panels["7day"], "daily7", "Next 7 Days"),
      radar: () => renderRadarPanel(panels.radar),
      alerts: () => renderAlertsPanel(panels.alerts),
      riding: () => renderRidingPanel(panels.riding),
    };
  }

  function mountScreen(container, dbg) {
    const root = buildScreenSkeleton(container);
    const panels = {};
    TABS.forEach((t) => (panels[t.id] = root.querySelector(`[data-panel="${t.id}"]`)));
    const renderers = panelRenderers(root, panels);
    const fetchers = panelFetchers();
    const loadedTabs = new Set();
    let activeTab = "now";

    function updateAlertBadge() {
      const count = (state.alerts.data || []).length;
      const badge = root.querySelector('[data-badge="alerts"]');
      const tabBtn = root.querySelector('[data-tab="alerts"]');
      if (badge) {
        badge.hidden = !count;
        badge.textContent = String(count);
      }
      if (tabBtn) tabBtn.classList.toggle("has-alert", !!count);
    }

    function updateLocLabel() {
      const el = root.querySelector("[data-wxc-loc]");
      if (!el) return;
      const w = state.current.data;
      if (w && w.name) el.textContent = `📍 ${w.name}`;
      else if (state.loc) el.textContent = `📍 ${state.loc.lat.toFixed(3)}, ${state.loc.lng.toFixed(3)}`;
      else el.textContent = "Locating…";
    }

    function loadTab(id, force) {
      const fetcher = fetchers[id];
      if (!fetcher) return;
      dbg.guardAsync(
        Promise.resolve(fetcher(force)).then(() => {
          if (!panels[id].isConnected) return;
          renderers[id]();
          if (id === "now" || id === "alerts") updateAlertBadge();
          if (id === "now") updateLocLabel();
        }),
        `loadTab:${id}`
      );
    }

    function activateTab(id) {
      activeTab = id;
      root.querySelectorAll(".wxc-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
      Object.keys(panels).forEach((k) => (panels[k].hidden = k !== id));
      if (!loadedTabs.has(id)) {
        loadedTabs.add(id);
        loadTab(id, false);
      } else {
        renderers[id]();
      }
    }

    root.querySelectorAll(".wxc-tab").forEach((btn) => {
      btn.addEventListener("click", () => activateTab(btn.dataset.tab));
    });
    root.querySelector("[data-wxc-refresh]")?.addEventListener("click", () => {
      loadTab(activeTab, true);
    });

    ensureLocation().then(() => {
      updateLocLabel();
      activateTab("now");
      // Alerts run quietly in the background regardless of which tab is
      // active so the tab badge/highlight can flag something active
      // without the rider having to open the Alerts tab first.
      fetchAlerts(false).then(() => {
        if (root.isConnected) updateAlertBadge();
      });
    });

    // Periodic refresh of whichever tab is currently visible, self-
    // cancelling once the overlay is closed (closePluginScreen() just
    // detaches the DOM node — there's no destroy hook for a plugin screen
    // to hook into, so isConnected is the cheap way to notice).
    const interval = setInterval(() => {
      if (!root.isConnected) { clearInterval(interval); return; }
      loadTab(activeTab, false);
      fetchAlerts(false).then(() => {
        if (root.isConnected) updateAlertBadge();
      });
    }, 2 * 60 * 1000);
  }

  // ======================================================================
  // Settings tab
  // ======================================================================
  function renderSettingsTab(container) {
    const s = getSettings();
    container.innerHTML = `
      <div class="panel-title" style="margin-bottom:8px;">Weather Command</div>
      <p class="modal-desc">Configure the comprehensive weather dashboard card and full-screen forecast view.</p>

      <label class="settings-row">
        <span>Hourly forecast window</span>
        <select id="wxcHoursSelect" class="wxc-settings-select">
          <option value="12">Next 12 hours</option>
          <option value="24">Next 24 hours</option>
          <option value="48">Next 48 hours</option>
        </select>
      </label>

      <label class="settings-row">
        <span>Show hourly strip on dashboard card</span>
        <input type="checkbox" id="wxcCardStripToggle" />
      </label>

      <label class="settings-row">
        <span>Auto-play radar on open</span>
        <input type="checkbox" id="wxcRadarAutoplayToggle" />
      </label>

      <small style="display:block; font-size:11px; color:var(--text-muted); margin-top:10px;">
        Current/hourly/daily forecasts are sourced from OpenWeatherMap. Watches &amp; warnings are sourced from the
        National Weather Service (United States only). Riding condition scores are a heuristic estimate, not an
        official rideability index — always use your own judgment.
      </small>
    `;
    const hoursSel = container.querySelector("#wxcHoursSelect");
    const stripToggle = container.querySelector("#wxcCardStripToggle");
    const autoplayToggle = container.querySelector("#wxcRadarAutoplayToggle");
    hoursSel.value = String(s.hourlyHours);
    stripToggle.checked = s.cardHourlyStrip;
    autoplayToggle.checked = s.radarAutoplay;

    hoursSel.addEventListener("change", () => {
      saveSettings({ ...getSettings(), hourlyHours: Number(hoursSel.value) });
      state.hourly.at = 0; // force a re-fetch at the new window size next render
    });
    stripToggle.addEventListener("change", () => {
      saveSettings({ ...getSettings(), cardHourlyStrip: stripToggle.checked });
    });
    autoplayToggle.addEventListener("change", () => {
      saveSettings({ ...getSettings(), radarAutoplay: autoplayToggle.checked });
    });
  }

  // ======================================================================
  // Screensaver widget
  // ======================================================================
  const screensaverWidget = {
    id: "weather-command-widget",
    label: "Weather",
    render: function () {
      return `<div class="screensaver-widget" data-widget="weather-command-widget">
        <div class="screensaver-value screensaver-value-sm">--°</div>
        <div class="screensaver-label">WEATHER</div>
      </div>`;
    },
    update: function (el) {
      const valueEl = el.querySelector(".screensaver-value");
      const labelEl = el.querySelector(".screensaver-label");
      const w = state.current.data;
      if (!w) return;
      if (valueEl) valueEl.textContent = `${Math.round(w.main.temp)}°${tempUnit()}`;
      if (labelEl && typeof RydRUtils !== "undefined") labelEl.textContent = `${RydRUtils.weatherEmoji(w.weather[0].id)} ${w.weather[0].main.toUpperCase()}`;
    },
  };

  // ======================================================================
  // Plugin object
  // ======================================================================
  const plugin = {
    id: PLUGIN_ID,
    name: "Weather Command",
    description: "One weather plugin for everything: current conditions, hour-by-hour and 3/7-day forecasts, local radar, active NWS watches & warnings, and a motorcycle-specific riding conditions score.",
    version: "1.0.0",
    icon: "🌦️",
    category: "weather",
    standalone: true,

    render: function (container, payload) {
      // A dedicated console for the card (not shared with the full-screen
      // view below) — RydRDebugConsole.create() returns one DOM node, and
      // sharing it between the persistent dashboard card and the
      // ephemeral full-screen overlay would silently reparent (move) that
      // node out of whichever one didn't render last.
      const dbg = state.cardDbg || (state.cardDbg = RydRDebugConsole.create({ id: plugin.id, title: plugin.name }));
      let cardEl = container.querySelector(".wxc-card");
      const firstBuild = !cardEl;
      ensureStyles();
      if (firstBuild) {
        cardEl = buildCardSkeleton(container);
        container.appendChild(dbg.el);
      }
      dbg.guardAsync(
        Promise.all([fetchCurrent(false), fetchHourly(false), fetchDaily(3, false), fetchAlerts(false)]).then(() => {
          if (!cardEl.isConnected) return;
          renderCardContent(cardEl);
        }),
        "card render"
      );
    },

    screen: {
      id: "weather-command-screen",
      title: "Weather Command",
      render: function (container) {
        ensureStyles();
        // A fresh console each time the overlay opens (the overlay itself
        // is torn down and rebuilt from scratch by the shell on every
        // open/close — see js/plugins.js's openPluginScreen/closePluginScreen)
        // rather than reusing the card's dbg instance — see the note above.
        const dbg = RydRDebugConsole.create({ id: `${plugin.id}-screen`, title: `${plugin.name} — Full View` });
        container.appendChild(dbg.el);
        dbg.guard(() => mountScreen(container, dbg), "mountScreen");
      },
    },

    menuItem: {
      id: "weather-command-menu-item",
      label: "Weather Command",
      icon: "🌦️",
      targetScreenId: "weather-command-screen",
    },

    screensaverWidgets: [screensaverWidget],

    settingsTab: {
      id: "weather-command",
      label: "Weather Command",
      render: renderSettingsTab,
    },
  };

  const runtimeKey = "__RydRPluginRuntime__";
  root[runtimeKey] = root[runtimeKey] || {};
  root[runtimeKey][plugin.id] = plugin;
})(window);
