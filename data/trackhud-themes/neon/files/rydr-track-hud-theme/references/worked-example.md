# Worked Example — "Neon Cluster"

This walks the full build pipeline from SKILL.md against a real reference
image, start to finish, so every rule in this skill is demonstrated
concretely rather than abstractly. The resulting `theme.json` skeleton is
at [../examples/neon-cluster-theme.json](../examples/neon-cluster-theme.json).

## The reference image

A digital automotive instrument cluster, black background, landscape
(~2:1) aspect ratio:

- **Center**: a large circular speedometer — blue backlit ring, black
  face, white ticks/numbers `20, 60, 100, 140, 180, 220, 240, 260, 280`,
  red needle, "mph" label under the center hub.
- **Right**: a smaller circular gauge — same blue-ring styling blending
  into red/orange near its top (a redline zone), numbers `1` through `8`
  around the face, red needle, small text under the hub reading (as
  rendered in the source) "arm" / "arm×1000" — clearly a stylized
  tachometer (RPM gauge), 1-8 representing ×1000 RPM.
- **Left**: a small panel — dark navy/black grid background with a light
  cyan line tracing a winding route and a dot/pin marker at one end;
  reads as a mini nav/route panel. Above it, four small red-outlined
  icons stacked vertically: an "ECO" badge, a warning triangle, a sun/
  light icon, and a battery-shaped icon.
- **Bottom bar**: left portion shows `E` … diagonal blue hash marks … `F`
  (a fuel gauge); center shows `◀ P ▶` (a park/gear-selector indicator);
  right portion shows `C` … hash marks … `H` (a temperature gauge).

## Step 1 — Source

Image supplied directly by the requester. No generation needed — this is
the reliable, preferred path from SKILL.md Step 1. Original saved
unmodified before any processing.

## Step 2 — Pixel-fidelity recreation

Applied the pipeline from SKILL.md Step 2: upscale pass (source was
already reasonably clean/high-contrast — a rendered graphic, not a photo,
so background isolation was straightforward: the near-black background is
uniform enough that the connectivity-aware cutout in SKILL.md's code
sample cleanly separates each gauge/panel from the surrounding black
without needing to fight bright internal details, since this reference
has no bright chrome highlights touching background-black the way a photo
of a real physical cluster might). SSIM check against the recreated
composite before proceeding to decomposition — iterate any region scoring
low before moving on, per SKILL.md's verification step.

## Step 3 — Slot assignment (auto-assignment rules applied)

| Reference element | Auto-assignment rule applied | Assigned widget | Reasoning |
|---|---|---|---|
| Center speedometer | Rule 1 — largest, most central gauge | `speedometer` | Direct, unambiguous match — the source's own tick range (20-280) and "mph" label already align with RydR's real speed data, no substitution needed. |
| Right tachometer (1-8, redline) | Rule 2 — second gauge with a redline zone | `leanAngle` (**proposed — confirm with requester**) | No RPM sensor exists in RydR. A tachometer's visual grammar (secondary circular gauge, redline near max) is the closest match to the lean-angle gauge's own presentation (see widget catalog). Per rule 4, this is a *proposal* to put to the requester, not a silent decision — "keep as pure decoration instead" is an equally valid answer. |
| Left nav/route panel | Rule 4 — panel with route/line art on a grid | `map` | Direct match — this is exactly what a map slot looks like. No image asset shipped for this slot; a `map-style.json` is generated instead (Step 4 below). |
| Bottom C↔H gauge | Rule 5 — thermometer-style hash-mark gauge | `weatherTemp` (**proposed — confirm with requester**) | Real, non-fabricated data (ambient temperature) substituting for a reading RydR can't produce (engine coolant temperature) — an honest substitution per rule 4, not a fabrication, but still a proposal, not an assumption. |
| Bottom `◀ P ▶` indicator | Rule 6 — short-word/letter status in a small frame | `rideStatus` (**proposed — confirm with requester**) | A gear-selector readout has no RydR equivalent; a ride-recording status word ("Recording"/"Paused"/"Not Recording") fits the same small-frame, short-text presentation. |
| ECO badge, warning triangle, sun icon, battery icon, E↔F fuel gauge | No rule matches — no RydR data source exists for any of these | `null` (decorative) | Per rule 4 and interview step 6: these have no honest substitute in RydR's data (no ECO mode, no vehicle warning lights, no fuel sensor). Flagged to the requester as decorative-only rather than fabricated or silently dropped — they may still want the art kept for visual completeness, just inert. |

**Every non-obvious assignment above is marked "proposed" deliberately —
this worked example documents what an agent should *propose*, following
the auto-assignment rules; the actual `widget` values only become final
once the requester has confirmed each one, per SKILL.md's interview step
6 and non-negotiable rule 4.** When this exact theme is actually built
end-to-end (not just documented as an example), those confirmations
happen before `theme.json` is finalized.

## Step 4 — Map slot

The left panel's visual language: near-black/navy background, a fine
grid, a bright cyan route line, a small pin/dot marker. Translated to a
`map-style.json` in `"google-maps-styles"` mode: dark navy geometry, cyan
road strokes, dim label text — see
[../examples/neon-cluster-theme.json](../examples/neon-cluster-theme.json)'s
companion style for the literal values.

## Step 5 — Package

- `layoutMode`: `"image-template"` (built from and matching a real
  reference image).
- `aspectRatio`: the source's own ~2:1 ratio comfortably fits a landscape
  phone viewport (rule 6) without severe letterboxing.
- Slots for `speedometer` and `map` ship real assets. The proposed
  `leanAngle`/`weatherTemp`/`rideStatus` slots, once confirmed, ship
  assets with their tick/label art regenerated per rule 5 (e.g. the
  tachometer's "1-8" numbers redrawn as a 0-60° lean scale, not reused
  verbatim). The decorative elements (ECO/warning/sun/battery/fuel gauge)
  ship as a single combined background-art asset with `widget: null`,
  since they carry no live data and don't need individual slots.
- `heading`, `elapsedTime`, `maxSpeed`, `maxLean`, `bestSpeed`/`avgSpeed`,
  `tripDistance`: **not included** — the reference has no element that
  reads as any of these, and per widget-catalog.md's opening rule, a
  theme only includes the slots its template actually has room for.

See [../examples/neon-cluster-theme.json](../examples/neon-cluster-theme.json)
for the resulting manifest skeleton.

**This example was since built for real** — `track-hud-themes/neon-cluster/`
in the repo root is the actual installable package (real cropped/cleaned
PNG assets, a working `map-style.json`, and a `theme.json` with the
proposed substitutions above confirmed and finalized), selectable today
from Settings > Track HUD > Themes. Its `theme.json` differs slightly from
`examples/neon-cluster-theme.json` in one respect worth calling out: gauge
slot assets ship as bezel/ring **chrome only** (needle and baked tick
numbers removed via the color-threshold technique in SKILL.md Step 3),
not a fully-rendered gauge face — RydR's own live SVG (ticks/needle) draws
on top of that chrome at runtime, the same way the app's default,
unthemed gauges already layer a live SVG over CSS-generated chrome.
