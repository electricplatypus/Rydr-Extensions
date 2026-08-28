---
name: rydr-track-hud-theme
description: Design and package a Track HUD theme for the RydR motorcycle dashboard app — a full-screen, racing-telemetry-style instrument cluster. Use when asked to create, design, reskin, or import a Track HUD theme, or to turn a reference/template image (a dash photo, a car cluster mockup, a concept render) into an installable RydR HUD theme.
---

# RydR Track HUD Theme Development Skill

## Who this is for

**You do not need access to the RydR source code to use this skill.** This
package is fully self-contained: everything you need — the widget
vocabulary, the file format, the build process, the rules, and a complete
worked example — lives inside this skill folder. If you can produce a
folder of files (an image-editing/generation capability plus a text editor
is enough), you can build a RydR Track HUD theme.

Read this file first, then:
- [references/theme-package-schema.md](references/theme-package-schema.md) — the exact file format you must produce.
- [references/widget-catalog.md](references/widget-catalog.md) — every real data widget RydR can display, and the auto-assignment rules for mapping template elements onto them.
- [references/worked-example.md](references/worked-example.md) — a complete theme built end-to-end from a real reference image, following every step below.
- [examples/neon-cluster-theme.json](examples/neon-cluster-theme.json) — that worked example's actual `theme.json`, ready to copy as a starting skeleton.

## What a Track HUD is

RydR is a motorcycle dashboard PWA. Its Track HUD is a full-screen,
landscape-first instrument-cluster view (phone mounted on a bike) showing
real ride telemetry — speed, lean angle, heading, a live map, session
stats, weather — styled like a racing/automotive digital cluster. A
**theme** is a reusable visual skin for that view: a background/chrome
image (or a set of per-widget images), a color/mood, and a mapping of
RydR's real widgets onto positions in that visual layout.

## The interview — ask this before building anything

Never start generating or slicing images from a one-line request. Ask the
person requesting the theme (in your own words, adapted to context — this
is a checklist of what you need to know, not a script to read verbatim):

1. **Reference or description?** Do they have a reference image (a real
   dash photo, a stock cluster illustration, a concept render, a
   screenshot of another app) they want matched, or should the look be
   generated from a written description? (See "Both, image preferred" in
   Step 1 below — an image is always the more reliable path when one
   exists.)
2. **Name and one-line identity.** What should this theme be called, and
   in one sentence, what's its vibe? ("Neon Cluster" / "matte-black analog
   automotive gauges with a blue backlight.")
3. **Base mood**: dark or light? Color palette — do they want the
   reference's colors kept exactly, or shifted to a specific accent?
4. **Orientation/device target.** Track HUD is landscape-first (phone
   mounted on a bike) — confirm that's still the target, not a portrait or
   desktop-primary layout.
5. **Widget priorities.** Every theme must show a speedometer (see
   "Non-negotiable rules" below) — beyond that, which of the other real
   widgets (lean angle, heading, live map, elapsed time, max speed/lean,
   weather, ride status — full list in the widget catalog) matter most to
   them? Are there any they explicitly don't want shown?
6. **If a reference image was given**: are there elements in it that have
   no real RydR equivalent (a tachometer, a fuel gauge, warning lights for
   things RydR doesn't track)? For each one, **ask explicitly which real
   RydR widget from the catalog (if any) they want filling that slot** —
   don't silently pick a substitution yourself. Offer the options plainly:
   (a) drop it entirely, (b) keep it as pure decoration with no live data,
   or (c) substitute a specific named widget from the catalog that's
   visually/thematically close. The worked example shows this reasoning
   applied to several elements — read it for the pattern, then put the
   same choice to your own requester rather than assuming their answer.

Only after these are answered — or reasonably inferred from a clear,
detailed request — move to the build pipeline.

## The build pipeline

### Step 1 — Source or generate the reference image

**Image is preferred over generation from scratch whenever one is
available** — recreating a specific real image is a much more
constrained, verifiable problem than "invent a plausible dashboard," and
it's what makes true pixel-fidelity (Step 2) possible at all.

- **If given a reference image**: that's your ground truth for every step
  below. Save it to your working directory unmodified before touching
  anything, so you always have the original to diff against.
- **If no image was given**: build a detailed generation prompt from the
  interview answers (style, mood, palette, what gauges/panels should be
  visible and roughly where) and generate one using whatever image
  capability is available in *your* environment right now. This skill is
  deliberately tool-agnostic here — you might have a native image-gen
  tool, an MCP connector to an image-generation service (e.g. a
  Gemini/"Nano Banana"-class model, Grok's image generation, or similar),
  or a web-accessible API you can call from a script with a provided key.
  Check what's actually available to you before assuming a specific one.
  **If nothing is available**: fall back to hand-authoring the look
  directly as CSS/SVG in the theme package (gradients, `<svg>` gauge
  faces, layered box-shadows) instead of a bitmap — RydR's own existing
  Track HUD gauges are built exactly this way (carbon-fiber weave via
  `repeating-linear-gradient`, metallic bezels via `conic-gradient`, glass
  highlights via radial gradients) precisely because a prior build of this
  same feature had no image-gen tool available either. A theme with no
  bitmap assets at all, described entirely in `theme.json`'s style fields
  plus hand-authored SVG, is a fully valid package — see the schema
  reference for the `layout mode: "styled"` option that supports this.

### Step 2 — Pixel-fidelity recreation pass

The goal here is a recreation of the reference that is visually
indistinguishable from it at normal viewing size — not "inspired by," an
*exact copy*. This is a concrete, scriptable process, not a vibe:

1. **Upscale/clean** the source if it's small or compressed (Python
   `Pillow`, `pip install pillow`, `Image.resize(..., Image.LANCZOS)`), so
   later cropping steps don't work from a blurry source.
2. **Isolate elements from their background** where you need a piece in
   isolation (e.g. a gauge face without the surrounding bezel chrome, so
   it can be recolored or resized independently). A brightness/color
   threshold alone is unreliable — a chrome highlight *inside* a gauge can
   be pixel-identical to the actual background. Use a
   **connectivity-aware cutout** instead: flood-fill from the image's
   *border* through near-background-colored pixels
   (`scipy.ndimage.label`, 8-connectivity — `pip install scipy numpy`) to
   find the region that is actually *connected* to the outer background,
   and only treat that connected region as background. An isolated bright
   spot inside the subject (a highlight, a reflection) never touches that
   border-connected component, so it stays intact regardless of how close
   its color is to the background.
   ```python
   import numpy as np
   from scipy import ndimage
   from PIL import Image

   img = Image.open("reference.png").convert("RGBA")
   arr = np.array(img)
   # near-background mask (tune the threshold per image)
   bg_mask = (arr[:,:,:3].astype(int).sum(axis=2) < 40)  # e.g. near-black
   labeled, _ = ndimage.label(bg_mask, structure=np.ones((3,3)))
   border_labels = set(labeled[0,:]) | set(labeled[-1,:]) | set(labeled[:,0]) | set(labeled[:,-1])
   border_labels.discard(0)
   connected_bg = np.isin(labeled, list(border_labels))
   arr[connected_bg, 3] = 0  # fade only the border-connected background to transparent
   Image.fromarray(arr).save("isolated.png")
   ```
3. **Sample gauge colors, don't guess them.** If a gauge's glowing ring
   shows any color variation around its sweep (a flat accent color at low
   values shifting to a warning color near max — common on real
   instrument clusters), that's a `gaugeGradient` (see the schema
   reference), not a single `gaugeColor`. Confirm which one by sampling
   actual pixels at several points around the ring — for each angle, walk
   outward from center over a radius range and keep the most saturated
   pixel found (plain brightness alone picks up gray bezel/number pixels
   instead of the colored ring):
   ```python
   import numpy as np, math
   from PIL import Image

   src = np.array(Image.open("reference.png").convert("RGB")).astype(int)
   def sample_ring_color(cx, cy, r_min, r_max, angle_deg):
       ang = math.radians(angle_deg - 90)
       best = None
       for r in np.arange(r_min, r_max, 0.5):
           x, y = int(cx + r * math.cos(ang)), int(cy + r * math.sin(ang))
           if 0 <= y < src.shape[0] and 0 <= x < src.shape[1]:
               px = src[y, x]
               score = int(max(px) - min(px)) * 3 + int(px.sum())  # favor colorful over merely bright
               if best is None or score > best[0]:
                   best = (score, tuple(int(v) for v in px))
       return best[1] if best else None

   for deg in range(0, 360, 10):
       print(deg, sample_ring_color(cx, cy, r_min, r_max, deg))
   ```
   Sample enough angles to see the actual transition (a handful of colors
   at roughly-even spacing along the value range is enough — this isn't
   trying to reproduce a true per-pixel conic gradient, just the 2-4 real
   hue stops an SVG `gaugeGradient` needs), then order the stops by where
   they fall along the *value* sweep (low value → high value), not by
   raw sampling angle — a gauge's low-value end and high-value end aren't
   necessarily at 0°/360°.
4. **Verify fidelity with a real diff, not eyeballing.** After recreating
   or reprocessing, compare pixel-for-pixel against the saved original
   (same crop/scale) using `scikit-image`'s structural similarity index
   (`pip install scikit-image`):
   ```python
   from skimage.metrics import structural_similarity as ssim
   import numpy as np
   from PIL import Image

   a = np.array(Image.open("reference.png").convert("L").resize((800, 450)))
   b = np.array(Image.open("recreated.png").convert("L").resize((800, 450)))
   score, diff = ssim(a, b, full=True)
   print(f"SSIM: {score:.4f}")  # aim for > 0.95 before calling it done; lower → iterate
   ```
   If the score is low, identify *where* the diff map is worst (the
   `diff` array — `np.unravel_index(diff.argmin(), diff.shape)` points at
   the region needing another pass) and iterate Step 1/2 on that region
   specifically rather than starting over.
4. Run all of this from a scratch working directory (do not touch
   anything outside your own workspace) — install packages with `pip
   install pillow numpy scipy scikit-image` as needed; they're small, pure
   pip packages with no special access required.

### Step 3 — Element decomposition

Once the recreation passes the fidelity check, crop it into one asset per
widget slot — a separate `background` image for the overall chrome/frame
(with every fully-live slot's region cut to transparent, see the schema
reference's `background` field), and a separate file for each gauge
face/bezel that will be bound to a widget.

**A gauge slot's asset is chrome only — bezel ring and face, with the
source's baked needle and tick numbers removed.** RydR's own gauge
rendering (`RydRGauges.initHudGauge`) already draws a live SVG
needle/ticks/redline on top of whatever chrome sits behind it — that's
true today with a plain CSS bezel, and stays true with a themed image
bezel. If a theme's gauge asset keeps the source's baked numbers, they'll
show through *underneath* the live SVG's own numbers, at whatever angle
the source drew them — visually cluttered and, worse, wrong wherever a
substituted widget's range differs from the source gauge's own (rule 5).
Strip them: color-threshold removal of near-red (needle) and near-white/
light-gray (number) pixels, filled back in with the face's own dark
color, leaves the ring/bezel/redline-gradient intact while clearing the
lane for the live SVG. This is easier and more robust than trying to
redraw numbers into the bitmap by hand.

Cropping to per-slot assets, rather than shipping one flat background
image, is what lets RydR later re-skin, resize, or recolor an individual
gauge (e.g. for the analog/digital toggle) without needing the whole
image redone.

### Step 4 — The map slot is special

If the template has a region that reads as a map/navigation panel, **do
not** ship it as a static image. A live map has to show the rider's real,
moving position — a flat picture can't do that. Instead:

1. Note the panel's position/size in the layout (same `position` fields
   every other slot uses — see the schema reference).
2. Study the reference panel's *visual language* — tile color, road-line
   color/width, background grid, any glow — and translate that into a
   **map style descriptor** (a small set of paint parameters: background
   color, road color, water/land colors, a "glow"/blur amount if the
   reference has one). The schema reference documents the exact shape
   RydR's map stacks (Leaflet tile filtering, or a Google Maps
   `styles` array) can actually consume — write to that shape so the
   style is directly usable, not just decorative documentation.
3. Assign the `map` widget to that slot in `theme.json` — you do **not**
   provide an image asset for a slot whose widget is `map`.

### Step 5 — Assemble, validate, package

1. Write `theme.json` per the schema reference — every slot from Step 3/4
   listed, `widget` set to a real catalog id or `null`/omitted for
   decorative-only slots.
2. Validate against the checklist in the schema reference. **The single
   rule that blocks a package outright: a speedometer slot is
   mandatory** — see below.
3. Confirm the whole composed layout fits a landscape phone viewport with
   no scrolling — see "Non-negotiable rules."
4. Write a one-paragraph human-readable summary (what the theme looks
   like, what got substituted and why, what's decorative-only) — this
   goes to whoever imports the package, so nothing is a silent surprise.
5. Zip or fold the `<theme-id>/` folder (manifest + `assets/` + optional
   `map-style.json`) as your deliverable.

## Non-negotiable rules

1. **The speedometer widget is always displayed.** Every theme must have
   exactly one slot with `"widget": "speedometer"`. A package missing
   this is invalid — do not ship or hand off a theme without it, even a
   work-in-progress draft. If a reference image has an obvious primary
   gauge (the largest, most central one — this is almost always true of
   real dash/cluster designs), that gauge is the speedometer slot. See
   the widget catalog's auto-assignment rules for the general case.
2. **Only build the slots the template actually has room for — never pad
   out to "use every widget."** The widget catalog is a menu, not a
   checklist. A theme is not required to include lean angle, heading,
   weather, or any other optional widget just because RydR *can* display
   it — if the template has no element that reads as that widget, simply
   don't create a slot for it. The only widget every theme must include
   is the speedometer (rule 1).
3. **Auto-assign from the template where the match is obvious — don't
   leave an obvious gap unassigned.** If a reference image has an element
   that unambiguously reads as a real RydR widget (a second numeric gauge
   next to the main one, a compass rose, a map/route panel), assign it
   using the widget catalog's decision rules rather than leaving it
   unmapped by default.
4. **When a template element has no direct match, ask — don't silently
   fabricate or silently decide.** If a template element doesn't map
   cleanly to any real RydR widget (a tachometer, a fuel gauge, an
   oil-pressure light), do not invent data for it, but also don't
   unilaterally mark it decorative on the requester's behalf. Ask them
   which real widget (if any) from the catalog should fill that slot —
   see interview question 6. Only after they choose "keep as decoration"
   (or don't respond and a reasonable default is needed) does the slot's
   `widget` become `null`. This mirrors RydR's own established precedent
   — the original Track HUD build explicitly declined to fabricate
   RPM/brake/throttle/tire-pressure data it doesn't have, and substituted
   only where a real value existed (RPM gauge → lean angle, a choice made
   with the requester, not assumed).
5. **A substituted gauge gets its numbers redrawn, not reused.** If a
   template gauge's *meaning* changes (e.g. a tachometer becomes the lean
   angle gauge), its face/bezel artwork can be reused, but its tick marks
   and numeric labels must be regenerated from the real widget's actual
   range — never leave the original image's baked-in numbers (e.g. "1-8"
   from an RPM gauge) on a slot that now shows degrees.
6. **The entire layout and theme must fit the device screen in landscape/
   horizontal mode — no scrolling, nothing cropped off-screen.** Track HUD
   is used on a phone mounted on a bike in landscape orientation; the
   composed layout (whether an image-template or a styled/CSS theme)
   scales via aspect-ratio-preserving contain-fit to the device's
   landscape viewport. A theme that requires scrolling, or that clips any
   live-data slot outside the visible area, is not acceptable — check
   this explicitly before packaging (this applies to the image-template's
   aspect ratio vs. common landscape phone ratios, roughly 16:9 to 20:9).
7. **A theme is exactly one style — never a light/dark pair.** Track HUD
   itself doesn't follow RydR's separate app-wide light/dark theme
   setting, and neither does a custom theme: it's a single, fixed
   recreation of its reference image or description, full stop. Don't
   build a "light version" and "dark version" of the same theme, don't
   gate any part of a theme's look behind the app's light/dark state, and
   don't ask the requester whether they want light and dark variants —
   one theme, one look, pixel-accurate to what it's recreating.
8. **Every asset is licensable/original.** Don't ship a theme built from a
   reference image you don't have rights to redistribute (a copyrighted
   photo, a trademarked manufacturer logo/cluster design) without the
   requester's explicit confirmation they have that right — recreate the
   *style* (gauge shapes, color language, layout) rather than copying
   branded elements verbatim when in doubt, and never include a real
   manufacturer logo or trademarked nameplate in the output.

## What "done" looks like

A theme package that:
- Passes the schema validation checklist (speedometer present, every slot
  resolved to a real widget id or explicitly `null`).
- Passed the Step 2 fidelity check against its reference (if one was
  used), or was intentionally hand-authored per Step 1's fallback.
- Fits a landscape phone viewport with no scroll.
- Has a written substitution/decoration summary so nothing about what's
  "live" vs. decorative is a surprise.

Read [references/worked-example.md](references/worked-example.md) next to
see all of this applied to a real reference image end-to-end.
