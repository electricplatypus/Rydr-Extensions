# Track HUD Theme Package — File Format

A theme package is a single folder, named by its theme id (lowercase,
hyphenated — e.g. `neon-cluster/`):

```
<theme-id>/
  theme.json          # required — the manifest described below
  preview.png          # required — a thumbnail shown in the theme gallery, 4:3 or 16:9
  map-style.json        # required only if any slot's widget is "map"
  assets/
    <slot-id>.png        # one image per image-backed slot (see "layout mode" below)
```

## `theme.json`

```jsonc
{
  "id": "neon-cluster",                 // lowercase, hyphenated, unique
  "name": "Neon Cluster",               // display name shown in the theme gallery
  "description": "Blue-backlit analog automotive cluster with a live nav panel.",
  "author": "your name or agent identity",
  "version": "1.0.0",
  "base": "dark",                       // "dark" | "light" — overall mood, informs any UI chrome RydR draws on top (e.g. loading states)
  "layoutMode": "image-template",       // "image-template" | "styled" — see below
  "aspectRatio": "16:9",                // the template's native ratio; used to fit the landscape viewport
  "preview": "preview.png",
  "background": "assets/background.png", // image-template only — the full-canvas chrome/background layer, with every fully-live slot's region (gauges, map) cut to transparent so nothing double-renders under them

  "slots": [
    {
      "id": "speedometer",              // free-form id, but by convention matches the widget id for image-template themes
      "widget": "speedometer",          // REQUIRED slot — every theme must have exactly one slot with this widget value
      "position": { "x": 0.36, "y": 0.10, "w": 0.30, "h": 0.62 }, // fractions of the template's full width/height, top-left origin
      "asset": "assets/speedometer.png", // background/bezel art for this slot; the live numeric readout renders on top
      "numberRange": { "min": 0, "max": 180 }, // only needed if the slot's baked-in tick art must be reconciled against RydR's real range
      "numberEvery": 40,                 // gauge slots only — spacing between numeric tick labels; match the reference's actual density (a real widget's wider range than the source gauge, e.g. mph 0-280, produces a cluttered default of every-10 unless set explicitly)
      "redlineFrom": false,              // gauge slots only — real number to override the redline threshold, or `false` to disable it outright when the reference gauge has none (omit to keep the default max*0.86)
      "gaugeColor": "#5b9af1"            // gauge slots only — the live SVG tick/needle/fill color, sampled from the reference (not the app's own accent color, see rule 7). Flat single color; use gaugeGradient instead for a ring that visibly shifts hue across its sweep.
    },
    {
      "id": "lean-gauge",
      "widget": "leanAngle",
      "position": { "x": 0.68, "y": 0.16, "w": 0.20, "h": 0.42 },
      "asset": "assets/lean-gauge.png",
      "numberRange": { "min": 0, "max": 60 },
      "gaugeGradient": [                 // gauge slots only, alternative to gaugeColor — a real color sweep along the arc (e.g. blue at low values through pink/magenta through red at max), sampled from the reference at several points around its ring rather than guessed. offset is 0-1 along the value range; any number of stops.
        { "offset": 0, "color": "#5f8aeb" },
        { "offset": 0.6, "color": "#c8377f" },
        { "offset": 1, "color": "#f2372a" }
      ],
      "notes": "Substituted from the reference's tachometer — ticks/numbers redrawn from 0-60°, not the source's 1-8. The reference's ring is a continuous blue-to-pink-to-red sweep, not a flat color with an abrupt redline switch — gaugeGradient reproduces that instead of the default flat-color+redlineFrom look."
    },
    {
      "id": "map-panel",
      "widget": "map",
      "position": { "x": 0.03, "y": 0.10, "w": 0.22, "h": 0.55 }
      // no "asset" — map slots render RydR's live map instead of an image; see map-style.json
    },
    {
      "id": "fuel-gauge",
      "widget": null,                    // decorative only — RydR has no fuel data
      "position": { "x": 0.06, "y": 0.86, "w": 0.28, "h": 0.08 },
      "asset": "assets/fuel-gauge.png"
    }
  ]
}
```

### Field notes

- **`layoutMode`**:
  - `"image-template"` — the theme is built from (or generated to match) a
    reference image; every slot has a `position` in fractional (0-1)
    coordinates against the template's full canvas, so it scales cleanly
    to any device size while preserving the template's aspect ratio.
  - `"styled"` — no bitmap background at all; the theme is expressed
    entirely as color/gradient/shape parameters (for agents with no
    image-generation capability — see SKILL.md Step 1's fallback). A
    `"styled"` theme's slots omit `position`/`asset` and instead carry a
    `"style"` object (colors, glow intensity, bezel treatment) that RydR's
    existing gauge-rendering code already knows how to consume (it builds
    gauges from CSS gradients + SVG today — a `"styled"` theme is
    describing parameters to that same system, not inventing a new one).
- **`slots[].widget`**: must be one of the ids in
  [widget-catalog.md](widget-catalog.md), or `null` for a decorative
  element with no live data. Omitting the field entirely is treated the
  same as `null`.
- **`slots[].position`**: fractions of the *template's* full width/height
  (0.0-1.0), top-left origin — not pixels, so the layout is
  resolution-independent. This is what lets the whole HUD scale to fit a
  landscape viewport (see SKILL.md's "fit the viewport" rule) without
  redoing per-device math.
- **`slots[].asset`**: relative path within the package. Omit for `map`
  widget slots (live map, not an image) and for pure-CSS `"styled"`-mode
  slots.
- **`slots[].numberRange`**: only relevant when a slot's baked-in tick/
  number artwork needs to be reconciled with the real widget's actual
  data range (see SKILL.md rule 4 — a substituted gauge's numbers get
  redrawn, not reused). Compare against the real ranges in the widget
  catalog.

## `map-style.json` (only if any slot has `"widget": "map"`)

A small, declarative style descriptor — write directly to the shape RydR's
map stacks can consume, so it's usable as-is, not just a mood board:

```jsonc
{
  "mode": "google-maps-styles",   // "google-maps-styles" | "tile-filter"
  // For "google-maps-styles": a literal Google Maps `styles` array
  // (the exact type google.maps.MapTypeStyle[] expects — feature/
  // element/stylers triples). Example, dark-navy-with-cyan-roads:
  "styles": [
    { "elementType": "geometry", "stylers": [{ "color": "#0b1220" }] },
    { "elementType": "labels.text.fill", "stylers": [{ "color": "#7d93b8" }] },
    { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#123a4a" }] },
    { "featureType": "road", "elementType": "geometry.stroke", "stylers": [{ "color": "#22d3ee" }] },
    { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#050a12" }] }
  ]

  // Alternative for a Leaflet/raster-tile context ("mode":"tile-filter"):
  // a CSS filter string applied to the tile layer, e.g.
  // "filter": "invert(1) hue-rotate(180deg) saturate(1.4) brightness(0.9)"
}
```

Pick `"google-maps-styles"` when the target render context uses Google
Maps (RydR's dashboard/Track HUD map today does — see
`RydRMaps.createMap`'s existing dark-style default for the current
non-themed look), or `"tile-filter"` for a raster-tile (Leaflet-style)
context. Either is valid; include only the one you produced.

## Validation checklist (must all pass before packaging)

- [ ] Exactly one slot has `"widget": "speedometer"`.
- [ ] Every slot's `widget` is either a valid id from the widget catalog
      or `null`.
- [ ] Every `image-template` slot with a non-null `widget` (other than
      `map`) has an `asset` path that exists in `assets/`.
- [ ] No slot with `"widget": "map"` has an `asset` field.
- [ ] If any slot has `"widget": "map"`, `map-style.json` exists and is
      one of the two documented `mode` shapes.
- [ ] `slots[].position` values are all within 0.0-1.0 and don't produce
      overlapping bounding boxes for two different live-data slots
      (decorative slots may overlap background art; two live gauges
      shouldn't occupy the same space).
- [ ] `aspectRatio` is a realistic landscape phone ratio (roughly between
      16:9 and 20:9) — confirms the "fits the viewport" rule from
      SKILL.md is achievable without letterboxing so severe it shrinks
      gauges illegibly.
- [ ] `preview.png` exists.
- [ ] A written substitution/decoration summary exists somewhere in the
      package (a `notes` field per substituted slot is sufficient, as in
      the example above).
