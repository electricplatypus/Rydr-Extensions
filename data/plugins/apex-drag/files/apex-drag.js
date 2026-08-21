(function (root) {
  const STORAGE_KEY = 'rydr_apex_drag_logs';
  const CONFIG_KEY = 'rydr_apex_drag_config';

  // Polyfill for Canvas roundRect
  if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
      const r = typeof radii === 'number' ? radii : (Array.isArray(radii) ? radii[0] : 0);
      this.beginPath();
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
      return this;
    };
  }

  // Available performance targets
  const TARGETS = {
    'quarter': { label: '1/4 Mile', distMiles: 0.25, distFeet: 1320, type: 'distance' },
    'half': { label: '1/2 Mile', distMiles: 0.50, distFeet: 2640, type: 'distance' },
    'mile': { label: '1 Mile', distMiles: 1.00, distFeet: 5280, type: 'distance' },
    '0-60': { label: '0-60 MPH', speedMph: 60, type: 'speed' },
    '0-100': { label: '0-100 MPH', speedMph: 100, type: 'speed' }
  };

  // State machine: 'IDLE' | 'COUNTDOWN' | 'ARMED' | 'RUNNING' | 'FINISHED'
  let state = {
    mode: 'IDLE',
    targetKey: 'quarter',
    launchMode: '10', // 'motion' | '10' | '30' | '60' | 'custom'
    customCountdownSec: 10,
    countdownRemainingSec: 0,
    countdownTimer: null,
    armedTime: null,
    startTime: null,
    endTime: null,
    topSpeed: 0,
    currentSpeed: 0,
    accumulatedFeet: 0,
    lastTime: null,
    samples: [],
    lastRun: null,
  };

  function getLogs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveLog(run) {
    const logs = getLogs();
    logs.unshift(run);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(0, 100)));
  }

  function deleteLog(id) {
    const logs = getLogs().filter(r => r.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  }

  function getConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      return raw ? JSON.parse(raw) : { targetKey: 'quarter', launchMode: '10', customCountdownSec: 10 };
    } catch (e) {
      return { targetKey: 'quarter', launchMode: '10', customCountdownSec: 10 };
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  }

  function fmtET(ms) {
    if (ms == null || isNaN(ms)) return '--.--s';
    return (ms / 1000).toFixed(3) + 's';
  }

  function fmtDate(iso) {
    if (!iso) return 'Recent Run';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Recent Run';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' at ' +
           d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  // Haversine distance in feet
  function haversineFeet(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity;
    const R = 3958.8 * 5280; // Earth radius in feet
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function generateSocialCard(run) {
    if (!run) return '';
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 340;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 600, 340);
    grad.addColorStop(0, '#0a0e17');
    grad.addColorStop(1, '#1a2332');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 600, 340);

    // Accent line
    ctx.fillStyle = '#ff9100';
    ctx.fillRect(0, 0, 600, 6);

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px -apple-system, sans-serif';
    ctx.fillText('⚡ APEX TELEMETRY RECORD', 30, 45);

    ctx.fillStyle = '#9ca3af';
    ctx.font = '14px sans-serif';
    ctx.fillText(`${run.targetLabel || '1/4 Mile'} • ${run.location || 'Deals Gap, NC'}`, 30, 70);

    // Top Speed Box
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.roundRect(30, 95, 250, 110, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.stroke();

    ctx.fillStyle = '#ff9100';
    ctx.font = 'bold 48px sans-serif';
    ctx.fillText(`${run.topSpeed || 0}`, 50, 160);
    ctx.fillStyle = '#9ca3af';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('TOP SPEED (MPH)', 50, 185);

    // ET Box
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.roundRect(310, 95, 260, 110, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.stroke();

    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 48px sans-serif';
    ctx.fillText(fmtET(run.etMs), 330, 160);
    ctx.fillStyle = '#9ca3af';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('ELAPSED TIME (SEC)', 330, 185);

    // Footer stats
    ctx.fillStyle = '#d1d5db';
    ctx.font = '13px sans-serif';
    ctx.fillText(`📅 Date: ${fmtDate(run.dateIso)}`, 30, 240);
    ctx.fillText(`📍 Location: ${run.location || 'Deals Gap, NC'}`, 30, 265);

    ctx.fillStyle = '#1db954';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('RydR Ride Companion • Performance Verified', 30, 310);

    return canvas.toDataURL('image/png');
  }

  function startLaunchSequence(onComplete) {
    const overlay = document.getElementById('dragTreeOverlay');
    if (!overlay) {
      if (onComplete) onComplete();
      return;
    }

    overlay.style.display = 'flex';
    const lightPreStage = document.getElementById('lightPreStage');
    const lightStage = document.getElementById('lightStage');
    const lightAmber1 = document.getElementById('lightAmber1');
    const lightAmber2 = document.getElementById('lightAmber2');
    const lightAmber3 = document.getElementById('lightAmber3');
    const lightGreen = document.getElementById('lightGreen');
    const statusText = document.getElementById('treeStatusText');

    // Reset tree lights
    [lightPreStage, lightStage, lightAmber1, lightAmber2, lightAmber3, lightGreen].forEach(el => {
      if (el) el.classList.remove('active');
    });

    if (statusText) statusText.textContent = 'STAGING LAUNCH...';

    // Step 1: Pre-stage light
    setTimeout(() => {
      if (lightPreStage) lightPreStage.classList.add('active');
    }, 400);

    // Step 2: Stage light
    setTimeout(() => {
      if (lightStage) lightStage.classList.add('active');
      if (statusText) statusText.textContent = 'STAGED & READY!';
    }, 1000);

    // Step 3: Amber 1
    setTimeout(() => {
      if (lightAmber1) lightAmber1.classList.add('active');
    }, 1800);

    // Step 4: Amber 2
    setTimeout(() => {
      if (lightAmber2) lightAmber2.classList.add('active');
    }, 2400);

    // Step 5: Amber 3
    setTimeout(() => {
      if (lightAmber3) lightAmber3.classList.add('active');
    }, 3000);

    // Step 6: GREEN GO LIGHT!
    setTimeout(() => {
      if (lightGreen) lightGreen.classList.add('active');
      if (statusText) statusText.textContent = '🔥 GREEN! LAUNCH! 🔥';

      setTimeout(() => {
        overlay.style.display = 'none';
        if (onComplete) onComplete();
      }, 1200);
    }, 3600);
  }

  const plugin = {
    id: 'apex-drag',
    name: 'Apex Drag & Launch Telemetry',
    description: 'High-performance drag timing for 1/4 mi, 1/2 mi, 1 mi & 0-60 runs with drag tree countdown, run history logs, 1000ft proximity analytics, and social share graphics.',
    version: '1.1.0',
    icon: '⚡',
    category: 'performance',

    screensaverWidgets: [
      {
        id: 'apex-drag-widget',
        label: 'DRAG TIMER',
        render: function () {
          return `
            <div class="screensaver-widget" data-widget="apex-drag-widget">
              <div class="screensaver-value screensaver-value-sm" id="ssApexVal">READY</div>
              <div class="screensaver-label" id="ssApexSub">APEX TELEMETRY</div>
            </div>
          `;
        },
        update: function (el) {
          const valEl = el.querySelector('#ssApexVal');
          const subEl = el.querySelector('#ssApexSub');
          if (!valEl) return;
          const target = TARGETS[state.targetKey] || TARGETS['quarter'];
          if (state.mode === 'ARMED') {
            valEl.textContent = '⚡ STAGED';
            if (subEl) subEl.textContent = target.label;
          } else if (state.mode === 'RUNNING') {
            const et = (Date.now() - state.startTime) / 1000;
            valEl.textContent = et.toFixed(1) + 's';
            if (subEl) subEl.textContent = `${state.topSpeed.toFixed(1)} MPH`;
          } else if (state.mode === 'FINISHED' && state.lastRun) {
            valEl.textContent = fmtET(state.lastRun.etMs);
            if (subEl) subEl.textContent = `TOP ${state.lastRun.topSpeed} MPH`;
          } else {
            valEl.textContent = 'READY';
            if (subEl) subEl.textContent = 'APEX TELEMETRY';
          }
        }
      }
    ],

    init: function (container) {
      if (!container) return;
      const cfg = getConfig();
      state.targetKey = cfg.targetKey || 'quarter';
      state.launchMode = cfg.launchMode || '10';

      const logs = getLogs();
      if (logs.length > 0) state.lastRun = logs[0];

      this.renderWidget(container);
      this.attachListeners(container);
    },

    renderWidget: function (container) {
      const logs = getLogs();

      container.innerHTML = `
        <div class="apex-drag-card">
          <div class="drag-header">
            <div class="drag-title">
              <span class="drag-icon">⚡</span>
              <span>APEX DRAG & LAUNCH</span>
            </div>
            <div class="drag-mode-badge" id="adModeBadge">IDLE</div>
          </div>

          <div class="drag-main-display">
            <div class="drag-hero-time" id="adTimeDigits">0.000s</div>
            <div class="drag-hero-sub" id="adSpeedSub">0.0 MPH</div>
          </div>

          <div class="drag-controls-row">
            <button type="button" class="btn primary ad-arm-btn" id="adArmBtn">🔴 STAGE LAUNCH</button>
            <button type="button" class="btn secondary" id="adOpenPerfBtn">⚡ Apex Full View</button>
          </div>
        </div>
      `;
    },

    attachListeners: function (container) {
      const armBtn = container.querySelector('#adArmBtn');
      const openPerfBtn = container.querySelector('#adOpenPerfBtn');

      if (armBtn) {
        armBtn.onclick = () => {
          if (state.mode === 'IDLE' || state.mode === 'FINISHED') {
            startLaunchSequence(() => {
              state.mode = 'ARMED';
              state.topSpeed = 0;
              state.samples = [];
              state.startTime = Date.now();
              const badge = container.querySelector('#adModeBadge');
              if (badge) badge.textContent = '🔥 RUNNING';
            });
          } else {
            state.mode = 'IDLE';
            const badge = container.querySelector('#adModeBadge');
            if (badge) badge.textContent = 'IDLE';
          }
        };
      }

      if (openPerfBtn) {
        openPerfBtn.onclick = () => {
          if (typeof window.showPerformanceView === 'function') {
            window.showPerformanceView();
          }
        };
      }
    },

    updateTelemetry: function (telemetry) {
      if (!telemetry) return;
      state.currentSpeed = telemetry.speed || 0;

      if (state.mode === 'RUNNING') {
        if (state.currentSpeed > state.topSpeed) state.topSpeed = state.currentSpeed;
      }
    },

    renderProximityBests: function (container, currentLat, currentLng) {
      if (!container) return;
      let logs = getLogs();

      if (!logs || logs.length === 0) {
        logs = [
          {
            id: 'demo-1',
            topSpeed: 134.2,
            etMs: 10420,
            targetLabel: '1/4 Mile',
            dateIso: new Date().toISOString(),
            location: 'Deals Gap / Tail of the Dragon, NC',
            lat: 35.4668,
            lng: -83.9213
          },
          {
            id: 'demo-2',
            topSpeed: 158.7,
            etMs: 18210,
            targetLabel: '1/2 Mile',
            dateIso: new Date(Date.now() - 86400000).toISOString(),
            location: 'Back of the Dragon / Marion, VA',
            lat: 36.8343,
            lng: -81.5146
          }
        ];
      }

      const nearbyLogs = logs.filter(log => {
        if (!log.lat || !log.lng || !currentLat || !currentLng) return false;
        const ft = haversineFeet(currentLat, currentLng, log.lat, log.lng);
        return ft <= 5000;
      });

      const displayList = nearbyLogs.length > 0 ? nearbyLogs : logs;
      const topRun = displayList.reduce((best, cur) => (cur.topSpeed > (best.topSpeed || 0) ? cur : best), displayList[0]);
      const socialImgData = generateSocialCard(topRun);

      container.innerHTML = `
        <div class="proximity-section">
          <div class="proximity-badge ${nearbyLogs.length > 0 ? '' : 'alt'}">
            ${nearbyLogs.length > 0 ? `📍 1000 FT PROXIMITY MATCH (${nearbyLogs.length} Runs Recorded Here)` : `📜 RECENT LOGGED RUNS (${logs.length} Total Runs)`}
          </div>
          ${socialImgData ? `<img src="${socialImgData}" alt="Apex Performance Share Card" class="social-share-img" title="Performance Share Card" />` : ''}
          <div class="proximity-runs-list">
            ${displayList.map(r => `
              <div class="log-run-item">
                <div>
                  <strong>⚡ ${r.topSpeed} MPH</strong> • ${fmtET(r.etMs)} (${r.targetLabel || '1/4 Mile'})
                  <small>📅 ${fmtDate(r.dateIso)} • 📍 ${r.location || 'Local Spot'}</small>
                </div>
                <button onclick="if(window.showMapsView && window.RydRMapsNav){ window.showMapsView(); setTimeout(function(){ RydRMapsNav.initMap(${r.lat || 35.4668}, ${r.lng || -83.9213}, '${r.location}'); }, 50); }" class="btn secondary small">🗺️ Map</button>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    },

    attachPerfViewListeners: function () {
      const perfLaunchBtn = document.getElementById("perfLaunchBtn");
      const perfSettingsBtn = document.getElementById("perfSettingsBtn");
      const perfDistanceSelect = document.getElementById("perfDistanceSelect");
      const perfLaunchModeSelect = document.getElementById("perfLaunchModeSelect");
      const perfLiveSpeed = document.getElementById("perfLiveSpeed");
      const perfLiveTime = document.getElementById("perfLiveTime");
      const perfModeBadge = document.getElementById("perfModeBadge");

      if (perfDistanceSelect) {
        perfDistanceSelect.value = state.targetKey || 'quarter';
        perfDistanceSelect.onchange = () => {
          state.targetKey = perfDistanceSelect.value;
          saveConfig({ targetKey: state.targetKey, launchMode: state.launchMode });
          if (perfModeBadge) {
            const target = TARGETS[state.targetKey] || TARGETS['quarter'];
            perfModeBadge.textContent = `${target.label.toUpperCase()} - READY`;
          }
        };
      }

      if (perfLaunchModeSelect) {
        perfLaunchModeSelect.value = state.launchMode || '10';
        perfLaunchModeSelect.onchange = () => {
          state.launchMode = perfLaunchModeSelect.value;
          saveConfig({ targetKey: state.targetKey, launchMode: state.launchMode });
        };
      }

      if (perfLaunchBtn) {
        perfLaunchBtn.onclick = () => {
          if (state.mode === 'IDLE' || state.mode === 'FINISHED') {
            startLaunchSequence(() => {
              state.mode = 'RUNNING';
              state.topSpeed = 0;
              state.samples = [];
              state.startTime = Date.now();
              if (perfModeBadge) perfModeBadge.textContent = '🔥 RUNNING';
              perfLaunchBtn.textContent = '⏹ CANCEL LAUNCH';
              perfLaunchBtn.classList.replace('primary', 'secondary');

              // Telemetry ticker interval
              if (window.__apexTicker) clearInterval(window.__apexTicker);
              window.__apexTicker = setInterval(() => {
                if (state.mode !== 'RUNNING') {
                  clearInterval(window.__apexTicker);
                  return;
                }
                const etSec = (Date.now() - state.startTime) / 1000;
                if (perfLiveTime) perfLiveTime.textContent = etSec.toFixed(3) + 's';

                const currentGeo = typeof RydRGeo !== "undefined" ? RydRGeo.getLast() : null;
                const speed = (currentGeo && currentGeo.speedMph) ? currentGeo.speedMph : (state.currentSpeed || 0);
                if (perfLiveSpeed) perfLiveSpeed.textContent = speed.toFixed(1);
                if (speed > state.topSpeed) state.topSpeed = speed;

                // Auto finish after 15s simulation or target
                if (etSec > 15 && state.topSpeed > 0) {
                  state.mode = 'FINISHED';
                  clearInterval(window.__apexTicker);
                  const runObj = {
                    id: 'run-' + Date.now(),
                    topSpeed: Math.round((state.topSpeed || 85.4) * 10) / 10,
                    etMs: Math.round(etSec * 1000),
                    targetLabel: (TARGETS[state.targetKey] || TARGETS['quarter']).label,
                    dateIso: new Date().toISOString(),
                    location: (currentGeo && currentGeo.label) ? currentGeo.label : 'Deals Gap, NC',
                    lat: (currentGeo && currentGeo.lat) ? currentGeo.lat : 35.4668,
                    lng: (currentGeo && currentGeo.lng) ? currentGeo.lng : -83.9213
                  };
                  saveLog(runObj);
                  state.lastRun = runObj;
                  if (perfModeBadge) perfModeBadge.textContent = '🏁 FINISHED';
                  perfLaunchBtn.textContent = '🔴 ARM LAUNCH';
                  perfLaunchBtn.classList.replace('secondary', 'primary');

                  const container = document.getElementById("perfProximityContent");
                  if (container) {
                    plugin.renderProximityBests(container, runObj.lat, runObj.lng);
                  }
                }
              }, 50);
            });
          } else {
            state.mode = 'IDLE';
            if (window.__apexTicker) clearInterval(window.__apexTicker);
            if (perfModeBadge) perfModeBadge.textContent = 'IDLE';
            perfLaunchBtn.textContent = '🔴 ARM LAUNCH';
            perfLaunchBtn.classList.replace('secondary', 'primary');
          }
        };
      }

      if (perfSettingsBtn) {
        perfSettingsBtn.onclick = () => {
          let modal = document.getElementById("apexSettingsModal");
          if (!modal) {
            modal = document.createElement("div");
            modal.id = "apexSettingsModal";
            // Full-screen views (#performanceView etc.) sit at z-index:500,
            // above the app's default .modal-overlay (z-index:100) — this
            // modal is only ever opened from inside one of those views, so
            // it needs to sit above that layer or it renders behind/below
            // the full-screen view instead of over it.
            modal.className = "modal-overlay";
            modal.style.zIndex = "610";
            modal.style.display = "flex";
            modal.innerHTML = `
              <div class="modal-box" style="max-width:400px; border:1px solid rgba(0,229,255,0.3);">
                <div class="modal-header">
                  <h3 style="color:#00e5ff;">⚙ Apex Drag Setup</h3>
                  <button id="closeApexModal" class="btn secondary small">✕</button>
                </div>
                <div style="display:flex; flex-direction:column; gap:12px;">
                  <label>Target Distance / Sprint:
                    <select id="modalTargetSelect" style="width:100%; padding:8px; margin-top:4px; background:#1e293b; color:#fff; border:1px solid #334155; border-radius:8px;">
                      <option value="quarter">1/4 Mile (1320 ft)</option>
                      <option value="half">1/2 Mile (2640 ft)</option>
                      <option value="mile">1 Mile (5280 ft)</option>
                      <option value="0-60">0-60 MPH Sprint</option>
                      <option value="0-100">0-100 MPH Sprint</option>
                    </select>
                  </label>
                  <label>Countdown Mode:
                    <select id="modalLaunchModeSelect" style="width:100%; padding:8px; margin-top:4px; background:#1e293b; color:#fff; border:1px solid #334155; border-radius:8px;">
                      <option value="10">10s Drag Tree Countdown</option>
                      <option value="30">30s Drag Tree Countdown</option>
                      <option value="60">60s Drag Tree Countdown</option>
                      <option value="motion">Auto Motion Start</option>
                    </select>
                  </label>
                  <button id="saveApexModalBtn" class="btn primary" style="margin-top:10px;">Save Settings</button>
                </div>
              </div>
            `;
            document.body.appendChild(modal);

            document.getElementById("closeApexModal").onclick = () => modal.style.display = "none";
            document.getElementById("saveApexModalBtn").onclick = () => {
              const tKey = document.getElementById("modalTargetSelect").value;
              const lMode = document.getElementById("modalLaunchModeSelect").value;
              state.targetKey = tKey;
              state.launchMode = lMode;
              saveConfig({ targetKey: tKey, launchMode: lMode });
              if (perfDistanceSelect) perfDistanceSelect.value = tKey;
              if (perfLaunchModeSelect) perfLaunchModeSelect.value = lMode;
              if (perfModeBadge) perfModeBadge.textContent = `${(TARGETS[tKey] || TARGETS['quarter']).label.toUpperCase()} - READY`;
              modal.style.display = "none";
            };
          } else {
            modal.style.display = "flex";
          }
        };
      }
    },

    screen: {
      id: 'performanceView',
      title: '⚡ Apex Performance Center',
      render: function (container) {
        // Full Screen Apex Performance View
        container.innerHTML = `
          <div class="perf-screen-surface">
            <h2>⚡ Apex Performance Center</h2>
            <p>Drag race timing, Christmas tree launch countdown, and location proximity run history.</p>
          </div>
        `;
      }
    },

    menuItem: {
      id: 'menuPerformanceBtn',
      label: '⚡ Apex Performance',
      icon: '⚡',
      targetScreenId: 'performanceView'
    },

    render: function (container, payload) {
      const telemetry = payload && payload.telemetry ? payload.telemetry : { speed: 0 };
      const currentSpeed = Number(telemetry.speed || 0);
      const now = Date.now();

      // State machine logic on telemetry tick
      if (state.mode === 'ARMED') {
        if (currentSpeed >= 1.5) {
          state.mode = 'RUNNING';
          state.startTime = now;
          state.topSpeed = currentSpeed;
          state.currentSpeed = currentSpeed;
          state.accumulatedFeet = 0;
          state.lastTime = now;
          state.samples = [{ t: 0, speed: currentSpeed }];
        }
      } else if (state.mode === 'RUNNING') {
        const dt = (now - (state.lastTime || now)) / 1000;
        state.lastTime = now;
        state.currentSpeed = currentSpeed;
        state.topSpeed = Math.max(state.topSpeed, currentSpeed);

        const fps = currentSpeed * 1.46667;
        state.accumulatedFeet += fps * dt;

        const elapsedSec = (now - state.startTime) / 1000;
        state.samples.push({ t: elapsedSec, speed: currentSpeed });

        const target = TARGETS[state.targetKey] || TARGETS['quarter'];
        let isDone = false;

        if (target.type === 'distance') {
          if (state.accumulatedFeet >= target.distFeet) {
            isDone = true;
          }
        } else if (target.type === 'speed') {
          if (currentSpeed >= target.speedMph) {
            isDone = true;
          }
        }

        if (isDone) {
          state.mode = 'FINISHED';
          state.endTime = now;
          const etMs = state.endTime - state.startTime;

          let locationLabel = 'Local Track';
          let userLat = 35.4668;
          let userLng = -83.9213;

          if (root.RydRLocation && typeof root.RydRLocation.getDefaultLocation === 'function') {
            const loc = root.RydRLocation.getDefaultLocation();
            if (loc && loc.label) locationLabel = loc.label;
            if (loc && loc.lat && loc.lng) {
              userLat = loc.lat;
              userLng = loc.lng;
            }
          }

          const run = {
            id: 'run_' + Date.now(),
            targetKey: state.targetKey,
            targetLabel: target.label,
            etMs: etMs,
            topSpeed: Number(state.topSpeed.toFixed(1)),
            dateIso: new Date().toISOString(),
            location: locationLabel,
            lat: userLat,
            lng: userLng,
            weather: telemetry.weather || 'Clear 72°F',
            condition: telemetry.condition || 'Clear',
            lean: telemetry.lean || '0°',
            samples: state.samples
          };

          state.lastRun = run;
          saveLog(run);
        }
      }

      // Check if wrapper structure exists
      const wrapper = container.querySelector('.ad-surface');
      if (wrapper) {
        plugin.updateDashboardCard(wrapper, telemetry);
        return;
      }

      const cfg = getConfig();
      state.targetKey = cfg.targetKey || 'quarter';
      state.launchMode = cfg.launchMode || '10';

      container.innerHTML = `
        <div class="ad-surface" data-state="idle">
          <div class="ad-sub-head">
            <div class="ad-target-row">
              ${Object.keys(TARGETS).map(k => `
                <button type="button" class="ad-chip ${k === state.targetKey ? 'selected' : ''}" data-target="${k}">
                  ${TARGETS[k].label}
                </button>
              `).join('')}
            </div>
            <button type="button" class="ad-history-icon-btn" id="adOpenPerfBtn">⚡ Full View</button>
          </div>

          <div class="ad-timer-box">
            <div class="ad-tree-lights" aria-hidden="true">
              <span class="ad-tree-light amber"></span>
              <span class="ad-tree-light amber"></span>
              <span class="ad-tree-light amber"></span>
              <span class="ad-tree-light green"></span>
            </div>
            <div class="ad-status-pill" id="adStatusPill">IDLE</div>
            <div class="ad-time-digits" id="adTimeDigits">0.000s</div>
            <div class="ad-speed-sub" id="adSpeedSub">0.0 MPH</div>
          </div>

          <button type="button" class="ad-arm-btn" id="adArmBtn">
            <span class="ad-arm-btn-label">🔴 ARM LAUNCH</span>
          </button>
        </div>
      `;

      // Event listeners for card chips & launch
      container.querySelectorAll('.ad-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const k = btn.dataset.target;
          state.targetKey = k;
          saveConfig({ ...getConfig(), targetKey: k });
          container.querySelectorAll('.ad-chip').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });

      const openBtn = container.querySelector('#adOpenPerfBtn');
      if (openBtn) {
        openBtn.addEventListener('click', () => {
          if (typeof window.showPerformanceView === 'function') {
            window.showPerformanceView();
          } else {
            const perfView = document.getElementById('performanceView');
            const dashView = document.getElementById('layoutRoot');
            const mapsView = document.getElementById('mapsView');
            if (perfView) perfView.style.display = 'flex';
            if (dashView) dashView.style.display = 'none';
            if (mapsView) mapsView.style.display = 'none';
          }
        });
      }

      const surface = container.querySelector('.ad-surface');
      const armBtn = container.querySelector('#adArmBtn');
      const armBtnLabel = container.querySelector('.ad-arm-btn-label');
      if (armBtn) {
        armBtn.addEventListener('click', () => {
          if (state.mode === 'ARMED' || state.mode === 'RUNNING') {
            state.mode = 'IDLE';
            if (armBtnLabel) armBtnLabel.textContent = '🔴 ARM LAUNCH';
            if (surface) surface.dataset.state = 'idle';
          } else {
            startLaunchSequence(() => {
              state.mode = 'ARMED';
              state.armedTime = Date.now();
              if (armBtnLabel) armBtnLabel.textContent = '⏹ CANCEL';
              if (surface) surface.dataset.state = 'armed';
            });
          }
        });
      }
    },

    updateDashboardCard: function (wrapper, telemetry) {
      const pill = wrapper.querySelector('#adStatusPill');
      const timeDigits = wrapper.querySelector('#adTimeDigits');
      const speedSub = wrapper.querySelector('#adSpeedSub');
      const armBtnLabel = wrapper.querySelector('.ad-arm-btn-label');

      if (state.mode === 'ARMED') {
        wrapper.dataset.state = 'armed';
        if (pill) pill.textContent = '⚡ STAGED';
        if (timeDigits) timeDigits.textContent = 'WAITING FOR MOTION';
        if (speedSub) speedSub.textContent = `${(telemetry.speed || 0).toFixed(1)} MPH`;
      } else if (state.mode === 'RUNNING') {
        wrapper.dataset.state = 'running';
        const et = (Date.now() - state.startTime) / 1000;
        if (pill) pill.textContent = '🔥 RUNNING';
        if (timeDigits) timeDigits.textContent = et.toFixed(3) + 's';
        if (speedSub) speedSub.textContent = `${(telemetry.speed || 0).toFixed(1)} MPH (Top: ${state.topSpeed.toFixed(1)})`;
        if (armBtnLabel) armBtnLabel.textContent = '⏹ CANCEL';
      } else if (state.mode === 'FINISHED' && state.lastRun) {
        wrapper.dataset.state = 'finished';
        if (pill) pill.textContent = '🏁 FINISHED';
        if (timeDigits) timeDigits.textContent = fmtET(state.lastRun.etMs);
        if (speedSub) speedSub.textContent = `Top: ${state.lastRun.topSpeed} MPH`;
        if (armBtnLabel) armBtnLabel.textContent = '🔴 ARM LAUNCH';
      } else {
        // IDLE (including right after a cancel) — previously had no reset
        // branch here at all, so canceling out of ARMED/RUNNING left the
        // pill/digits/speed frozen on their last value until a full
        // re-render happened to rebuild the card from scratch.
        wrapper.dataset.state = 'idle';
        if (pill) pill.textContent = 'IDLE';
        if (timeDigits) timeDigits.textContent = '0.000s';
        if (speedSub) speedSub.textContent = '0.0 MPH';
        if (armBtnLabel) armBtnLabel.textContent = '🔴 ARM LAUNCH';
      }
    },

    renderProximityBests: function (container, currentLat, currentLng) {
      if (!container) return;
      const logs = getLogs();

      // Filter runs within 1000 ft
      const nearbyLogs = logs.filter(log => {
        if (!log.lat || !log.lng || !currentLat || !currentLng) return false;
        const ft = haversineFeet(currentLat, currentLng, log.lat, log.lng);
        return ft <= 1000;
      });

      if (nearbyLogs.length > 0) {
        const topRun = nearbyLogs.reduce((best, cur) => (cur.topSpeed > (best.topSpeed || 0) ? cur : best), nearbyLogs[0]);
        const socialImgData = generateSocialCard(topRun);

        container.innerHTML = `
          <div class="proximity-section">
            <div class="proximity-badge">📍 1000 FT PROXIMITY MATCH (${nearbyLogs.length} Runs Recorded Here)</div>
            <img src="${socialImgData}" alt="Social Share Card" class="social-share-img" />
            <div class="proximity-runs-list">
              ${nearbyLogs.map(r => `
                <div class="log-run-item">
                  <div>
                    <strong>${r.topSpeed} MPH</strong> • ${fmtET(r.etMs)} (${r.targetLabel || '1/4 Mile'})
                    <small>${fmtDate(r.dateIso)} • ${r.location || 'Local Spot'}</small>
                  </div>
                  <button type="button" class="btn secondary small ad-run-map-btn" data-lat="${r.lat}" data-lng="${r.lng}" data-location="${RydRUtils.escapeHtml(r.location || 'Local Spot')}">🗺️ Map</button>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="proximity-section">
            <div class="proximity-badge alt">📜 RECENT LOGGED RUNS (${logs.length} Total)</div>
            <div class="proximity-runs-list">
              ${logs.length ? logs.slice(0, 10).map(r => `
                <div class="log-run-item">
                  <div>
                    <strong>${r.topSpeed} MPH</strong> • ${fmtET(r.etMs)} (${r.targetLabel || '1/4 Mile'})
                    <small>${fmtDate(r.dateIso)} • ${r.location || 'Local Spot'}</small>
                  </div>
                  <button type="button" class="btn secondary small ad-run-map-btn" data-lat="${r.lat || 35.4668}" data-lng="${r.lng || -83.9213}" data-location="${RydRUtils.escapeHtml(r.location || 'Local Spot')}">🗺️ Map</button>
                </div>
              `).join('') : '<div class="empty-state">No performance runs logged yet. Arm launch and hit the throttle!</div>'}
            </div>
          </div>
        `;
      }

      // Inline onclick handlers previously called a RydRMapsNav.openMapsView()
      // that never existed on the module's public API (initMap/navigateToCoords/
      // etc. are the real exports), so every "Map" button silently threw and
      // did nothing. Wiring real listeners here also sidesteps embedding
      // run.location directly into an onclick="" attribute string, which broke
      // for any location name containing an apostrophe.
      container.querySelectorAll('.ad-run-map-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const lat = parseFloat(btn.dataset.lat);
          const lng = parseFloat(btn.dataset.lng);
          const location = btn.dataset.location || '';
          if (typeof window.showMapsView !== 'function' || !window.RydRMapsNav) return;
          window.showMapsView();
          setTimeout(() => {
            RydRMapsNav.initMap(lat, lng, location);
            // Pre-fill (don't auto-route) the destination search so the
            // rider can get directions from their current location to this
            // spot with one tap, without forcing navigation to start.
            const destInput = document.getElementById('mapsSearchInput');
            if (destInput) destInput.value = location;
          }, 50);
        });
      });
    }
  };

  const runtimeKey = '__RydRPluginRuntime__';
  root[runtimeKey] = root[runtimeKey] || {};
  root[runtimeKey][plugin.id] = plugin;

  // Expose global helper for location rendering
  root.RydRApexDrag = plugin;
})(window);
