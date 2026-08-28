---
name: rydr-plugin-development
description: Create and extend the RydR App with new features, components, screens, menu items, and settings tabs using AI.
---

# RydR Plugin Development Skill

## Purpose
Teach an AI agent how to create, package, and install plugins for the RydR motorcycle dashboard application. Plugins can add dashboard cards, screensaver widgets, custom full-screen app views, sidebar menu entries, and custom settings panels.

## Where plugins live
- Installable plugin manifests belong in [plugins/manifest.json](plugins/manifest.json).
- Plugin runtime files should be placed in `plugins/[pluginID]/` as a new folder with standalone JavaScript files and a `[pluginID]-meta.json` file in the plugin folder.
- Each plugin file should be self-contained and expose a runtime object via the global plugin runtime bridge.
- If a plugin is installed and enabled, it is automatically reconciled into the Layout Manager in Settings so riders can position it.

## Debug Console
Every plugin should wire up `RydRDebugConsole` (loaded globally from `js/debug-console.js`, no import needed) as its logging and error-handling layer — this is what "in-app debugging" in Settings > Advanced > Developer toggles per component. It's a self-contained component: it injects its own CSS, touches nothing but localStorage/clipboard, and costs nothing at runtime for a rider who hasn't turned it on for your plugin's id.

```js
const dbg = RydRDebugConsole.create({ id: plugin.id, title: plugin.name });
container.appendChild(dbg.el); // safe to always append — hidden until the rider enables it

dbg.log('render() called', payload);
dbg.warn('telemetry missing lean angle');
dbg.error('failed to parse response', err);

// Wrap risky init/render work so one plugin's bug can't take the rest of
// the dashboard down with it. Logs the error (message + stack) and
// swallows by default; pass { rethrow: true } if you need it to keep
// propagating.
dbg.guard(() => riskyInit(), 'riskyInit');
dbg.guardAsync(fetchSomething(), 'fetchSomething');
```

- `dbg.log/info/warn/error(...)` always mirror to the real devtools console too, whether or not the on-screen panel is enabled — the panel is a convenience for on-device debugging without USB devtools, not the only place output goes.
- Create one console per logical component (dashboard card, screensaver widget, settings tab) and reuse the same `id` every render — re-creating it on every render call is harmless (state is read from localStorage) but there's no need.
- A screensaver widget's console `id` should be prefixed `screensaver-` (e.g. `screensaver-my-plugin-widget`) since a screensaver widget and a dashboard card can otherwise collide on the same bare id.
- The rider turns a component's console on/off from **Settings > Advanced > Developer**, which lists every entry in `RydRLayout.CARD_META` (built-in cards + installed plugins), `RydRScreensaver.WIDGET_META` (prefixed `screensaver-`), automatically — a new plugin's id shows up there with no extra registration needed as long as it's installed.

## Plugin Contract
Every plugin exposes a runtime object with optional features (dashboard card, screensaver widget, custom full-screen view, menu item, and settings tab):

```js
(function (root) {
  const plugin = {
    id: 'my-plugin',
    name: 'My Plugin',
    description: 'Short description shown in Settings > Plugins.',
    version: '1.0.0',
    icon: '⚡',
    category: 'display',

    // 1. Dashboard Card Render (Renders in layoutRoot)
    render: function (container, payload) {
      const dbg = RydRDebugConsole.create({ id: plugin.id, title: plugin.name });
      container.innerHTML = '<div class="plugin-surface">Hello RydR</div>';
      container.appendChild(dbg.el);
      dbg.guard(() => {
        // ...plugin init/render logic that might throw...
      }, 'render');
    },

    // 2. Screensaver Widget (Renders in OLED screensaver)
    screensaverWidgets: [
      {
        id: 'my-plugin-widget',
        label: 'My Widget',
        render: function (data) {
          return '<div class="screensaver-widget" data-widget="my-plugin-widget"><div class="screensaver-value screensaver-value-sm">0</div><div class="screensaver-label">MY</div></div>';
        },
        update: function (el, data) {
          const value = el.querySelector('.screensaver-value');
          if (value) value.textContent = Math.round(data && data.mph ? data.mph : 0);
        }
      }
    ],

    // 3. Custom Full-Screen App Screen & Sidebar Menu Entry
    screen: {
      id: 'my-plugin-screen',
      title: 'My Custom App Screen',
      render: function (container, payload) {
        container.innerHTML = '<h1>My Custom Full Screen View</h1>';
      }
    },
    menuItem: {
      id: 'my-plugin-menu-item',
      label: 'My App View',
      icon: '🚀',
      targetScreenId: 'my-plugin-screen'
    },

    // 4. Custom Plugin Settings Tab
    settingsTab: {
      id: 'my-plugin-settings',
      label: 'My Plugin Config',
      render: function (container) {
        container.innerHTML = '<h3>Plugin Configuration Options</h3>';
      }
    }
  };

  const runtimeKey = '__RydRPluginRuntime__';
  root[runtimeKey] = root[runtimeKey] || {};
  root[runtimeKey][plugin.id] = plugin;
})(window);
```

## Standalone Widgets (own styled card, not the generic dashboard-card look)

By default, `render(container, payload)` fills `.plugin-body` inside a **generic** scaffold that `js/plugins.js`'s `renderPluginCard()` builds for you: a plain panel background, a fixed icon/title header row, and padding — fine for a simple data-readout plugin, but wrong for anything with its own visual identity (a themed background, a chart, a custom header, imagery). For that, opt into **standalone** mode instead — the same architecture the first-party Spotify controller and the Hourly Precipitation plugin both use:

```js
const plugin = {
  id: 'my-plugin',
  name: 'My Plugin',
  standalone: true, // <-- opts out of the generic icon/title/panel scaffold
  render: function (container, payload) {
    // container === .plugin-body-standalone: no padding, no background,
    // fills the whole card edge-to-edge. Build your OWN header, your own
    // background, everything — this is the entire visible card, not
    // content inside someone else's card chrome.
  },
  ...
};
```

When `standalone: true`, `renderPluginCard()` skips the generic `.plugin-head` (icon/title bar) and `.plugin-shell`'s panel background entirely, and gives the card the CSS classes `.plugin-standalone` / `.plugin-shell-standalone` / `.plugin-body-standalone` instead — `.plugin-shell-standalone` is `padding:0; border:none; background:transparent; border-radius:20px; overflow:hidden`, so your own background/imagery/video fills the card and gets clipped to the correct rounded-corner shape automatically. **You still get the resize grip for free** (`.plugin-resize-grip`, bottom-right corner, wired to the same pinch/drag `--plugin-scale` mechanism every other card uses) — it's repainted with a translucent dark backing specifically so it stays visible against an arbitrary plugin background, but if your design puts something bright/busy in that exact corner, keep it clear or your own content will visually compete with the grip.

Standalone or not, the card is still a first-class citizen of the Layout Manager (draggable between rows, groupable into a carousel, hideable) and the debug console/settings-tab systems below — going standalone only changes what's *inside* the card, never how the rest of the app manages it.

`.plugin-body-standalone` is isolated (`isolation:isolate`) specifically so a plugin's own internal z-index layering (e.g. content sitting above a decorative background) can't escape the card and out-rank `.plugin-resize-grip`'s click target — found for real building the Hourly Precipitation plugin. You don't need to do anything extra for this; it's handled once, for every standalone plugin, at the shared CSS level.

## Reusable Decorative Backgrounds (`js/bg-animator.js`)

If your plugin wants a full-bleed animated background behind its real
content — a weather scene, a radar sweep, a particle field, anything
"atmosphere" rather than data — reach for `RydRBgAnimator` (loaded
globally from `js/bg-animator.js`, no import needed) instead of hand-
rolling the mounting/stacking/opacity/enabled/reduced-motion/visibility
plumbing yourself. It's built the same way `RydRDebugConsole` is: a
small, self-contained, dependency-free library (own injected CSS, classes
prefixed `rydr-bga-`) with a create/mount API, first proven out by the
Hourly Precipitation plugin (`plugins/hourly-precip/hourly-precip.js`) as
its real consumer.

The library owns the *mechanism*; it knows nothing about what your
background actually looks like — that's 100% your "layers":

```js
const bg = RydRBgAnimator.create(cardRootEl, {
  layers: [sunLayer, cloudLayer, rainLayer], // your own layer objects, see below
  opacity: 0.35,   // 0..1 intensity — exposed to your CSS as --rydr-bga-opacity
  enabled: true,
  // loopMs: 12000, // only needed if a layer defines tick() — see below
});

bg.setData(myForecastArray); // re-lays-out every layer whenever your data changes
bg.setOpacity(0.5);          // wire straight to a settings-tab slider
bg.setEnabled(false);        // wire straight to a settings-tab toggle
bg.destroy();                // only if your plugin ever unmounts
```

A **layer** is a plain object your plugin defines — the library never
inspects what it draws, only calls the hooks it defines:

```js
const cloudLayer = {
  id: "clouds",                        // optional, your own debugging label
  build(api) {                         // called once: return the element to
    const el = document.createElement("div"); // mount. Don't append it yourself —
    el.className = "my-cloud-layer";   // the library appends it into its root.
    return el;
  },
  layout(el, data, api) {              // optional: called once after build(),
    // ...position/size/color children based on `data` (whatever you last
    // passed to bg.setData()) and api.rect (the mounted root's real
    // getBoundingClientRect(), handy for canvas/pixel math)...
  },
  tick(el, progress, api) {            // optional: called continuously
    // (~every 150ms) off a free-running wall-clock loop — `progress` is
    // 0..1 over your `loopMs`. Only needed for ambient motion that isn't
    // data-driven (a drifting particle, a sweeping radar angle) — motion
    // like drifting clouds or falling rain is usually cheaper and simpler
    // as a plain looping CSS @keyframes on your layer's own elements
    // instead, which needs no tick() at all.
  },
};
```

What the library actually does for you:
- **Mounts** a full-bleed, absolutely-positioned, `z-index:0` root as the
  first child of the container you hand it — your own real content just
  needs `position:relative` (or better, `isolation:isolate`, see the
  `.plugin-body-standalone` note above — the same real stacking-context
  bug that note documents is exactly why this library establishes its own
  layer at a known z-index rather than leaving that to chance) and its own
  `z-index` of 1 or higher.
- **Opacity**: sets `--rydr-bga-opacity` as a CSS custom property on its
  root — write your own layers' CSS as `opacity: calc(var(--rydr-bga-opacity) * <your per-layer multiplier>)`,
  the same "one knob, N layers" pattern the old hourly-precip background
  used with its bespoke `--hp-anim-opacity`.
- **Enabled/disabled**: cross-fades the whole root to `opacity:0` and
  pauses every descendant CSS animation under it (and stops the tick
  loop, if any) — a rider who wants a plain, calm dashboard gets a real
  off switch, not just a low number.
- **`prefers-reduced-motion`**: pauses every descendant animation
  automatically (your layers stay laid out and visible, just not moving)
  — you don't need your own reduced-motion media query.
- **Visibility-aware**: pauses the tick loop (if any) when the background
  scrolls out of view (`IntersectionObserver`) or the tab is hidden — the
  performance/battery guidance in the Rich Media section below, handled
  once instead of by every plugin that wants it.
- **Resize-aware**: re-runs every layer's `layout()` automatically when
  the mounted root's size changes (`ResizeObserver`) — covers the resize
  grip's `--plugin-scale` changes without your plugin wiring that up
  itself.

See `plugins/hourly-precip/hourly-precip.js`'s `skyLayer`/`sunLayer`/
`cloudLayer`/`rainLayer`/`scrimLayer` for a real, non-trivial example: a
continuous left-to-right "weather timeline" where each hour's sun/cloud/
rain amounts are computed as smooth 0..1 values and laid out at that
hour's bar-chart column position, entirely via `layout()` — no `tick()`
needed there at all, since the ambient motion (a gentle sun pulse, cloud
sway, falling rain) is just a few looping CSS `@keyframes` on the
elements `layout()` creates.

## Rich Media: Images, Motion, and Video Are Fair Game

Plugins are not limited to plain text/number readouts. A standalone plugin especially is expected to look like a **real, designed product feature** — animated bar charts, weather-condition backgrounds, branded imagery, subtle looping video/GIF textures — not a generic settings-form aesthetic. Guidance for using rich media well on a phone mounted on a motorcycle:

- **Prefer procedural CSS/SVG/Canvas animation over heavy video/image assets** where it can achieve the same effect — a CSS-animated sun arc, drifting cloud shapes, or falling-rain particles (SVG/Canvas) render crisply at any size, cost near-nothing to ship (no binary asset in the repo), and work offline — all real constraints for a PWA a rider may use with a spotty connection. Reach for an actual video/GIF/image asset only when procedural motion genuinely can't deliver the effect.
- **Keep it soft and secondary to the data.** Any animated/decorative background must stay low-opacity and not fight the plugin's actual information (a chart, a number, a status) for visual attention — the data is the reason the widget exists; the motion is atmosphere. Cap decorative-layer opacity well below full strength (roughly 0.15–0.4 is a reasonable starting range) and always give the rider a settings toggle/slider to reduce or disable it (see Settings Tab guidance below) — some riders will want a plain, calm dashboard.
- **Respect performance and battery.** This runs on a phone, mounted, for the length of a ride, often already GPS/screen-heavy. Prefer CSS transforms/opacity animations (GPU-composited, cheap) over animating layout-triggering properties; throttle canvas-based animation to a sane frame budget; pause/stop animation for a plugin that's scrolled out of view or hidden if you can detect it cheaply.
- **If you use real image/video assets**, keep them small, store them in the plugin's own `plugins/[pluginID]/` folder (or reference a stable, appropriately-licensed external URL), and always design a graceful fallback (a solid color / simple gradient) for when the asset fails to load — the same defensive instinct this codebase already applies to CDN scripts and map tiles.
- **When you need a real photographic or video asset and no reasonable procedural substitute exists**, use whatever web research and generation tools are available to you in the session (web search/fetch tools, and an image or video generation tool if one is available) to find or create something genuinely suited to the plugin's subject, rather than shipping a generic stock-photo placeholder or skipping visual polish — a weather plugin's rain/sun/cloud visuals, for instance, should look purpose-built for a weather feature. If no such generation tool is available in your session, say so and fall back to a well-executed procedural (CSS/SVG/Canvas) version instead of leaving the plugin visually flat.

## Installation Rules
1. Register the plugin entry in [plugins/manifest.json](plugins/manifest.json).
2. Use a relative entry path such as `"./plugins/my-plugin/my-plugin.js"`.
3. Keep dashboard cards responsive and optimized for gloved touch input.
4. Read telemetry from `payload.telemetry` (speed, heading, lean, weather, trip time, distance, GPS coordinates).

## Build Checklist
1. Create a plugin directory in `plugins/[pluginID]/`.
2. Create `[pluginID].js` and `[pluginID]-meta.json`.
3. Register the plugin in `plugins/manifest.json`.
4. Ensure the plugin exposes its runtime object on `window.__RydRPluginRuntime__[plugin.id]`.
5. Decide standalone vs. generic: does this plugin have its own visual identity (custom header, background, imagery/animation)? If so, set `standalone: true` (see Standalone Widgets above) rather than fighting the generic `.plugin-shell` panel look from inside it.
6. Verify dashboard layout, screensaver, menu items, and settings tabs render correctly — including the resize grip, which every plugin card gets automatically (generic or standalone).
7. Wire up `RydRDebugConsole.create({ id: plugin.id, title: plugin.name })` in `render()` (and any `screensaverWidgets`/`screen`/`settingsTab` render function) per the Debug Console section above, and wrap init/render logic in `dbg.guard()`/`dbg.guardAsync()`.
8. Remember `render()` is called again on every dashboard tick (~every 2s) with the *same* container element, not a fresh one each time — check for your own already-built DOM (e.g. `container.querySelector('.my-plugin-root')`) and only build it once; update data-driven values in place on subsequent calls. Rebuilding the DOM every render restarts any CSS animation/transition running inside it, which reads as constant flicker instead of a one-time intro animation.

## Styling Guidance
- Use RydR CSS tokens and classes: `.plugin-surface`, `.plugin-big`, `.plugin-chip`, `.plugin-label`, `.plugin-value` for a generic (non-standalone) plugin body.
- A standalone plugin owns its own look entirely — still pull colors/fonts from RydR's existing CSS custom properties (`--bg-panel`, `--text-primary`, `--text-muted`, `--neon-green`, `--alert-red`, `--warn-amber`, `--font-display`, `--font-mono`, etc. — see `:root` near the top of `css/style.css`, including the per-theme overrides further down) so it still feels native to the app across all of RydR's themes, rather than a fixed palette that clashes with whichever theme the rider has picked.
- For screensaver widgets, use flat black/white styles: `.screensaver-widget`, `.screensaver-value`, `.screensaver-label`.
- Keep text large, high-contrast, and readable for motorcycle riders — this bar doesn't relax for a standalone plugin's fancier visuals; the data still has to read at a glance, gloved, while moving.
