// Ride Pulse: reimagined as a physical motorcycle instrument cluster
// instead of a grid of stat tiles — a halogen speedometer arc, a lean
// gauge that actually tilts a bike glyph left/right, a heading compass,
// an idiot-light REC indicator, and an all-time "logbook" with a
// mechanical rolling-digit odometer. See css/style.css's "Ride Pulse:
// instrument-cluster redesign" block for the full visual system.
(function (root) {
  // All-time stats require summing every saved ride, which isn't cheap to
  // redo on every render() call — this plugin's render() is invoked on
  // every telemetry tick (GPS fix), same as the live speed/heading fields.
  // Compute in the background on a slow interval and just read the cached
  // result synchronously each render; a ride only finishes occasionally,
  // so the numbers don't need to be fresher than that anyway.
  let allTimeCache = null;
  let allTimeCacheAt = 0;
  let allTimeFetchOk = true; // did the most recent computeAllTimeStats() attempt actually succeed?
  let allTimeFetchInFlight = false;
  const ALLTIME_REFRESH_MS = 30000;
  // A *failed* attempt gets retried much sooner than a normal successful
  // refresh — an unexpected error out of RydRStorage.listRides() (a
  // transient OPFS/IndexedDB read glitch, say) shouldn't cache as a stale
  // "no data" result for a full 30s. Retrying every 5s instead means the
  // logbook recovers quickly without hammering listRides() on every
  // single GPS-tick render() call in the meantime.
  const ALLTIME_RETRY_MS = 5000;

  function parseTemp(str) {
    if (!str) return null;
    const m = String(str).match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  function tempUnitFromStr(str) {
    return str && String(str).includes('°C') ? '°C' : '°F';
  }

  // A merged ride (history.js's "Combine Trips") re-sums its source rides'
  // distance/duration/etc into a new ride, but the original source rides
  // stay in storage too — counting both would double every mile and
  // minute that was ever part of a merge. Only the merge result (or an
  // ordinary, never-merged ride) should count toward the all-time totals.
  function excludeMergedSources(rides) {
    const mergedSourceIds = new Set();
    rides.forEach((r) => {
      if (Array.isArray(r.mergedFrom)) r.mergedFrom.forEach((id) => mergedSourceIds.add(id));
    });
    return rides.filter((r) => !mergedSourceIds.has(r.id));
  }

  async function computeAllTimeStats() {
    const allRides = await RydRStorage.listRides();
    const rides = excludeMergedSources(allRides.filter((r) => r.endTime != null));
    if (!rides.length) {
      // Rides always live in primary storage (OPFS — see js/storage.js's
      // module comment), which doesn't depend on any backup folder's
      // permission state, so an empty result here is always trustworthy
      // as "no rides yet" — no reconnect-prompt special case needed.
      return { rideCount: 0 };
    }

    let totalMiles = 0, totalRideMs = 0, topSpeed = 0, totalStopMs = 0, totalStopsCount = 0;
    let tempSum = 0, tempCount = 0, tempHigh = -Infinity, tempLow = Infinity, tempUnit = '';

    rides.forEach((r) => {
      totalMiles += Number(r.distance) || 0;
      totalRideMs += Number(r.duration) || 0;
      topSpeed = Math.max(topSpeed, Number(r.maxSpeed) || 0);
      (r.stops || []).forEach((s) => {
        if (s.arrival != null && s.departure != null) {
          totalStopMs += s.departure - s.arrival;
          totalStopsCount++;
        }
      });
      [r.weatherAtStart, r.weatherAtEnd].forEach((w) => {
        const t = parseTemp(w && w.temp);
        if (t != null) {
          tempSum += t;
          tempCount++;
          tempHigh = Math.max(tempHigh, t);
          tempLow = Math.min(tempLow, t);
          if (!tempUnit) tempUnit = tempUnitFromStr(w.temp);
        }
      });
    });

    return {
      rideCount: rides.length,
      odometerMiles: totalMiles,
      topSpeedMph: topSpeed,
      avgSpeedMph: totalRideMs > 0 ? totalMiles / (totalRideMs / 3600000) : 0,
      avgTemp: tempCount ? tempSum / tempCount : null,
      tempHigh: tempCount ? tempHigh : null,
      tempLow: tempCount ? tempLow : null,
      tempUnit,
      totalRideMs,
      totalStopMs,
      avgStopMs: totalStopsCount ? totalStopMs / totalStopsCount : 0,
      avgMilesPerRide: totalMiles / rides.length,
    };
  }

  function scheduleAllTimeRefresh() {
    if (typeof RydRStorage === 'undefined' || allTimeFetchInFlight) return;
    if (allTimeCacheAt) {
      const staleAfter = allTimeFetchOk ? ALLTIME_REFRESH_MS : ALLTIME_RETRY_MS;
      if (Date.now() - allTimeCacheAt < staleAfter) return;
    }
    allTimeFetchInFlight = true;
    computeAllTimeStats()
      .then((stats) => { allTimeCache = stats; allTimeCacheAt = Date.now(); allTimeFetchOk = true; })
      .catch((e) => {
        // Never let a real failure vanish with no trace — an unconditional
        // .catch(() => {}) here used to eat every error silently, so a
        // genuine, ongoing storage problem left the logbook empty forever
        // with nothing in devtools to explain why. allTimeCache is
        // deliberately left untouched: a previously-successful reading
        // stays on screen instead of getting blanked out by one bad
        // attempt (see ALLTIME_RETRY_MS above for how soon this retries).
        console.warn('RydRPlugin(ridepulse): all-time stats refresh failed —', (e && e.message) || e);
        allTimeCacheAt = Date.now();
        allTimeFetchOk = false;
      })
      .finally(() => { allTimeFetchInFlight = false; });
  }

  function fmtMiles(v) {
    return v == null ? '—' : v.toFixed(1);
  }
  function fmtMph(v) {
    return v == null ? '—' : Math.round(v).toString();
  }
  function fmtTemp(v, unit) {
    return v == null ? '—' : `${Math.round(v)}${unit || '°F'}`;
  }
  function fmtDur(ms) {
    return ms == null || ms <= 0 ? '—' : RydRUtils.fmtDuration(ms);
  }

  // ---------- speed gauge (halogen arc, 0-160mph) ----------
  // Static 180° arc path shared by the track and the fill; pathLength="100"
  // lets the fill's dash offset be expressed as a plain 0-100 percentage
  // instead of hand-computing the real geometric arc length.
  const SPEED_ARC_D = 'M15 100 A85 85 0 0 1 185 100';
  const SPEED_GAUGE_MAX = 160;
  // Static tick marks at 0/25/50/75/100% around the same arc.
  const SPEED_TICKS = [
    [15, 100, 28, 100],
    [39.9, 39.9, 49.1, 49.1],
    [100, 15, 100, 28],
    [160.1, 39.9, 150.9, 49.1],
    [185, 100, 172, 100],
  ];

  function renderSpeedSvg(speedMph, isRecording) {
    const frac = Math.max(0, Math.min(1, speedMph / SPEED_GAUGE_MAX));
    const dashOffset = (100 - frac * 100).toFixed(2);
    const redline = frac > 0.85;
    const ticks = SPEED_TICKS.map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="rp-speed-tick"/>`).join('');
    return `
      <svg class="rp-speed-svg" viewBox="0 0 200 108" aria-hidden="true">
        <path class="rp-speed-track" d="${SPEED_ARC_D}"/>
        <path class="rp-speed-fill${redline ? ' is-redline' : ''}" d="${SPEED_ARC_D}" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${dashOffset}"/>
        ${ticks}
      </svg>
    `;
  }

  // ---------- lean gauge (horizon dial, bike glyph tilts with you) ----------
  function renderLeanGauge(leanSigned) {
    const supported = leanSigned != null && Number.isFinite(leanSigned);
    const clamped = supported ? Math.max(-45, Math.min(45, leanSigned)) : 0;
    const label = supported ? `${Math.abs(clamped).toFixed(0)}°` : 'N/A';
    return `
      <div class="rp-mini-gauge rp-lean-gauge">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="29" class="rp-mini-face"/>
          <line x1="8" y1="32" x2="56" y2="32" class="rp-mini-horizon"/>
          <g class="rp-bike-glyph${supported ? '' : ' is-flat'}" style="transform:rotate(${clamped}deg)">
            <circle cx="20" cy="42" r="6" class="rp-bike-wheel"/>
            <circle cx="44" cy="42" r="6" class="rp-bike-wheel"/>
            <path d="M20 42 L30 24 L44 42 M30 24 L34 18" class="rp-bike-frame"/>
          </g>
        </svg>
        <div class="rp-mini-label">LEAN<b>${label}</b></div>
      </div>
    `;
  }

  // ---------- heading gauge (fixed compass, rotating needle) ----------
  function renderHeadingGauge(headingStr) {
    const degMatch = /(-?\d+(?:\.\d+)?)/.exec(headingStr || '');
    const deg = degMatch ? Number(degMatch[1]) : null;
    const cardMatch = /([NSEW]{1,2})\s*$/.exec(headingStr || '');
    const cardinal = cardMatch ? cardMatch[1] : '--';
    return `
      <div class="rp-mini-gauge rp-heading-gauge">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="29" class="rp-mini-face"/>
          <text x="32" y="12" class="rp-compass-n">N</text>
          <line x1="32" y1="6" x2="32" y2="12" class="rp-mini-tick"/>
          <line x1="32" y1="52" x2="32" y2="58" class="rp-mini-tick"/>
          <line x1="6" y1="32" x2="12" y2="32" class="rp-mini-tick"/>
          <line x1="52" y1="32" x2="58" y2="32" class="rp-mini-tick"/>
          <g class="rp-compass-needle" style="transform:rotate(${deg != null ? deg : 0}deg)">
            <path d="M32 12 L37 34 L32 30 L27 34 Z" class="rp-needle-shape"/>
          </g>
        </svg>
        <div class="rp-mini-label">HDG<b>${deg != null ? Math.round(deg) + '° ' : ''}${cardinal}</b></div>
      </div>
    `;
  }

  function renderRecLight(isRecording) {
    return `
      <div class="rp-rec-light${isRecording ? ' is-recording' : ''}">
        <span class="rp-rec-dot"></span>
        <span class="rp-rec-text">${isRecording ? 'RECORDING' : 'STANDBY'}</span>
      </div>
    `;
  }

  function renderPlacards(telemetry) {
    const hasCondition = telemetry.condition && telemetry.condition !== '—';
    const weatherText = hasCondition ? `${telemetry.weather} · ${telemetry.condition}` : telemetry.weather || '—';
    return `
      <div class="rp-placards">
        <div class="rp-placard">
          <span class="rp-placard-icon" aria-hidden="true">🌡️</span>
          <div>
            <div class="rp-placard-label">Weather</div>
            <div class="rp-placard-value">${weatherText}</div>
          </div>
        </div>
        <div class="rp-placard">
          <span class="rp-placard-icon" aria-hidden="true">🛣️</span>
          <div>
            <div class="rp-placard-label">Route</div>
            <div class="rp-placard-value">${telemetry.distance || '—'}</div>
          </div>
        </div>
      </div>
    `;
  }

  // ---------- all-time "logbook" (mechanical odometer + spec sheet) ----------
  function renderOdometer(miles) {
    const safe = Math.max(0, Number(miles) || 0);
    const whole = Math.floor(safe);
    const tenths = Math.round((safe - whole) * 10) % 10;
    const digits = String(whole).padStart(5, '0').split('');
    return `
      <div class="rp-odometer" role="img" aria-label="All-time odometer: ${safe.toFixed(1)} miles">
        ${digits.map((d) => `<span class="rp-odo-digit">${d}</span>`).join('')}
        <span class="rp-odo-tenths">${tenths}</span>
        <span class="rp-odo-unit">MI</span>
      </div>
    `;
  }

  function renderLogbook(stats) {
    if (!stats || !stats.rideCount) {
      return `
        <div class="rp-logbook">
          <div class="rp-logbook-title">All-Time Log</div>
          <div class="rp-logbook-empty">No completed rides yet — your log fills in after your first ride.</div>
        </div>
      `;
    }
    const specs = [
      ['Top Speed', `${fmtMph(stats.topSpeedMph)} mph`],
      ['Avg Speed', `${fmtMph(stats.avgSpeedMph)} mph`],
      ['Avg Temp', fmtTemp(stats.avgTemp, stats.tempUnit)],
      ['Temp High', fmtTemp(stats.tempHigh, stats.tempUnit)],
      ['Temp Low', fmtTemp(stats.tempLow, stats.tempUnit)],
      ['Time Riding', fmtDur(stats.totalRideMs)],
      ['Time Stopped', fmtDur(stats.totalStopMs)],
      ['Avg Stop', fmtDur(stats.avgStopMs)],
      ['Avg Ride', `${fmtMiles(stats.avgMilesPerRide)} mi`],
    ];
    return `
      <div class="rp-logbook">
        <div class="rp-logbook-title">All-Time Log <span>· ${stats.rideCount} ride${stats.rideCount === 1 ? '' : 's'}</span></div>
        ${renderOdometer(stats.odometerMiles)}
        <div class="rp-spec-sheet">
          ${specs.map(([k, v]) => `<div class="rp-spec-row"><span class="rp-spec-k">${k}</span><span class="rp-spec-v">${v}</span></div>`).join('')}
        </div>
      </div>
    `;
  }

  const plugin = {
    id: 'ridepulse',
    name: 'Ride Pulse',
    description: 'A motorcycle instrument cluster for speed, lean, and heading, plus an all-time logbook across every saved ride.',
    version: '2.0.0',
    // Own full-bleed card look, no generic icon/title header bar — same
    // opt-in chase-cam-3d/apex-drag/spotify-playlists/hourly-precip
    // already use. .rp-cluster was always styled to look like one of
    // these bespoke cards (see the CSS comment above .rp-cluster in
    // css/style.css); this was the missing flag to actually get there.
    standalone: true,
    render: function (container, payload) {
      scheduleAllTimeRefresh();
      const telemetry = payload && payload.telemetry ? payload.telemetry : {};
      const speed = Math.max(0, Number(telemetry.speed) || 0);
      container.innerHTML = `
        <div class="rp-cluster">
          <div class="rp-hero">
            <div class="rp-speed-gauge">
              ${renderSpeedSvg(speed, telemetry.isRecording)}
              <div class="rp-speed-readout">
                <span class="rp-speed-num">${Math.round(speed)}</span>
                <span class="rp-speed-unit">MPH</span>
              </div>
            </div>
            <div class="rp-hero-side">
              ${renderRecLight(telemetry.isRecording)}
              ${renderLeanGauge(telemetry.leanSigned)}
              ${renderHeadingGauge(telemetry.heading)}
            </div>
          </div>
          ${renderPlacards(telemetry)}
          <div class="rp-road-divider" aria-hidden="true"><div class="rp-lane-line"></div></div>
          ${renderLogbook(allTimeCache)}
        </div>
      `;
    }
  };

  const runtimeKey = '__RydRPluginRuntime__';
  root[runtimeKey] = root[runtimeKey] || {};
  root[runtimeKey][plugin.id] = plugin;
})(window);
