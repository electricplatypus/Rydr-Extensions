// Ride Film Studio (Labs) — plugin launcher.
//
// The studio itself is a full page (ride-studio.html): it needs MapLibre, the bike model and the
// video encoder, which the dashboard should never load. This plugin is the way in from the
// dashboard: a card showing your latest ride with one button to start directing it, a sidebar
// entry, and a full-screen list of recent rides that each open in the studio.
(function (root) {
  "use strict";

  const STUDIO_URL = "ride-studio.html";
  const REFRESH_MS = 60000;
  const esc = (v) => (root.RydRUtils && root.RydRUtils.escapeHtml ? root.RydRUtils.escapeHtml(String(v)) : String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]));
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const studioLink = (ride) => (ride ? `${STUDIO_URL}?ride=${encodeURIComponent(ride.id)}` : STUDIO_URL);
  const title = (ride) => String(ride.title || ride.name || "Ride").slice(0, 60);
  const when = (ride) => {
    try {
      return new Date(num(ride.startTime)).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch (e) {
      return "";
    }
  };
  const FILM_ICON =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>';

  let rides = null;
  let loadedAt = 0;
  let loading = null;

  // Rides come from RydRStorage (OPFS or localStorage); only id/title/date/distance are used here.
  function loadRides(force) {
    if (loading) return loading;
    if (!force && rides && Date.now() - loadedAt < REFRESH_MS) return Promise.resolve(rides);
    if (typeof root.RydRStorage === "undefined" && typeof RydRStorage === "undefined") return Promise.resolve([]);
    const store = typeof RydRStorage !== "undefined" ? RydRStorage : root.RydRStorage;
    loading = Promise.resolve(store.listRides())
      .then((list) => {
        rides = (Array.isArray(list) ? list : [])
          .filter((r) => r && r.id && Array.isArray(r.trackPoints) && r.trackPoints.length > 1)
          .map((r) => ({ id: String(r.id), title: title(r), startTime: num(r.startTime), distance: num(r.distance), maxSpeed: num(r.maxSpeed) }))
          .sort((a, b) => b.startTime - a.startTime);
        loadedAt = Date.now();
        return rides;
      })
      .catch(() => rides || [])
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  const STYLE_ID = "rfs-plugin-styles";
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".rfs-card{display:flex;flex-direction:column;gap:12px;height:100%;padding:16px;background:var(--bg-panel);color:var(--text-primary);box-sizing:border-box;}",
      ".rfs-head{display:flex;align-items:center;gap:10px;}",
      ".rfs-head h3{margin:0;flex:1;font-family:var(--font-display);font-size:20px;font-weight:700;text-transform:uppercase;line-height:1.1;}",
      ".rfs-head svg{color:var(--route-highlight);flex:none;}",
      ".rfs-ride{display:flex;flex-direction:column;gap:2px;min-width:0;}",
      ".rfs-ride strong{font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".rfs-ride small{font-size:13px;color:var(--text-muted);font-variant-numeric:tabular-nums;}",
      ".rfs-actions{display:flex;gap:8px;margin-top:auto;}",
      ".rfs-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 14px;border-radius:10px;font-family:var(--font-body);font-size:14px;font-weight:600;text-decoration:none;border:1px solid var(--border-strong);background:var(--bg-panel-raised);color:var(--text-primary);}",
      ".rfs-btn-primary{background:var(--route-highlight);border-color:var(--route-highlight);color:var(--route-highlight-ink,#1a0f05);}",
      ".rfs-btn:focus-visible{outline:2px solid var(--route-highlight);outline-offset:2px;}",
      ".rfs-empty{margin:0;font-size:14px;line-height:1.45;color:var(--text-muted);}",
      ".rfs-screen{padding:16px;display:flex;flex-direction:column;gap:12px;max-width:720px;width:100%;margin:0 auto;box-sizing:border-box;}",
      ".rfs-screen p{margin:0;color:var(--text-muted);font-size:14px;line-height:1.5;}",
      ".rfs-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;}",
      ".rfs-list a{display:flex;align-items:center;gap:12px;min-height:60px;padding:10px 14px;border-radius:12px;background:var(--bg-panel);border:1px solid var(--border-strong);color:var(--text-primary);text-decoration:none;}",
      ".rfs-list a:hover{border-color:var(--route-highlight);}",
      ".rfs-list a:focus-visible{outline:2px solid var(--route-highlight);outline-offset:2px;}",
      ".rfs-list .rfs-ride{flex:1;}",
      ".rfs-list b{flex:none;font-size:13px;font-weight:600;color:var(--route-highlight);}",
    ].join("\n");
    document.head.appendChild(style);
  }

  const meta = (r) => `${esc(when(r))} · ${r.distance.toFixed(1)} mi · top ${Math.round(r.maxSpeed)} mph`;

  const plugin = {
    id: "ride-film-studio",
    name: "Ride Film Studio",
    description: "Direct a shareable video of a saved ride: cut between 13 cameras, frame each shot, add gauges, map looks and music, then export and share. (Labs)",
    version: "1.0.0",
    icon: "🎞️",
    category: "media",
    standalone: true,

    render(container) {
      const dbg = typeof RydRDebugConsole !== "undefined" ? RydRDebugConsole.create({ id: plugin.id, title: plugin.name }) : null;
      const run = (fn, label) => (dbg ? dbg.guard(fn, label) : fn());
      run(() => {
        ensureStyles();
        let card = container.querySelector(".rfs-card");
        if (!card) {
          container.innerHTML = `<div class="rfs-card"><div class="rfs-head">${FILM_ICON}<h3>Ride Film Studio</h3><span data-minimize-slot></span></div><div class="rfs-body"><p class="rfs-empty">Loading your rides…</p></div><div class="rfs-actions"></div></div>`;
          card = container.querySelector(".rfs-card");
          if (dbg) container.appendChild(dbg.el);
        }
        loadRides(false).then((list) => {
          const latest = list[0];
          const key = latest ? `${latest.id}|${list.length}` : "none";
          if (card.dataset.key === key) return;
          card.dataset.key = key;
          card.querySelector(".rfs-body").innerHTML = latest
            ? `<div class="rfs-ride"><strong>${esc(latest.title)}</strong><small>${meta(latest)}</small></div>`
            : '<p class="rfs-empty">Record a ride and direct it here as a video: vertical, square or widescreen.</p>';
          card.querySelector(".rfs-actions").innerHTML = latest
            ? `<a class="rfs-btn rfs-btn-primary" href="${esc(studioLink(latest))}">Direct this ride</a><a class="rfs-btn" href="${STUDIO_URL}">All rides</a>`
            : `<a class="rfs-btn" href="${STUDIO_URL}">Open the studio</a>`;
          if (dbg) dbg.log("rides", list.length);
        });
      }, "render");
    },

    screen: {
      id: "ride-film-studio-screen",
      title: "Ride Film Studio",
      render(container) {
        ensureStyles();
        container.innerHTML = '<div class="rfs-screen"><p>Pick a ride to direct. The studio opens full screen, with your camera cuts and settings remembered on this device.</p><ul class="rfs-list"><li><p>Loading your rides…</p></li></ul></div>';
        loadRides(true).then((list) => {
          const ul = container.querySelector(".rfs-list");
          if (!ul) return;
          ul.innerHTML = list.length
            ? list
                .slice(0, 30)
                .map((r) => `<li><a href="${esc(studioLink(r))}"><span class="rfs-ride"><strong>${esc(r.title)}</strong><small>${meta(r)}</small></span><b>Direct</b></a></li>`)
                .join("")
            : `<li><p>No rides yet. Record one from the dashboard, then come back.</p></li>`;
        });
      },
    },

    menuItem: { id: "ride-film-studio-menu", label: "Ride Film Studio", icon: "🎞️", targetScreenId: "ride-film-studio-screen" },
  };

  const runtimeKey = "__RydRPluginRuntime__";
  root[runtimeKey] = root[runtimeKey] || {};
  root[runtimeKey][plugin.id] = plugin;
})(window);
