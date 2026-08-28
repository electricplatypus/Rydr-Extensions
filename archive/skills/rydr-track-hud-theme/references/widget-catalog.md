# RydR Track HUD — Real Widget Catalog

This is the complete, accurate list of data RydR's Track HUD can actually
display today. **A theme may use any subset of these — none beyond the
speedometer are mandatory.** If a reference image has no element that
reads as a given widget, simply don't create a slot for it; do not pad a
theme out to "use everything the catalog offers." Every widget id below is
what you write into a slot's `"widget"` field in `theme.json`.

Update cadence: while Track HUD is open, RydR re-reads live data and
updates every widget once per second.

---

### `speedometer` — **required in every theme, exactly one slot**

- **Data**: current speed, in mph.
- **Source**: the rider's live GPS speed.
- **Typical range**: 0–~180 (a generous ceiling; motorcycles rarely
  exceed ~180 mph, but the gauge's max should comfortably cover real
  riding — RydR's own default gauge uses `max: 180`).
- **Presentation today**: a large analog gauge (needle + tick marks) or,
  if the rider has switched to digital mode, a big flat numeric readout —
  a theme's speedometer slot should work either way (see
  `numberRange` in the schema; both styles read the same underlying
  value).

### `leanAngle` — lean angle gauge

- **Data**: how far the bike is leaned over, in degrees, unsigned
  (absolute value — RydR shows lean magnitude, not left/right direction).
- **Source**: phone orientation sensors.
- **Typical range**: 0–60°, with a "redline"/warning zone starting around
  45° (RydR's own default: `max: 60, redlineFrom: 45`).
- **Good substitution target**: a secondary gauge in a reference image
  that isn't a literal lean-angle instrument (real vehicles don't have
  one) but shares the visual grammar of "a second circular gauge with a
  redline zone near its max" — a tachometer is the classic example (see
  the worked example).

### `heading` — compass / heading indicator

- **Data**: direction of travel, 0-359° plus a compass label (N/NE/E/…).
- **Source**: GPS heading.
- **Presentation today**: a small compass-rose gauge (`RydRGauges.
  initCompass` — visually distinct from the speed/lean gauges: a rotating
  needle against fixed N/E/S/W markings rather than a fixed-needle arc
  gauge).
- **Good substitution target**: any compass-rose-shaped element in a
  reference image, or a "wheel rotation"/steering-angle-style dial (the
  original Track HUD build substituted a car's wheel-rotation dial with
  this widget for exactly this reason).

### `map` — live map / route panel

- **Data**: the rider's live position, rendered on an actual map (not a
  static image).
- **Source**: GPS position, continuously updated.
- **Special handling**: see SKILL.md Step 4 — this slot never has an
  `asset`; instead the theme provides `map-style.json` describing the
  map's visual mood (colors, road styling) to match the template.
- **Good substitution target**: any nav-panel, mini-map, or route-preview
  element in a reference image.

### `elapsedTime` — ride elapsed time

- **Data**: time since the current ride recording started, formatted
  `MM:SS`/`H:MM:SS`.
- **Source**: the active ride's start timestamp, if a ride is currently
  being recorded (shows a zeroed value otherwise).
- **Good substitution target**: any clock/timer/stopwatch-style readout,
  or a "lap timer" element in a racing-styled reference (RydR has no lap
  concept — ride-elapsed-time is the honest equivalent).

### `maxSpeed` — session max speed

- **Data**: the highest speed recorded so far this session, mph.
- **Source**: running max over the current ride/session.

### `maxLean` — session max lean

- **Data**: the highest lean angle recorded so far this session, degrees.
- **Source**: running max over the current ride/session.

### `bestSpeed` / `avgSpeed` — session best/average speed

- **Data**: best (same as max) and average speed over the session, mph.
- **Good substitution target**: "best lap"/"last lap" style readouts in a
  racing-telemetry reference — RydR has no lap concept, so best/avg speed
  is the closest honest equivalent (this exact substitution was made in
  the original Track HUD build).

### `weatherCondition` / `weatherTemp` / `weatherWind` — live weather

- **Data**: current weather condition text, ambient temperature, and wind
  speed/description at the rider's location. `weatherCondition` also has
  a real icon/emoji (`RydRUtils.weatherEmoji(conditionId)`, the same one
  shown on the main dashboard weather card) — usable as a live icon
  swapped into an icon-shaped slot, not just a text readout.
- **Source**: RydR's weather module, same data shown on the main
  dashboard weather card.
- **Good substitution target**: a coolant-temperature-style gauge (C↔H
  hash marks) can honestly substitute `weatherTemp` — it's real data,
  just not literally engine coolant temperature (see the worked example).
  A generic condition icon (a static sun/cloud glyph with no real sensor
  behind it) can honestly substitute `weatherCondition` — the icon itself
  swaps to match RydR's real current condition instead of always showing
  the same fixed glyph.

### `weatherAlert` — active weather alert indicator

- **Data**: boolean — whether RydR currently has at least one active
  weather alert (NOAA) for the rider's location.
- **Source**: RydR's alert queue (`activeAlerts` in `js/dashboard.js` —
  populated by real NOAA data, the same alerts shown in the app's top
  banner).
- **Presentation**: not a readout — a slot bound to this widget stays in
  whatever its "off"/dim state looks like when there's no active alert,
  and switches to an "on"/lit state (brighter, a glow, a color change —
  match the reference's own visual language for "alert lit") only while
  `activeAlerts.length > 0`.
- **Good substitution target**: a generic warning-light/warning-triangle
  icon in a reference image (a vehicle telltale with no real sensor
  behind it, e.g. check-engine, ABS) — the icon's on/off *behavior* is
  reused with real data behind it, even though the reference's own icon
  wasn't literally a weather-alert icon. Never fabricate what triggers it
  — only a real active alert lights it, nothing else.

### `rideStatus` — recording status

- **Data**: one of "Recording" / "Paused" / "Not Recording".
- **Source**: RydR's ride-recording state machine.
- **Good substitution target**: a gear-selector or "P/R/N/D"-style
  indicator in a reference image (visually similar — a short status word
  or letter in a small frame) can honestly substitute ride-recording
  status instead.

### `tripDistance` — live trip distance

- **Data**: distance covered so far in the current ride, miles.
- **Source**: running total over the current ride/session.

### `spotifyArt` — now-playing album art

- **Data**: the current Spotify track's album art image URL, if one is
  playing.
- **Source**: `RydRSpotify.getState().nowPlaying.artUrl` (`js/spotify.js`)
  — the same artwork the app's own Spotify controller widget shows.
  `nowPlaying` is `null` when nothing's playing or Spotify isn't
  connected; treat that as "no art," not an error.
- **Good substitution target**: any icon-shaped slot with no real sensor
  behind it (RydR only has this if the rider has actually connected
  Spotify — a decorative icon with no data source is always a safe
  fallback for a rider who hasn't).

### `spotifyProgress` — now-playing playback position

- **Data**: how far into the current track playback is,
  `progressMs / durationMs` as a 0-1 fraction.
- **Source**: `RydRSpotify.getState().nowPlaying.progressMs` /
  `.durationMs` (`js/spotify.js`).
- **Presentation**: a fill/progress-bar-style element that grows from 0
  to full width as the track plays, hidden or at 0 when nothing's
  playing — not a numeric readout.
- **Good substitution target**: any gauge that's fundamentally a "how
  full is this, start to end" bar with no real sensor behind it — a fuel
  gauge (E to F) is the obvious one, the same start-to-end reading
  applies naturally to track progress (start to end of playback).

---

## What has **no** real RydR equivalent — do not fabricate these

RydR is a phone GPS/sensor app, not an OBD-II or TPMS-connected system. It
has no access to, and must never invent placeholder values for:

- RPM / engine speed
- Fuel level
- Coolant/oil temperature (as a literal engine reading — see above for
  the honest ambient-weather-temperature substitution instead)
- Tire pressure (any wheel)
- Brake/throttle position
- Battery/electrical system voltage
- Gear position (as a literal transmission reading — see `rideStatus`
  above for an honest visual substitution instead)
- Any warning/indicator light tied to a vehicle system RydR can't sense
  (check-engine, ABS, traction control, ECO mode, headlight status)

If a reference image includes any of these, follow SKILL.md's interview
step 6 and non-negotiable rule 4: ask the requester whether to drop it,
keep it as pure decoration, or substitute a specific real widget from
this catalog. Never decide silently, and never invent a number.

---

## Auto-assignment decision rules (for image-template themes)

When a reference image is given, use these rules to propose slot
assignments before confirming with the requester (per SKILL.md's
interview step 6, ambiguous cases still get asked about explicitly):

1. **The largest, most visually central circular/arc gauge is always
   `speedometer`** — real dashboard/cluster designs consistently put the
   speedometer front-and-center; this is a safe default, not just a
   guess, and is required regardless (rule 1).
2. **A second prominent circular/arc gauge, especially one with a
   redline/warning zone near its max** → propose `leanAngle`.
3. **A small compass-rose or rotating-needle-against-fixed-cardinal-
   points element** → propose `heading`.
4. **A rectangular or square panel containing route/line art, a grid, or
   anything that reads as "map-like"** → propose `map`.
5. **A numeric readout near a clock/stopwatch icon** → propose
   `elapsedTime`. Near a flag/checkered/trophy icon → propose
   `bestSpeed`/`avgSpeed`. Near a thermometer icon or C↔H-style hash
   marks → propose `weatherTemp`.
6. **A short-word or single-letter status indicator in a small frame**
   (e.g. a gear selector) → propose `rideStatus`.
7. **Anything left over that doesn't match the above** → do not guess;
   surface it to the requester per the interview process (drop / decorate
   / substitute).
